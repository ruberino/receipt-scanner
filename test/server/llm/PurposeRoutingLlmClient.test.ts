import { describe, expect, it } from 'vitest';
import { FakeLlmClient } from '../../../src/server/llm/FakeLlmClient.ts';
import type {
  JsonCompletionRequest,
  JsonCompletionResult,
} from '../../../src/server/llm/LlmClient.ts';
import { PurposeRoutingLlmClient } from '../../../src/server/llm/PurposeRoutingLlmClient.ts';

const result: JsonCompletionResult = {
  text: '{}',
  finishReason: 'stop',
  model: 'kimi-k2.6',
  usage: { promptTokens: 1, completionTokens: 1 },
  durationMs: 10,
};

function request(overrides: Partial<JsonCompletionRequest> = {}): JsonCompletionRequest {
  return {
    purpose: 'extract',
    system: 'system',
    userText: 'user',
    maxTokens: 100,
    promptVersion: 1,
    ...overrides,
  };
}

describe('PurposeRoutingLlmClient', () => {
  it('sends extract and match to the fallback and propose to its override (ADR-0017)', async () => {
    const fallback = new FakeLlmClient([result, result]);
    const propose = new FakeLlmClient([result]);
    const client = new PurposeRoutingLlmClient({ fallback, byPurpose: { propose } });

    await client.completeJson(request({ purpose: 'extract' }));
    await client.completeJson(request({ purpose: 'match' }));
    await client.completeJson(request({ purpose: 'propose' }));

    expect(fallback.requests).toHaveLength(2);
    expect(fallback.requests.map((r) => r.purpose)).toEqual(['extract', 'match']);
    expect(propose.requests).toHaveLength(1);
    expect(propose.requests[0]?.purpose).toBe('propose');
  });

  it('sends every purpose to the fallback when byPurpose has no override for it', async () => {
    const fallback = new FakeLlmClient([result, result, result]);
    const client = new PurposeRoutingLlmClient({ fallback, byPurpose: {} });

    await client.completeJson(request({ purpose: 'extract' }));
    await client.completeJson(request({ purpose: 'match' }));
    await client.completeJson(request({ purpose: 'propose' }));

    expect(fallback.requests).toHaveLength(3);
  });

  it('clientFor reports the fallback for an unrouted purpose and the override for a routed one', () => {
    const fallback = new FakeLlmClient([]);
    const propose = new FakeLlmClient([]);
    const client = new PurposeRoutingLlmClient({ fallback, byPurpose: { propose } });

    expect(client.clientFor('extract')).toBe(fallback);
    expect(client.clientFor('match')).toBe(fallback);
    expect(client.clientFor('propose')).toBe(propose);
  });

  it("returns the underlying client's result unchanged", async () => {
    const propose = new FakeLlmClient([result]);
    const client = new PurposeRoutingLlmClient({
      fallback: new FakeLlmClient([]),
      byPurpose: { propose },
    });

    await expect(client.completeJson(request({ purpose: 'propose' }))).resolves.toEqual(result);
  });
});
