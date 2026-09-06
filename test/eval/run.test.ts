import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeLlmClient } from '../../src/server/llm/FakeLlmClient.ts';
import type { JsonCompletionResult } from '../../src/server/llm/LlmClient.ts';
import { bootstrapExpected, runEval } from '../../eval/run.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PHOTO = path.resolve(here, '..', 'fixtures', 'images', 'receipt-small.jpg');

function fakeCompletion(text: string): JsonCompletionResult {
  return {
    text,
    finishReason: 'stop',
    model: 'kimi-k2.6',
    usage: { promptTokens: 500, completionTokens: 300 },
    durationMs: 5,
  };
}

const BASIC_EXTRACTION = JSON.stringify({
  storeName: 'KIWI Torshov',
  purchasedAt: '2026-09-03',
  total: 250,
  lines: [
    {
      text: 'TINE LETTMELK 1L',
      kind: 'item',
      quantity: 1,
      unit: null,
      unitPrice: null,
      totalPrice: 100,
    },
    { text: 'BANAN', kind: 'item', quantity: 1, unit: null, unitPrice: null, totalPrice: 150 },
  ],
});

function basicExpectedJson(): string {
  return JSON.stringify({
    storeName: 'Kiwi',
    purchasedAt: '2026-09-03',
    total: 250,
    items: [
      { text: 'TINE LETTMELK 1L', totalPrice: 100 },
      { text: 'BANAN', totalPrice: 150 },
    ],
  });
}

describe('runEval', () => {
  let dir: string;
  let receiptsDir: string;
  let resultsDir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'eval-test-'));
    receiptsDir = path.join(dir, 'receipts');
    resultsDir = path.join(dir, 'results');
    await mkdir(receiptsDir, { recursive: true });
    await mkdir(resultsDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('processes only photos with a matching .expected.json, skipping the rest', async () => {
    await copyFile(FIXTURE_PHOTO, path.join(receiptsDir, 'a.jpg'));
    await writeFile(path.join(receiptsDir, 'a.jpg.expected.json'), basicExpectedJson());
    // No expected JSON for this one: must be skipped, not error.
    await copyFile(FIXTURE_PHOTO, path.join(receiptsDir, 'b.jpg'));
    // A draft must never be treated as ground truth.
    await writeFile(path.join(receiptsDir, 'b.jpg.expected.draft.json'), '{}');

    const llm = new FakeLlmClient([fakeCompletion(BASIC_EXTRACTION)]);

    const results = await runEval({
      llm,
      receiptsDir,
      resultsDir,
      promptVersion: 1,
      now: () => new Date('2026-09-10T00:00:00.000Z'),
    });

    expect(llm.requests).toHaveLength(1);
    expect(results.receipts).toEqual([
      {
        filename: 'a.jpg',
        dateMatch: true,
        storeMatch: true,
        totalWithin1kr: true,
        itemRecall: 1,
        priceAccuracy: 1,
        lineCountDiff: 0,
        promptTokens: 500,
        completionTokens: 300,
        durationMs: expect.any(Number),
      },
    ]);
    expect(results.aggregate.receiptCount).toBe(1);
    expect(results.model).toBe('kimi-k2.6');
    expect(results.date).toBe('2026-09-10');

    const resultFile = path.join(resultsDir, '2026-09-10-v1-kimi-k2.6.json');
    const written = JSON.parse(await readFile(resultFile, 'utf-8')) as unknown;
    expect(written).toEqual(results);
    // Privacy: results hold only numbers/booleans/filename/tokens/duration/model/promptVersion,
    // never the extracted store name or item texts as text.
    const serialised = JSON.stringify(written);
    expect(serialised).not.toContain('KIWI');
    expect(serialised).not.toContain('LETTMELK');
  });

  it('returns no receipts and writes nothing when no photo has a matching .expected.json', async () => {
    await copyFile(FIXTURE_PHOTO, path.join(receiptsDir, 'a.jpg'));

    const llm = new FakeLlmClient([]);
    const results = await runEval({ llm, receiptsDir, resultsDir });

    expect(llm.requests).toHaveLength(0);
    expect(results.receipts).toEqual([]);
    expect(await readdir(resultsDir)).toEqual([]);
  });

  it('returns no receipts when the receipts directory does not exist', async () => {
    const llm = new FakeLlmClient([]);
    const results = await runEval({
      llm,
      receiptsDir: path.join(dir, 'does-not-exist'),
      resultsDir,
    });

    expect(results.receipts).toEqual([]);
  });
});

describe('bootstrapExpected', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'eval-bootstrap-test-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes a .expected.draft.json with only the item lines', async () => {
    const photoPath = path.join(dir, 'a.jpg');
    await copyFile(FIXTURE_PHOTO, photoPath);
    const withDeposit = JSON.stringify({
      storeName: 'KIWI Torshov',
      purchasedAt: '2026-09-03',
      total: 250,
      lines: [
        {
          text: 'TINE LETTMELK 1L',
          kind: 'item',
          quantity: 1,
          unit: null,
          unitPrice: null,
          totalPrice: 100,
        },
        { text: 'PANT', kind: 'deposit', quantity: 1, unit: null, unitPrice: null, totalPrice: 10 },
      ],
    });
    const llm = new FakeLlmClient([fakeCompletion(withDeposit)]);

    const draftPath = await bootstrapExpected(llm, photoPath);

    expect(draftPath).toBe(`${photoPath}.expected.draft.json`);
    const draft = JSON.parse(await readFile(draftPath, 'utf-8')) as unknown;
    expect(draft).toEqual({
      storeName: 'KIWI Torshov',
      purchasedAt: '2026-09-03',
      total: 250,
      items: [{ text: 'TINE LETTMELK 1L', totalPrice: 100 }],
    });
  });

  it('never gets picked up by runEval as ground truth', async () => {
    const receiptsDir = path.join(dir, 'receipts');
    const resultsDir = path.join(dir, 'results');
    await mkdir(receiptsDir, { recursive: true });
    await mkdir(resultsDir, { recursive: true });
    const photoPath = path.join(receiptsDir, 'a.jpg');
    await copyFile(FIXTURE_PHOTO, photoPath);
    const bootstrapLlm = new FakeLlmClient([fakeCompletion(BASIC_EXTRACTION)]);
    await bootstrapExpected(bootstrapLlm, photoPath);

    const runLlm = new FakeLlmClient([]);
    const results = await runEval({ llm: runLlm, receiptsDir, resultsDir });

    expect(runLlm.requests).toHaveLength(0);
    expect(results.receipts).toEqual([]);
  });
});
