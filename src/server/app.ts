import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';
import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import type { Config } from './config.ts';
import type { AppDatabase } from './db/client.ts';
import { openDatabase } from './db/client.ts';
import { runMigrations } from './db/migrate.ts';
import {
  AppError,
  NotFoundError,
  ValidationError,
  appErrorFromHttpError,
  toErrorResponse,
} from './lib/errors.ts';
import { createReceiptProcessor, type ReceiptProcessor } from './jobs/receiptProcessor.ts';
import { KimiClient } from './llm/KimiClient.ts';
import type { LlmClient } from './llm/LlmClient.ts';
import authPlugin from './plugins/auth.ts';
import healthRoutes from './routes/health.ts';
import receiptLinesRoutes from './routes/receiptLines.ts';
import receiptsRoutes from './routes/receipts.ts';

declare module 'fastify' {
  interface FastifyInstance {
    db: AppDatabase;
    sqlite: InstanceType<typeof Database>;
    llm: LlmClient;
    receiptProcessor: ReceiptProcessor;
  }
}

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const clientDistDir = path.join(repoRoot, 'dist', 'client');

function readVersion(): string {
  const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf-8')) as {
    version: string;
  };
  return pkg.version;
}

export type LogStream = { write(message: string): void };

export type BuildAppOptions = {
  config: Config;
  /** Overrides `config.databasePath`; tests pass `:memory:` or a temporary file. */
  databasePath?: string;
  /** Where pino writes; tests capture log lines through it. */
  logStream?: LogStream;
  /** Overrides the directory `dist/client` is served from in production; tests point this at a fixture. */
  clientDir?: string;
  /** Overrides the LLM client; otherwise a `KimiClient` is built from config. Tests inject a `FakeLlmClient`. */
  llmClient?: LlmClient;
  /** Overrides the job runner's clock; tests pin it for deterministic `todayInOslo` results. */
  now?: () => Date;
};

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const { config } = options;
  const clientDir = options.clientDir ?? clientDistDir;

  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: ['req.headers.cookie', 'req.headers.authorization'],
      ...(options.logStream ? { stream: options.logStream } : {}),
    },
    trustProxy: config.nodeEnv === 'production',
    // Fastify's default id (req-1, req-2, …) resets every restart; a UUID stays unique across them.
    genReqId: () => randomUUID(),
  });

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-request-id', request.id);
    return payload;
  });

  app.setErrorHandler((error, request, reply) => {
    const requestId = request.id;

    if (error instanceof ZodError) {
      const validationError = new ValidationError('Ugyldig forespørsel', error.issues);
      reply.status(validationError.statusCode).send(toErrorResponse(validationError, requestId));
      return;
    }

    if (error instanceof AppError) {
      if (error.statusCode >= 500) {
        request.log.error({ err: error, requestId }, error.message);
      }
      reply.status(error.statusCode).send(toErrorResponse(error, requestId));
      return;
    }

    const mapped = appErrorFromHttpError(error);
    if (mapped) {
      // Log the original Fastify/plugin error, not the Norwegian-mapped one, so the real cause stays available for triage.
      request.log.warn({ err: error, requestId }, 'Request rejected');
      reply.status(mapped.statusCode).send(toErrorResponse(mapped, requestId));
      return;
    }

    request.log.error({ err: error, requestId }, 'Unhandled error');
    reply.status(500).send(toErrorResponse(error, requestId));
  });

  app.setNotFoundHandler((request, reply) => {
    const requestId = request.id;

    if (request.url.startsWith('/api/')) {
      const notFound = new NotFoundError();
      reply.status(notFound.statusCode).send(toErrorResponse(notFound, requestId));
      return;
    }

    const accept = request.headers.accept ?? '';
    if (
      config.nodeEnv === 'production' &&
      request.method === 'GET' &&
      accept.includes('text/html')
    ) {
      reply.type('text/html').sendFile('index.html', clientDir);
      return;
    }

    reply.status(404).send('Not found');
  });

  if (config.nodeEnv === 'production') {
    app.register(fastifyStatic, { root: clientDir });
  }

  const { sqlite, db } = openDatabase(options.databasePath ?? config.databasePath);
  runMigrations(db);
  app.decorate('db', db);
  app.decorate('sqlite', sqlite);
  app.addHook('onClose', async () => {
    sqlite.close();
  });

  const llmClient =
    options.llmClient ??
    new KimiClient({
      apiKey: config.moonshotApiKey,
      baseURL: config.kimiBaseUrl,
      model: config.kimiModel,
      thinking: config.kimiThinking,
      timeoutMs: config.kimiTimeoutMs,
      logger: app.log,
    });
  app.decorate('llm', llmClient);

  const receiptProcessor = createReceiptProcessor({
    db,
    sqlite,
    llm: llmClient,
    logger: app.log,
    ...(options.now ? { now: options.now } : {}),
  });
  app.decorate('receiptProcessor', receiptProcessor);
  receiptProcessor.requeueUnfinished();

  app.register(fastifyMultipart, { limits: { fileSize: config.maxUploadBytes, files: 1 } });

  app.register(healthRoutes, { version: readVersion() });
  app.register(authPlugin, { config });
  app.register(receiptsRoutes, { now: options.now ?? (() => new Date()) });
  app.register(receiptLinesRoutes);

  return app;
}
