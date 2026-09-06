import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/server/config.ts';

const validEnv: Record<string, string> = {
  APP_PASSWORD: 'a-valid-password',
  SESSION_SECRET: 'a-session-secret-that-is-at-least-32-chars',
  MOONSHOT_API_KEY: 'sk-test',
};

function without(key: string): Record<string, string> {
  const env = { ...validEnv };
  delete env[key];
  return env;
}

describe('loadConfig', () => {
  it('parses a minimal valid environment and fills in the documented defaults', () => {
    expect(loadConfig(validEnv)).toEqual({
      nodeEnv: 'development',
      port: 3000,
      host: '0.0.0.0',
      databasePath: './data/receipt-scanner.db',
      appPassword: validEnv.APP_PASSWORD,
      sessionSecret: validEnv.SESSION_SECRET,
      moonshotApiKey: validEnv.MOONSHOT_API_KEY,
      kimiModel: 'kimi-k2.6',
      kimiBaseUrl: 'https://api.moonshot.ai/v1',
      kimiThinking: 'disabled',
      kimiTimeoutMs: 120_000,
      maxUploadBytes: 10_485_760,
      logLevel: 'info',
      tz: 'Europe/Oslo',
    });
  });

  it('applies every override from the environment', () => {
    const config = loadConfig({
      ...validEnv,
      NODE_ENV: 'production',
      PORT: '8080',
      HOST: '127.0.0.1',
      DATABASE_PATH: '/data/receipt-scanner.db',
      KIMI_MODEL: 'kimi-k3',
      KIMI_BASE_URL: 'https://example.test/v1',
      KIMI_THINKING: 'enabled',
      KIMI_TIMEOUT_MS: '30000',
      MAX_UPLOAD_BYTES: '1048576',
      LOG_LEVEL: 'debug',
      TZ: 'UTC',
    });

    expect(config).toMatchObject({
      nodeEnv: 'production',
      port: 8080,
      host: '127.0.0.1',
      databasePath: '/data/receipt-scanner.db',
      kimiModel: 'kimi-k3',
      kimiBaseUrl: 'https://example.test/v1',
      kimiThinking: 'enabled',
      kimiTimeoutMs: 30_000,
      maxUploadBytes: 1_048_576,
      logLevel: 'debug',
      tz: 'UTC',
    });
  });

  it('throws naming the variable when MOONSHOT_API_KEY is missing or empty', () => {
    expect(() => loadConfig(without('MOONSHOT_API_KEY'))).toThrow(/MOONSHOT_API_KEY/);
    expect(() => loadConfig({ ...validEnv, MOONSHOT_API_KEY: '' })).toThrow(/MOONSHOT_API_KEY/);
  });

  it('throws naming the variable when APP_PASSWORD is missing or too short', () => {
    expect(() => loadConfig(without('APP_PASSWORD'))).toThrow(/APP_PASSWORD/);
    expect(() => loadConfig({ ...validEnv, APP_PASSWORD: 'short' })).toThrow(/APP_PASSWORD/);
  });

  it('throws naming the variable when SESSION_SECRET is missing or too short', () => {
    expect(() => loadConfig(without('SESSION_SECRET'))).toThrow(/SESSION_SECRET/);
    expect(() => loadConfig({ ...validEnv, SESSION_SECRET: 'too-short' })).toThrow(
      /SESSION_SECRET/,
    );
  });

  it('rejects values outside the documented sets', () => {
    expect(() => loadConfig({ ...validEnv, KIMI_THINKING: 'maybe' })).toThrow(/KIMI_THINKING/);
    expect(() => loadConfig({ ...validEnv, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
    expect(() => loadConfig({ ...validEnv, PORT: 'eighty' })).toThrow(/PORT/);
    expect(() => loadConfig({ ...validEnv, KIMI_BASE_URL: 'not a url' })).toThrow(/KIMI_BASE_URL/);
  });
});
