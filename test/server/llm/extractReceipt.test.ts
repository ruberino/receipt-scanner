import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ExtractionError } from '../../../src/server/lib/errors.ts';
import { FakeLlmClient } from '../../../src/server/llm/FakeLlmClient.ts';
import {
  buildExtractionRequest,
  extractionResultSchema,
  parseExtraction,
  runExtraction,
} from '../../../src/server/llm/extractReceipt.ts';
import {
  EXTRACT_PROMPT_VERSION,
  EXTRACT_SYSTEM_PROMPT,
} from '../../../src/server/llm/prompts/extractReceipt.prompt.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(here, '..', '..', 'fixtures', 'llm');

async function readFixture(name: string): Promise<string> {
  return readFile(path.join(fixturesDir, name), 'utf-8');
}

describe('buildExtractionRequest', () => {
  it('builds a request with the documented system prompt, purpose and prompt version', () => {
    const request = buildExtractionRequest('data:image/jpeg;base64,AAAA', 7);

    expect(request.purpose).toBe('extract');
    expect(request.system).toBe(EXTRACT_SYSTEM_PROMPT);
    expect(request.imageDataUrl).toBe('data:image/jpeg;base64,AAAA');
    expect(request.promptVersion).toBe(EXTRACT_PROMPT_VERSION);
    expect(request.receiptId).toBe(7);
    expect(request.maxTokens).toBe(6000);
  });
});

describe('parseExtraction', () => {
  it('parses the REMA fixture with the fields as printed', async () => {
    const text = await readFixture('extract-rema.json');

    const result = parseExtraction(text);

    expect(result.storeName).toBe('REMA 1000 Grünerløkka');
    expect(result.purchasedAt).toBe('2026-09-03');
    expect(result.total).toBe(458.9);
    expect(result.lines).toHaveLength(4);
    expect(result.lines[0]).toEqual({
      text: 'TINE LETTMELK 1L',
      kind: 'item',
      quantity: 2,
      unit: 'stk',
      unitPrice: 50,
      totalPrice: 100,
    });
  });

  it('parses the comma-decimal fixture to the same numbers as the REMA fixture', async () => {
    const remaText = await readFixture('extract-rema.json');
    const commaText = await readFixture('extract-comma-decimals.json');

    const rema = parseExtraction(remaText);
    const comma = parseExtraction(commaText);

    expect(comma.total).toBe(rema.total);
    expect(comma.lines).toEqual(rema.lines);
  });

  it('defaults a missing purchasedAt to null', async () => {
    const text = await readFixture('extract-missing-date.json');

    const result = parseExtraction(text);

    expect(result.purchasedAt).toBeNull();
  });

  it('applies the documented lenient unit and kind conversions', async () => {
    const text = await readFixture('extract-odd-units.json');

    const result = parseExtraction(text);

    expect(result.lines[0]).toMatchObject({ quantity: 0.5, unit: 'kg' }); // 500 g
    expect(result.lines[1]).toMatchObject({ quantity: 0.5, unit: 'l' }); // 5 dl
    expect(result.lines[2]).toMatchObject({ quantity: 1, unit: null }); // 'pk'
    expect(result.lines[3]).toMatchObject({ kind: 'other' }); // 'refund'
  });

  it('keeps the parsed quantity when unit is null or missing, since null is a documented valid unit', () => {
    const parsed = extractionResultSchema.parse({
      storeName: null,
      purchasedAt: null,
      total: null,
      lines: [
        { text: 'A', kind: 'item', quantity: 2, unit: null, unitPrice: null, totalPrice: 10 },
        { text: 'B', kind: 'item', quantity: 3, unitPrice: null, totalPrice: 10 },
        { text: 'C', kind: 'item', quantity: 2, unit: 'pk', unitPrice: null, totalPrice: 10 },
      ],
    });

    expect(parsed.lines[0]).toMatchObject({ quantity: 2, unit: null });
    expect(parsed.lines[1]).toMatchObject({ quantity: 3, unit: null });
    expect(parsed.lines[2]).toMatchObject({ quantity: 1, unit: null });
  });

  it('truncates more than 200 lines instead of failing', () => {
    const lines = Array.from({ length: 201 }, (_, i) => ({
      text: `LINE ${i}`,
      kind: 'item',
      quantity: 1,
      unit: null,
      unitPrice: null,
      totalPrice: 1,
    }));

    const parsed = extractionResultSchema.parse({
      storeName: null,
      purchasedAt: null,
      total: null,
      lines,
    });

    expect(parsed.lines).toHaveLength(200);
  });

  it('excludes an other-kind footer line but keeps it in the lines array', async () => {
    const text = await readFixture('extract-footer-lines.json');

    const result = parseExtraction(text);

    expect(result.lines).toHaveLength(5);
    expect(result.lines[4]).toMatchObject({ kind: 'other', text: 'SUM 458,90' });
  });

  it('throws the documented message for malformed JSON', async () => {
    const text = await readFixture('extract-malformed.txt');

    expect(() => parseExtraction(text)).toThrow(ExtractionError);
    try {
      parseExtraction(text);
      expect.unreachable();
    } catch (error) {
      expect((error as ExtractionError).userMessage).toBe('Kunne ikke tolke svaret fra lesingen');
    }
  });

  it('fails only on a totalPrice that does not parse, a missing/empty text, or a non-array lines value', () => {
    const base = { storeName: null, purchasedAt: null, total: null };

    expect(
      extractionResultSchema.safeParse({
        ...base,
        lines: [
          {
            text: 'X',
            kind: 'item',
            quantity: 1,
            unit: null,
            unitPrice: null,
            totalPrice: 'not a number',
          },
        ],
      }).success,
    ).toBe(false);

    expect(
      extractionResultSchema.safeParse({
        ...base,
        lines: [
          { text: '', kind: 'item', quantity: 1, unit: null, unitPrice: null, totalPrice: 10 },
        ],
      }).success,
    ).toBe(false);

    expect(extractionResultSchema.safeParse({ ...base, lines: 'not an array' }).success).toBe(
      false,
    );

    // Everything else is lenient: unknown kind, bad quantity, unknown unit never fail.
    expect(
      extractionResultSchema.safeParse({
        ...base,
        lines: [
          {
            text: 'X',
            kind: 'weird',
            quantity: 'not a number',
            unit: 'weird',
            unitPrice: null,
            totalPrice: 10,
          },
        ],
      }).success,
    ).toBe(true);
  });
});

describe('runExtraction', () => {
  it('returns the result envelope with model, promptVersion and usage', async () => {
    const llm = new FakeLlmClient([
      {
        text: '{"storeName":null,"purchasedAt":null,"total":null,"lines":[{"text":"X","kind":"item","quantity":1,"unit":null,"unitPrice":null,"totalPrice":10}]}',
        finishReason: 'stop',
        model: 'kimi-k2.6',
        usage: { promptTokens: 10, completionTokens: 5 },
        durationMs: 20,
      },
    ]);

    const run = await runExtraction(llm, 'data:image/jpeg;base64,AAAA', 3);

    expect(run.result.lines).toHaveLength(1);
    expect(run.model).toBe('kimi-k2.6');
    expect(run.promptVersion).toBe(EXTRACT_PROMPT_VERSION);
    expect(run.usage).toEqual({ promptTokens: 10, completionTokens: 5 });
    expect(run.raw).toContain('"text":"X"');
    expect(llm.requests[0]?.receiptId).toBe(3);
  });

  it('throws the documented message when finishReason is "length"', async () => {
    const llm = new FakeLlmClient([
      {
        text: '{"lines":[]}',
        finishReason: 'length',
        model: 'kimi-k2.6',
        usage: { promptTokens: 1, completionTokens: 1 },
        durationMs: 1,
      },
    ]);

    await expect(runExtraction(llm, 'data:image/jpeg;base64,AAAA')).rejects.toMatchObject({
      userMessage: 'Kvitteringen var for lang til å leses',
      stage: 'extraction',
    });
  });
});
