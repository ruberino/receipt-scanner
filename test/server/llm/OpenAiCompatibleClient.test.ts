import OpenAI from 'openai';
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../../src/server/config.ts';
import { ExtractionError } from '../../../src/server/lib/errors.ts';
import {
  OpenAiCompatibleClient,
  activeModels,
  buildRequestBody,
  createLlmClient,
} from '../../../src/server/llm/OpenAiCompatibleClient.ts';
import type { PurposeRoutingLlmClient } from '../../../src/server/llm/PurposeRoutingLlmClient.ts';
import type { JsonCompletionRequest } from '../../../src/server/llm/LlmClient.ts';

vi.mock('openai', () => ({ default: vi.fn() }));

type StubChatClient = Pick<OpenAI, 'chat'>;

function stubClient(create: (...args: unknown[]) => unknown): StubChatClient {
  return { chat: { completions: { create } } } as unknown as StubChatClient;
}

const baseRequest: JsonCompletionRequest = {
  purpose: 'extract',
  system: 'You read Norwegian grocery receipts.',
  userText: 'Read this receipt.',
  maxTokens: 6000,
  promptVersion: 1,
  receiptId: 42,
};

const baseEnv: Record<string, string> = {
  APP_PASSWORD: 'a-valid-password',
  SESSION_SECRET: 'a-session-secret-that-is-at-least-32-chars',
};

describe('buildRequestBody', () => {
  it('puts the system message first, model, response_format, max_tokens and thinking as documented, with no temperature', () => {
    const body = buildRequestBody(baseRequest, {
      provider: 'kimi',
      model: 'kimi-k2.6',
      thinking: 'disabled',
    });

    expect(body.model).toBe('kimi-k2.6');
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.max_tokens).toBe(6000);
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body).not.toHaveProperty('temperature');
    expect(body.messages[0]).toEqual({ role: 'system', content: baseRequest.system });
  });

  it('puts the image part before the text part when an image is present', () => {
    const withImage: JsonCompletionRequest = {
      ...baseRequest,
      imageDataUrls: ['data:image/jpeg;base64,AAAA'],
    };

    const body = buildRequestBody(withImage, {
      provider: 'kimi',
      model: 'kimi-k2.6',
      thinking: 'disabled',
    });

    expect(body.messages[1].content).toEqual([
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } },
      { type: 'text', text: baseRequest.userText },
    ]);
  });

  it('sends one image_url part per segment, in order, before the text part (T28)', () => {
    const withSegments: JsonCompletionRequest = {
      ...baseRequest,
      imageDataUrls: ['data:image/jpeg;base64,SEG1', 'data:image/jpeg;base64,SEG2'],
    };

    const body = buildRequestBody(withSegments, {
      provider: 'kimi',
      model: 'kimi-k2.6',
      thinking: 'disabled',
    });

    expect(body.messages[1].content).toEqual([
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,SEG1' } },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,SEG2' } },
      { type: 'text', text: baseRequest.userText },
    ]);
  });

  it('sends only the text part when there is no image, e.g. for matching', () => {
    const matchRequest: JsonCompletionRequest = { ...baseRequest, purpose: 'match' };

    const body = buildRequestBody(matchRequest, {
      provider: 'kimi',
      model: 'kimi-k2.6',
      thinking: 'disabled',
    });

    expect(body.messages[1].content).toEqual([{ type: 'text', text: baseRequest.userText }]);
  });

  it('sends only the text part for a propose request, text-only like matching (T37)', () => {
    const proposeRequest: JsonCompletionRequest = {
      ...baseRequest,
      purpose: 'propose',
      receiptId: undefined,
      listId: 7,
    };

    const body = buildRequestBody(proposeRequest, {
      provider: 'kimi',
      model: 'kimi-k2.6',
      thinking: 'disabled',
    });

    expect(body.messages[1].content).toEqual([{ type: 'text', text: baseRequest.userText }]);
  });

  it('passes the thinking mode through unchanged for kimi', () => {
    const body = buildRequestBody(baseRequest, {
      provider: 'kimi',
      model: 'kimi-k2.6',
      thinking: 'enabled',
    });

    expect(body.thinking).toEqual({ type: 'enabled' });
  });

  it('sends no thinking field at all for grok, even if one is passed in (T27)', () => {
    const body = buildRequestBody(baseRequest, {
      provider: 'grok',
      model: 'grok-4.6',
      thinking: 'enabled',
    });

    expect(body).not.toHaveProperty('thinking');
  });
});

describe('OpenAiCompatibleClient.completeJson', () => {
  const options = {
    provider: 'kimi' as const,
    apiKey: 'test-key',
    baseURL: 'https://api.moonshot.ai/v1',
    model: 'kimi-k2.6',
    thinking: 'disabled' as const,
    timeoutMs: 1000,
    maxRetries: 0,
  };

  it('returns text, finishReason, model, usage and durationMs, and logs one ADR-0012 info line', async () => {
    const create = vi.fn().mockResolvedValue({
      model: 'kimi-k2.6',
      choices: [{ message: { content: '{"a":1}' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 12, completion_tokens: 8 },
    });
    const info = vi.fn();
    const client = new OpenAiCompatibleClient({
      ...options,
      client: stubClient(create),
      logger: { info },
    });

    const result = await client.completeJson(baseRequest);

    expect(result.text).toBe('{"a":1}');
    expect(result.finishReason).toBe('stop');
    expect(result.model).toBe('kimi-k2.6');
    expect(result.usage).toEqual({ promptTokens: 12, completionTokens: 8 });
    expect(typeof result.durationMs).toBe('number');

    expect(info).toHaveBeenCalledTimes(1);
    const [logged] = info.mock.calls[0] as [Record<string, unknown>];
    expect(logged).toMatchObject({
      purpose: baseRequest.purpose,
      receiptId: baseRequest.receiptId,
      model: 'kimi-k2.6',
      promptVersion: baseRequest.promptVersion,
      promptTokens: 12,
      completionTokens: 8,
      finishReason: 'stop',
    });
    expect(typeof logged.durationMs).toBe('number');
  });

  it('maps a rejecting client to ExtractionError with the section 7.3 message, the stage from purpose, and the original error as cause', async () => {
    const sdkError = new Error('rate limited');
    const client = new OpenAiCompatibleClient({
      ...options,
      client: stubClient(vi.fn().mockRejectedValue(sdkError)),
      logger: { info: vi.fn() },
    });

    await expect(client.completeJson(baseRequest)).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(ExtractionError);
      const extractionError = error as ExtractionError;
      expect(extractionError.userMessage).toBe('Lesetjenesten er utilgjengelig, prøv igjen senere');
      expect(extractionError.stage).toBe('extraction');
      expect(extractionError.cause).toBe(sdkError);
      return true;
    });

    const matchClient = new OpenAiCompatibleClient({
      ...options,
      client: stubClient(vi.fn().mockRejectedValue(sdkError)),
      logger: { info: vi.fn() },
    });
    await expect(matchClient.completeJson({ ...baseRequest, purpose: 'match' })).rejects.toSatisfy(
      (error: unknown) => (error as ExtractionError).stage === 'matching',
    );

    const proposeClient = new OpenAiCompatibleClient({
      ...options,
      client: stubClient(vi.fn().mockRejectedValue(sdkError)),
      logger: { info: vi.fn() },
    });
    await expect(
      proposeClient.completeJson({ ...baseRequest, purpose: 'propose' }),
    ).rejects.toSatisfy((error: unknown) => (error as ExtractionError).stage === 'proposal');
  });

  it('logs listId instead of receiptId for a propose call (T37)', async () => {
    const create = vi.fn().mockResolvedValue({
      model: 'grok-4.6',
      choices: [{ message: { content: '{"items":[]}' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    });
    const info = vi.fn();
    const client = new OpenAiCompatibleClient({
      ...options,
      client: stubClient(create),
      logger: { info },
    });

    await client.completeJson({
      ...baseRequest,
      purpose: 'propose',
      receiptId: undefined,
      listId: 7,
    });

    const [logged] = info.mock.calls[0] as [Record<string, unknown>];
    expect(logged).toMatchObject({ purpose: 'propose', listId: 7 });
  });

  it('returns an empty text and finishReason "unknown" for a response with no choices', async () => {
    const create = vi.fn().mockResolvedValue({ model: 'kimi-k2.6', choices: [], usage: undefined });
    const client = new OpenAiCompatibleClient({
      ...options,
      client: stubClient(create),
      logger: { info: vi.fn() },
    });

    const result = await client.completeJson(baseRequest);

    expect(result.text).toBe('');
    expect(result.finishReason).toBe('unknown');
  });

  it('sends no thinking field on the wire for a grok client', async () => {
    const create = vi.fn().mockResolvedValue({
      model: 'grok-4.6',
      choices: [{ message: { content: '{}' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
    const client = new OpenAiCompatibleClient({
      provider: 'grok',
      apiKey: 'xai-test-key',
      baseURL: 'https://api.x.ai/v1',
      model: 'grok-4.6',
      timeoutMs: 1000,
      maxRetries: 0,
      client: stubClient(create),
      logger: { info: vi.fn() },
    });

    await client.completeJson(baseRequest);

    const [sentBody] = create.mock.calls[0] as [Record<string, unknown>];
    expect(sentBody).not.toHaveProperty('thinking');
    expect(sentBody.model).toBe('grok-4.6');
  });
});

describe('OpenAiCompatibleClient constructor', () => {
  it('constructs the OpenAI SDK client with the configured maxRetries (T27)', () => {
    vi.mocked(OpenAI).mockClear();

    new OpenAiCompatibleClient({
      provider: 'kimi',
      apiKey: 'test-key',
      baseURL: 'https://api.moonshot.ai/v1',
      model: 'kimi-k2.6',
      thinking: 'disabled',
      timeoutMs: 1000,
      maxRetries: 5,
      logger: { info: vi.fn() },
    });

    expect(OpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'test-key',
        baseURL: 'https://api.moonshot.ai/v1',
        timeout: 1000,
        maxRetries: 5,
      }),
    );
  });

  it('does not construct an OpenAI SDK client at all when a stub client is provided', () => {
    vi.mocked(OpenAI).mockClear();

    new OpenAiCompatibleClient({
      provider: 'kimi',
      apiKey: 'test-key',
      baseURL: 'https://api.moonshot.ai/v1',
      model: 'kimi-k2.6',
      timeoutMs: 1000,
      maxRetries: 0,
      client: stubClient(vi.fn()),
      logger: { info: vi.fn() },
    });

    expect(OpenAI).not.toHaveBeenCalled();
  });
});

describe('activeModels', () => {
  it('reports the kimi model for both when LLM_PROVIDER=kimi (the default) and LLM_PROVIDER_PROPOSE is unset', () => {
    const config = loadConfig({ ...baseEnv, MOONSHOT_API_KEY: 'sk-kimi' });
    expect(activeModels(config)).toEqual({ model: 'kimi-k2.6', proposalModel: 'kimi-k2.6' });
  });

  it('reports the grok model for both when LLM_PROVIDER=grok and LLM_PROVIDER_PROPOSE is unset', () => {
    const config = loadConfig({ ...baseEnv, LLM_PROVIDER: 'grok', XAI_API_KEY: 'xai-test' });
    expect(activeModels(config)).toEqual({ model: 'grok-4.6', proposalModel: 'grok-4.6' });
  });

  it('reports differing models when LLM_PROVIDER and LLM_PROVIDER_PROPOSE differ (ADR-0017)', () => {
    const config = loadConfig({
      ...baseEnv,
      LLM_PROVIDER: 'grok',
      XAI_API_KEY: 'xai-test',
      LLM_PROVIDER_PROPOSE: 'kimi',
      MOONSHOT_API_KEY: 'sk-kimi',
    });
    expect(activeModels(config)).toEqual({ model: 'grok-4.6', proposalModel: 'kimi-k2.6' });
  });
});

describe('createLlmClient', () => {
  function clientFor(client: ReturnType<typeof createLlmClient>, purpose: 'extract' | 'propose') {
    return (client as PurposeRoutingLlmClient).clientFor(purpose) as OpenAiCompatibleClient;
  }

  it('builds a kimi client with the kimi settings, thinking included, for both purposes', () => {
    const config = loadConfig({
      ...baseEnv,
      MOONSHOT_API_KEY: 'sk-kimi',
      KIMI_MODEL: 'kimi-k3',
      KIMI_THINKING: 'enabled',
    });

    const client = createLlmClient(config, { info: vi.fn() });

    const extractClient = clientFor(client, 'extract');
    expect(extractClient).toBeInstanceOf(OpenAiCompatibleClient);
    expect(extractClient.provider).toBe('kimi');
    expect(extractClient.model).toBe('kimi-k3');
    expect(clientFor(client, 'propose')).toBe(extractClient);
  });

  it('builds a grok client with the grok settings, for both purposes', () => {
    const config = loadConfig({
      ...baseEnv,
      LLM_PROVIDER: 'grok',
      XAI_API_KEY: 'xai-test',
      XAI_MODEL: 'grok-custom',
    });

    const client = createLlmClient(config, { info: vi.fn() });

    const extractClient = clientFor(client, 'extract');
    expect(extractClient).toBeInstanceOf(OpenAiCompatibleClient);
    expect(extractClient.provider).toBe('grok');
    expect(extractClient.model).toBe('grok-custom');
    expect(clientFor(client, 'propose')).toBe(extractClient);
  });

  it('routes extract/match to LLM_PROVIDER and propose to LLM_PROVIDER_PROPOSE when they differ (ADR-0017, T38)', () => {
    const config = loadConfig({
      ...baseEnv,
      LLM_PROVIDER: 'grok',
      XAI_API_KEY: 'xai-test',
      LLM_PROVIDER_PROPOSE: 'kimi',
      MOONSHOT_API_KEY: 'sk-kimi',
      KIMI_MODEL: 'kimi-k3',
    });

    const client = createLlmClient(config, { info: vi.fn() });

    const extractClient = clientFor(client, 'extract');
    const proposeClient = clientFor(client, 'propose');
    expect(extractClient.provider).toBe('grok');
    expect(extractClient.model).toBe('grok-4.6');
    expect(proposeClient.provider).toBe('kimi');
    expect(proposeClient.model).toBe('kimi-k3');
    expect(proposeClient).not.toBe(extractClient);
  });
});
