import { describe, expect, it } from 'vitest';
import { buildRequestBody } from '../../../src/server/llm/KimiClient.ts';
import type { JsonCompletionRequest } from '../../../src/server/llm/LlmClient.ts';

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
