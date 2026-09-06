import { describe, expect, it } from 'vitest';
import { FakeLlmClient } from '../../../src/server/llm/FakeLlmClient.ts';
import type {
  JsonCompletionRequest,
  JsonCompletionResult,
} from '../../../src/server/llm/LlmClient.ts';

const request: JsonCompletionRequest = {
  purpose: 'extract',
  system: 'system',
  userText: 'user',
  maxTokens: 100,
  promptVersion: 1,
};

const result: JsonCompletionResult = {
  text: '{}',
  finishReason: 'stop',
  model: 'kimi-k2.6',
  usage: { promptTokens: 1, completionTokens: 1 },
  durationMs: 10,
};

describe('FakeLlmClient', () => {
  it('returns scripted results in order', async () => {
    const second: JsonCompletionResult = { ...result, text: '{"n":2}' };
    const client = new FakeLlmClient([result, second]);

    await expect(client.completeJson(request)).resolves.toEqual(result);
    await expect(client.completeJson(request)).resolves.toEqual(second);
  });

  it('supports a function entry that inspects the request', async () => {
    const client = new FakeLlmClient([
      (req) => ({ ...result, text: JSON.stringify({ purpose: req.purpose }) }),
    ]);

    const response = await client.completeJson(request);

    expect(response.text).toBe('{"purpose":"extract"}');
  });

  it('records every request it received', async () => {
    const client = new FakeLlmClient([result, result]);
    const secondRequest: JsonCompletionRequest = { ...request, purpose: 'match', receiptId: 7 };

    await client.completeJson(request);
    await client.completeJson(secondRequest);

    expect(client.requests).toEqual([request, secondRequest]);
  });

  it('throws a clear error when the script is exhausted', async () => {
    const client = new FakeLlmClient([result]);

    await client.completeJson(request);

    await expect(client.completeJson(request)).rejects.toThrow(/no scripted response left/);
  });

  it('throws immediately for an empty script', async () => {
    const client = new FakeLlmClient([]);

    await expect(client.completeJson(request)).rejects.toThrow(/no scripted response left/);
  });
});
