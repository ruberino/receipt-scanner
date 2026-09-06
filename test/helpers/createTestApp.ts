import type { FastifyInstance } from 'fastify';
import { buildApp, type LogStream } from '../../src/server/app.ts';
import { loadConfig } from '../../src/server/config.ts';
import { FakeLlmClient } from '../../src/server/llm/FakeLlmClient.ts';
import type { LlmClient } from '../../src/server/llm/LlmClient.ts';

export const TEST_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  APP_PASSWORD: 'test-password-123',
  SESSION_SECRET: 'test-session-secret-at-least-32-characters',
  MOONSHOT_API_KEY: 'test-key',
  LOG_LEVEL: 'silent',
};

export type TestAppOptions = {
  env?: Record<string, string>;
  /** Defaults to an in-memory database (from T03); pass a file path to share a database between two apps. */
  databasePath?: string;
  logStream?: LogStream;
  /** Defaults to a `FakeLlmClient` with an empty script; pass one scripted for the test. */
  llmClient?: LlmClient;
  /** Pins the job runner's clock for deterministic `todayInOslo` results. */
  now?: () => Date;
  /** better-sqlite3's `verbose` hook, one call per executed SQL statement; tests use it to count queries. */
  dbVerbose?: (message?: unknown, ...additionalArgs: unknown[]) => void;
};

export function createTestApp(options: TestAppOptions = {}): FastifyInstance {
  const config = loadConfig({ ...TEST_ENV, ...options.env });
  return buildApp({
    config,
    databasePath: options.databasePath ?? ':memory:',
    llmClient: options.llmClient ?? new FakeLlmClient([]),
    ...(options.logStream ? { logStream: options.logStream } : {}),
    ...(options.now ? { now: options.now } : {}),
    ...(options.dbVerbose ? { dbVerbose: options.dbVerbose } : {}),
  });
}

/** Collects pino JSON lines so a test can assert on what was logged. */
export function createLogCapture(): LogStream & { lines(): Record<string, unknown>[] } {
  const raw: string[] = [];
  return {
    write(message: string) {
      raw.push(message);
    },
    lines() {
      return raw
        .flatMap((chunk) => chunk.split('\n'))
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line) as Record<string, unknown>);
    },
  };
}
