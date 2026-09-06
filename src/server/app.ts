import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
import healthRoutes from './routes/health.ts';

declare module 'fastify' {
  interface FastifyInstance {
    db: AppDatabase;
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
};

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const { config } = options;

  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: ['req.headers.cookie', 'req.headers.authorization'],
      ...(options.logStream ? { stream: options.logStream } : {}),
    },
    trustProxy: config.nodeEnv === 'production',
  });

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-request-id', request.id);
    return payload;
  });

  app.setErrorHandler((error, request, reply) => {
    const requestId = request.id;

    const appError =
      error instanceof ZodError
        ? new ValidationError('Ugyldig forespørsel', error.issues)
        : error instanceof AppError
          ? error
          : appErrorFromHttpError(error);

    if (appError) {
      if (appError.statusCode >= 500) {
        request.log.error({ err: appError, requestId }, appError.message);
      }
      reply.status(appError.statusCode).send(toErrorResponse(appError, requestId));
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

    if (config.nodeEnv === 'production' && request.method === 'GET') {
      reply.type('text/html').sendFile('index.html');
      return;
    }

    reply.status(404).send('Not found');
  });

  if (config.nodeEnv === 'production') {
    app.register(fastifyStatic, { root: clientDistDir });
  }

  const { sqlite, db } = openDatabase(options.databasePath ?? config.databasePath);
  runMigrations(db);
  app.decorate('db', db);
  app.addHook('onClose', async () => {
    sqlite.close();
  });

  app.register(healthRoutes, { version: readVersion() });

  return app;
}
