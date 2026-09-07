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
      llmProvider: 'kimi',
      llmProviderPropose: 'kimi',
      llmMaxRetries: 0,
      moonshotApiKey: validEnv.MOONSHOT_API_KEY,
      kimiModel: 'kimi-k2.6',
      kimiBaseUrl: 'https://api.moonshot.ai/v1',
      kimiThinking: 'disabled',
      kimiTimeoutMs: 120_000,
      xaiApiKey: undefined,
      xaiModel: 'grok-4.6',
      xaiBaseUrl: 'https://api.x.ai/v1',
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
      LLM_MAX_RETRIES: '3',
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
      llmMaxRetries: 3,
      maxUploadBytes: 1_048_576,
      logLevel: 'debug',
      tz: 'UTC',
    });
  });

  it('rejects a negative LLM_MAX_RETRIES', () => {
    expect(() => loadConfig({ ...validEnv, LLM_MAX_RETRIES: '-1' })).toThrow(/LLM_MAX_RETRIES/);
  });

  it('throws naming the variable when MOONSHOT_API_KEY is missing or empty, with the default provider (kimi)', () => {
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
    expect(() => loadConfig({ ...validEnv, LLM_PROVIDER: 'gpt' })).toThrow(/LLM_PROVIDER/);
  });

  describe('LLM_PROVIDER=grok (T27)', () => {
    const grokEnv: Record<string, string> = {
      APP_PASSWORD: 'a-valid-password',
      SESSION_SECRET: 'a-session-secret-that-is-at-least-32-chars',
      LLM_PROVIDER: 'grok',
      XAI_API_KEY: 'xai-test-key',
    };

    it('does not require MOONSHOT_API_KEY', () => {
      expect(() => loadConfig(grokEnv)).not.toThrow();
    });

    it('throws naming XAI_API_KEY when missing or empty, and MOONSHOT_API_KEY stays optional', () => {
      const withoutKey = { ...grokEnv };
      delete withoutKey.XAI_API_KEY;
      expect(() => loadConfig(withoutKey)).toThrow(/XAI_API_KEY/);
      expect(() => loadConfig({ ...grokEnv, XAI_API_KEY: '' })).toThrow(/XAI_API_KEY/);
    });

    it('fills in the grok defaults and applies overrides', () => {
      expect(loadConfig(grokEnv)).toMatchObject({
        llmProvider: 'grok',
        xaiApiKey: 'xai-test-key',
        xaiModel: 'grok-4.6',
        xaiBaseUrl: 'https://api.x.ai/v1',
        moonshotApiKey: undefined,
      });

      expect(
        loadConfig({
          ...grokEnv,
          XAI_MODEL: 'grok-custom',
          XAI_BASE_URL: 'https://example.test/v1',
        }),
      ).toMatchObject({
        xaiModel: 'grok-custom',
        xaiBaseUrl: 'https://example.test/v1',
      });
    });
  });

  describe('LLM_PROVIDER_PROPOSE (ADR-0017, T38)', () => {
    it('defaults llmProviderPropose to LLM_PROVIDER when unset', () => {
      expect(loadConfig(validEnv)).toMatchObject({
        llmProvider: 'kimi',
        llmProviderPropose: 'kimi',
      });

      expect(
        loadConfig({
          APP_PASSWORD: 'a-valid-password',
          SESSION_SECRET: 'a-session-secret-that-is-at-least-32-chars',
          LLM_PROVIDER: 'grok',
          XAI_API_KEY: 'xai-test-key',
        }),
      ).toMatchObject({ llmProvider: 'grok', llmProviderPropose: 'grok' });
    });

    it('throws naming MOONSHOT_API_KEY and LLM_PROVIDER_PROPOSE when LLM_PROVIDER=grok, LLM_PROVIDER_PROPOSE=kimi and only XAI_API_KEY is set', () => {
      expect(() =>
        loadConfig({
          APP_PASSWORD: 'a-valid-password',
          SESSION_SECRET: 'a-session-secret-that-is-at-least-32-chars',
          LLM_PROVIDER: 'grok',
          XAI_API_KEY: 'xai-test-key',
          LLM_PROVIDER_PROPOSE: 'kimi',
        }),
      ).toThrow(/MOONSHOT_API_KEY.*LLM_PROVIDER_PROPOSE=kimi/);
    });

    it('passes with both keys and resolves llmProviderPropose to kimi', () => {
      const config = loadConfig({
        APP_PASSWORD: 'a-valid-password',
        SESSION_SECRET: 'a-session-secret-that-is-at-least-32-chars',
        LLM_PROVIDER: 'grok',
        XAI_API_KEY: 'xai-test-key',
        LLM_PROVIDER_PROPOSE: 'kimi',
        MOONSHOT_API_KEY: 'sk-test',
      });

      expect(config).toMatchObject({ llmProvider: 'grok', llmProviderPropose: 'kimi' });
    });

    it('rejects an invalid LLM_PROVIDER_PROPOSE value', () => {
      expect(() => loadConfig({ ...validEnv, LLM_PROVIDER_PROPOSE: 'gpt' })).toThrow(
        /LLM_PROVIDER_PROPOSE/,
      );
    });
  });
});
