import { describe, expect, it, vi } from 'vitest';
import { ProposalFailedError } from '../../../src/server/lib/errors.ts';
import { FakeLlmClient } from '../../../src/server/llm/FakeLlmClient.ts';
import { buildProposalRequest, runProposal } from '../../../src/server/llm/proposeList.ts';
import {
  PROPOSE_PROMPT_VERSION,
  PROPOSE_SYSTEM_PROMPT,
} from '../../../src/server/llm/prompts/proposeList.prompt.ts';
import type {
  ProposalContext,
  ProposalContextProduct,
} from '../../../src/server/domain/proposalContext.ts';

function product(overrides: Partial<ProposalContextProduct> = {}): ProposalContextProduct {
  return {
    id: 1,
    name: 'Lettmelk 1 l',
    category: 'Meieri',
    purchases: ['2026-08-20 x1'],
    lastPurchaseDate: '2026-08-20',
    onList: false,
    dismissed: false,
    rejected: false,
    ...overrides,
  };
}

function context(overrides: Partial<ProposalContext> = {}): ProposalContext {
  return {
    today: '2026-09-07',
    weekday: 'mandag',
    isoWeek: '2026-W37',
    calendarEvents: [],
    products: [product()],
    listItems: [],
    ...overrides,
  };
}

function completion(
  items: unknown[],
  overrides: Partial<{ finishReason: string; text: string }> = {},
) {
  return {
    text: overrides.text ?? JSON.stringify({ items }),
    finishReason: overrides.finishReason ?? 'stop',
    model: 'grok-4.6',
    usage: { promptTokens: 500, completionTokens: 200 },
    durationMs: 800,
  };
}

const validItem = {
  productId: 1,
  name: 'Lettmelk 1 l',
  category: 'Meieri',
  quantityText: '2 stk',
  reason: 'Kjøpes normalt hver uke',
  kind: 'vane',
};

describe('buildProposalRequest', () => {
  it('builds a request with the documented system prompt, purpose, prompt version, listId and userText', () => {
    const ctx = context();

    const request = buildProposalRequest(ctx, 9);

    expect(request.purpose).toBe('propose');
    expect(request.system).toBe(PROPOSE_SYSTEM_PROMPT);
    expect(request.promptVersion).toBe(PROPOSE_PROMPT_VERSION);
    expect(request.listId).toBe(9);
    expect(request.maxTokens).toBe(4000);
    expect(request.userText).toBe(JSON.stringify(ctx));
  });
});

describe('runProposal', () => {
  it('returns the filtered items with sequential index, model, usage and durationMs', async () => {
    const llm = new FakeLlmClient([completion([validItem])]);

    const result = await runProposal(llm, context(), 9);

    expect(result.items).toEqual([
      {
        index: 0,
        productId: 1,
        name: 'Lettmelk 1 l',
        category: 'Meieri',
        quantityText: '2 stk',
        reason: 'Kjøpes normalt hver uke',
        kind: 'vane',
      },
    ]);
    expect(result.model).toBe('grok-4.6');
    expect(result.promptVersion).toBe(PROPOSE_PROMPT_VERSION);
    expect(result.promptTokens).toBe(500);
    expect(result.completionTokens).toBe(200);
    expect(result.durationMs).toBe(800);
    expect(result.rawResponse).toBe(JSON.stringify({ items: [validItem] }));
    expect(llm.requests[0]?.listId).toBe(9);
  });

  it('accepts a new item with productId null', async () => {
    const llm = new FakeLlmClient([
      completion([{ ...validItem, productId: null, name: 'Godteri', category: 'Snacks' }]),
    ]);

    const result = await runProposal(llm, context(), 9);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.productId).toBeNull();
  });

  it('throws ProposalFailedError with the caught error as cause when the call itself fails, warning once (F1)', async () => {
    const llm = new FakeLlmClient([]);
    const warn = vi.fn();

    await expect(runProposal(llm, context(), 9, { warn })).rejects.toMatchObject({
      cause: expect.any(Error),
    });
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toMatchObject({
      listId: 9,
      stage: 'client',
      err: expect.any(Error),
    });
  });

  it('throws ProposalFailedError with { finishReason } as cause when the answer is cut off, warning once (F1)', async () => {
    const llm = new FakeLlmClient([completion([validItem], { finishReason: 'length' })]);
    const warn = vi.fn();

    await expect(runProposal(llm, context(), 9, { warn })).rejects.toMatchObject({
      cause: { finishReason: 'length' },
    });
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toMatchObject({ listId: 9, stage: 'length' });
  });

  it('throws ProposalFailedError with the parse error as cause when the answer is not valid JSON, warning once (F1)', async () => {
    const llm = new FakeLlmClient([completion([], { text: 'not json' })]);
    const warn = vi.fn();

    await expect(runProposal(llm, context(), 9, { warn })).rejects.toMatchObject({
      cause: expect.any(Error),
    });
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toMatchObject({
      listId: 9,
      stage: 'parse',
      err: expect.any(Error),
    });
  });

  it('throws ProposalFailedError with zod issue path/code (never the model text) as cause when the schema does not match, warning once (F1)', async () => {
    const llm = new FakeLlmClient([completion([{ name: 'a very telling model answer' }])]);
    const warn = vi.fn();

    const error = await runProposal(llm, context(), 9, { warn }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProposalFailedError);
    const cause = (error as ProposalFailedError).cause as { path: unknown; code: unknown }[];
    expect(Array.isArray(cause)).toBe(true);
    expect(cause.length).toBeGreaterThan(0);
    expect(
      cause.every((issue) => Array.isArray(issue.path) && typeof issue.code === 'string'),
    ).toBe(true);
    expect(JSON.stringify(cause)).not.toContain('a very telling model answer');
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toMatchObject({ listId: 9, stage: 'schema' });
  });

  it('drops an item with an unknown productId and warns once with the count', async () => {
    const llm = new FakeLlmClient([completion([{ ...validItem, productId: 999 }])]);
    const warn = vi.fn();

    const result = await runProposal(llm, context(), 9, { warn });

    expect(result.items).toEqual([]);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toMatchObject({ listId: 9, droppedUnknown: 1 });
  });

  it('drops an item with an unknown category', async () => {
    const llm = new FakeLlmClient([completion([{ ...validItem, category: 'Ukjent' }])]);

    const result = await runProposal(llm, context(), 9);

    expect(result.items).toEqual([]);
  });

  it('de-duplicates by normalised name, keeping the first', async () => {
    const llm = new FakeLlmClient([
      completion([
        { ...validItem, productId: null, name: 'Godteri', category: 'Snacks' },
        { ...validItem, productId: null, name: '  godteri  ', category: 'Snacks' },
      ]),
    ]);

    const result = await runProposal(llm, context(), 9);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.name).toBe('Godteri');
  });

  it('filters out a product flagged onList, dismissed or rejected', async () => {
    const llm = new FakeLlmClient([
      completion([
        { ...validItem, productId: 1 },
        { ...validItem, productId: 2, name: 'Havregryn' },
        { ...validItem, productId: 3, name: 'Safran' },
      ]),
    ]);
    const ctx = context({
      products: [
        product({ id: 1, onList: true }),
        product({ id: 2, name: 'Havregryn', dismissed: true }),
        product({ id: 3, name: 'Safran', rejected: true }),
      ],
    });

    const result = await runProposal(llm, ctx, 9);

    expect(result.items).toEqual([]);
  });

  it('filters out a product whose most recent purchase was today or yesterday', async () => {
    const llm = new FakeLlmClient([
      completion([
        { ...validItem, productId: 1, name: 'Kjøpt i dag' },
        { ...validItem, productId: 2, name: 'Kjøpt i går' },
      ]),
    ]);
    const ctx = context({
      today: '2026-09-07',
      products: [
        product({ id: 1, name: 'Kjøpt i dag', lastPurchaseDate: '2026-09-07' }),
        product({ id: 2, name: 'Kjøpt i går', lastPurchaseDate: '2026-09-06' }),
      ],
    });

    const result = await runProposal(llm, ctx, 9);

    expect(result.items).toEqual([]);
  });

  it('filters out a new item whose name collides with an item already on the list', async () => {
    const llm = new FakeLlmClient([
      completion([{ ...validItem, productId: null, name: 'Godteri', category: 'Snacks' }]),
    ]);
    const ctx = context({ listItems: ['godteri'] });

    const result = await runProposal(llm, ctx, 9);

    expect(result.items).toEqual([]);
  });

  it('caps the result at 15 items', async () => {
    const items = Array.from({ length: 20 }, (_, i) => ({
      ...validItem,
      productId: null,
      name: `Vare ${i}`,
    }));
    const llm = new FakeLlmClient([completion(items)]);

    const result = await runProposal(llm, context(), 9);

    expect(result.items).toHaveLength(15);
    expect(result.items.map((item) => item.index)).toEqual(Array.from({ length: 15 }, (_, i) => i));
  });
});
