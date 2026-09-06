import type OpenAI from 'openai';
import { describe, expect, it, vi } from 'vitest';
import { ExtractionError } from '../../../src/server/lib/errors.ts';
import { KimiClient, buildRequestBody } from '../../../src/server/llm/KimiClient.ts';
import type { JsonCompletionRequest } from '../../../src/server/llm/LlmClient.ts';

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

describe('buildRequestBody', () => {
  it('puts the system message first, model, response_format, max_tokens and thinking as documented, with no temperature', () => {
    const body = buildRequestBody(baseRequest, { model: 'kimi-k2.6', thinking: 'disabled' });

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
      imageDataUrl: 'data:image/jpeg;base64,AAAA',
    };

    const body = buildRequestBody(withImage, { model: 'kimi-k2.6', thinking: 'disabled' });

    expect(body.messages[1].content).toEqual([
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } },
      { type: 'text', text: baseRequest.userText },
    ]);
  });

  it('sends only the text part when there is no image, e.g. for matching', () => {
    const matchRequest: JsonCompletionRequest = { ...baseRequest, purpose: 'match' };

    const body = buildRequestBody(matchRequest, { model: 'kimi-k2.6', thinking: 'disabled' });

    expect(body.messages[1].content).toEqual([{ type: 'text', text: baseRequest.userText }]);
  });

  it('passes the thinking mode through unchanged', () => {
    const body = buildRequestBody(baseRequest, { model: 'kimi-k2.6', thinking: 'enabled' });

    expect(body.thinking).toEqual({ type: 'enabled' });
  });
});

describe('KimiClient.completeJson', () => {
  const options = {
    apiKey: 'test-key',
    baseURL: 'https://api.moonshot.ai/v1',
    model: 'kimi-k2.6',
    thinking: 'disabled' as const,
    timeoutMs: 1000,
  };

  it('returns text, finishReason, model, usage and durationMs, and logs one ADR-0012 info line', async () => {
    const create = vi.fn().mockResolvedValue({
      model: 'kimi-k2.6',
      choices: [{ message: { content: '{"a":1}' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 12, completion_tokens: 8 },
    });
    const info = vi.fn();
    const client = new KimiClient({ ...options, client: stubClient(create), logger: { info } });

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
    const client = new KimiClient({
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

    const matchClient = new KimiClient({
      ...options,
      client: stubClient(vi.fn().mockRejectedValue(sdkError)),
      logger: { info: vi.fn() },
    });
    await expect(matchClient.completeJson({ ...baseRequest, purpose: 'match' })).rejects.toSatisfy(
      (error: unknown) => (error as ExtractionError).stage === 'matching',
    );
  });

  it('returns an empty text and finishReason "unknown" for a response with no choices', async () => {
    const create = vi.fn().mockResolvedValue({ model: 'kimi-k2.6', choices: [], usage: undefined });
    const client = new KimiClient({
      ...options,
      client: stubClient(create),
      logger: { info: vi.fn() },
    });

    const result = await client.completeJson(baseRequest);

    expect(result.text).toBe('');
    expect(result.finishReason).toBe('unknown');
  });
});
