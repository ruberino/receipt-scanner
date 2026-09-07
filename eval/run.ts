import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pino from 'pino';
import { loadConfig } from '../src/server/config.ts';
import { normaliseImage } from '../src/server/lib/images.ts';
import { runExtraction } from '../src/server/llm/extractReceipt.ts';
import { EXTRACT_PROMPT_VERSION } from '../src/server/llm/prompts/extractReceipt.prompt.ts';
import { createLlmClient } from '../src/server/llm/OpenAiCompatibleClient.ts';
import type { LlmClient } from '../src/server/llm/LlmClient.ts';
import {
  aggregateMetrics,
  computeReceiptMetrics,
  type AggregateMetrics,
  type ExpectedReceipt,
  type ReceiptMetrics,
} from './metrics.ts';

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const EXPECTED_SUFFIX = '.expected.json';
const DRAFT_SUFFIX = '.expected.draft.json';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_RECEIPTS_DIR = path.resolve(here, 'receipts');
const DEFAULT_RESULTS_DIR = path.resolve(here, 'results');

/**
 * Numbers and booleans only, keyed by filename: no extracted text, store name or amounts as text,
 * so a results file is safe to commit as the regression record without leaking what the household
 * bought, even though the photos themselves (eval/receipts/*.jpg) stay private and gitignored.
 */
type ReceiptResultRow = ReceiptMetrics & {
  filename: string;
  promptTokens: number;
  completionTokens: number;
  durationMs: number;
};

export type EvalResults = {
  date: string;
  promptVersion: number;
  model: string;
  receipts: ReceiptResultRow[];
  aggregate: AggregateMetrics;
};

async function loadExpected(filePath: string): Promise<ExpectedReceipt> {
  const raw = await readFile(filePath, 'utf-8');
  return JSON.parse(raw) as ExpectedReceipt;
}

export async function listPhotosWithExpected(
  receiptsDir: string,
): Promise<{ filename: string; photoPath: string; expectedPath: string }[]> {
  let entries: string[];
  try {
    entries = await readdir(receiptsDir);
  } catch {
    return [];
  }

  const photos = entries.filter((entry) => IMAGE_EXTENSIONS.has(path.extname(entry).toLowerCase()));
  const pairs: { filename: string; photoPath: string; expectedPath: string }[] = [];
  for (const filename of photos.sort()) {
    const expectedPath = path.join(receiptsDir, `${filename}${EXPECTED_SUFFIX}`);
    try {
      await readFile(expectedPath, 'utf-8');
    } catch {
      continue;
    }
    pairs.push({ filename, photoPath: path.join(receiptsDir, filename), expectedPath });
  }
  return pairs;
}

async function extractPhoto(llm: LlmClient, photoPath: string) {
  const buffer = await readFile(photoPath);
  const normalised = await normaliseImage(buffer);
  const imageDataUrl = `data:image/jpeg;base64,${normalised.bytes.toString('base64')}`;
  return runExtraction(llm, imageDataUrl);
}

export type RunEvalOptions = {
  llm: LlmClient;
  receiptsDir?: string;
  resultsDir?: string;
  promptVersion?: number;
  now?: () => Date;
};

export async function runEval(options: RunEvalOptions): Promise<EvalResults> {
  const receiptsDir = options.receiptsDir ?? DEFAULT_RECEIPTS_DIR;
  const resultsDir = options.resultsDir ?? DEFAULT_RESULTS_DIR;
  const promptVersion = options.promptVersion ?? EXTRACT_PROMPT_VERSION;
  const now = options.now ?? (() => new Date());

  const pairs = await listPhotosWithExpected(receiptsDir);
  if (pairs.length === 0) {
    console.log(
      `No receipt has a matching ${EXPECTED_SUFFIX} file in ${receiptsDir}; nothing to run.`,
    );
  }

  const rows: ReceiptResultRow[] = [];
  let model = '';
  for (const pair of pairs) {
    const expected = await loadExpected(pair.expectedPath);
    const startedAt = Date.now();
    const extraction = await extractPhoto(options.llm, pair.photoPath);
    const durationMs = Date.now() - startedAt;
    model = extraction.model;

    const metrics = computeReceiptMetrics(expected, extraction.result);
    rows.push({
      filename: pair.filename,
      ...metrics,
      promptTokens: extraction.usage.promptTokens,
      completionTokens: extraction.usage.completionTokens,
      durationMs,
    });
  }

  printTable(rows);
  const aggregate = aggregateMetrics(rows);
  printAggregate(aggregate);

  const date = now().toISOString().slice(0, 10);
  const results: EvalResults = { date, promptVersion, model, receipts: rows, aggregate };

  if (rows.length > 0) {
    const resultsPath = path.join(resultsDir, `${date}-v${promptVersion}-${model}.json`);
    await writeFile(resultsPath, `${JSON.stringify(results, null, 2)}\n`, 'utf-8');
    console.log(`\nWrote ${resultsPath}`);
  }

  return results;
}

function printTable(rows: ReceiptResultRow[]): void {
  console.table(
    rows.map((row) => ({
      filename: row.filename,
      dateMatch: row.dateMatch,
      storeMatch: row.storeMatch,
      totalWithin1kr: row.totalWithin1kr,
      itemRecall: row.itemRecall.toFixed(2),
      priceAccuracy: row.priceAccuracy.toFixed(2),
      lineCountDiff: row.lineCountDiff,
      tokens: row.promptTokens + row.completionTokens,
      durationMs: row.durationMs,
    })),
  );
}

function printAggregate(aggregate: AggregateMetrics): void {
  console.log('\nAggregate:');
  console.log(`  receipts:            ${aggregate.receiptCount}`);
  console.log(`  dateMatchRate:       ${(aggregate.dateMatchRate * 100).toFixed(1)}%`);
  console.log(`  storeMatchRate:      ${(aggregate.storeMatchRate * 100).toFixed(1)}%`);
  console.log(`  totalWithin1krRate:  ${(aggregate.totalWithin1krRate * 100).toFixed(1)}%`);
  console.log(`  meanItemRecall:      ${(aggregate.meanItemRecall * 100).toFixed(1)}%`);
  console.log(`  meanPriceAccuracy:   ${(aggregate.meanPriceAccuracy * 100).toFixed(1)}%`);
  console.log(`  meanAbsLineCountDiff: ${aggregate.meanAbsLineCountDiff.toFixed(2)}`);
}

/**
 * Bootstrap mode: one extraction on `photoPath`, written as a `.expected.draft.json` file for a
 * human to review, correct and rename to `.expected.json`. A draft is never treated as ground
 * truth — `listPhotosWithExpected` only looks for the exact `.expected.json` suffix, never
 * `.expected.draft.json` — and this is the only other place besides `runEval` that talks to Kimi.
 */
export async function bootstrapExpected(llm: LlmClient, photoPath: string): Promise<string> {
  const extraction = await extractPhoto(llm, photoPath);
  const draft: ExpectedReceipt = {
    storeName: extraction.result.storeName ?? '',
    purchasedAt: extraction.result.purchasedAt ?? '',
    total: extraction.result.total ?? 0,
    items: extraction.result.lines
      .filter((line) => line.kind === 'item')
      .map((line) => ({ text: line.text, totalPrice: line.totalPrice })),
  };

  const draftPath = `${photoPath}${DRAFT_SUFFIX}`;
  await writeFile(draftPath, `${JSON.stringify(draft, null, 2)}\n`, 'utf-8');
  return draftPath;
}

function buildRealLlmClient(): LlmClient {
  const config = loadConfig();
  const logger = pino({ level: config.logLevel });
  return createLlmClient(config, logger);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args[0] === '--bootstrap') {
    const photoPath = args[1];
    if (!photoPath) {
      console.error('usage: npm run eval:bootstrap -- <path to receipt photo>');
      process.exitCode = 1;
      return;
    }
    const llm = buildRealLlmClient();
    const draftPath = await bootstrapExpected(llm, photoPath);
    console.log(`Wrote draft: ${draftPath}`);
    console.log('Review it by hand, correct it against the real receipt, then rename it to');
    console.log(draftPath.replace(DRAFT_SUFFIX, EXPECTED_SUFFIX));
    return;
  }

  // Only build the real client once there is at least one pair to run, so a checkout with no
  // ground truth yet (or no .env at all) still prints the "nothing to run" line instead of
  // failing on a missing MOONSHOT_API_KEY before it gets the chance to say so.
  const pairs = await listPhotosWithExpected(DEFAULT_RECEIPTS_DIR);
  if (pairs.length === 0) {
    console.log(
      `No receipt has a matching ${EXPECTED_SUFFIX} file in ${DEFAULT_RECEIPTS_DIR}; nothing to run.`,
    );
    return;
  }

  const llm = buildRealLlmClient();
  await runEval({ llm });
}

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
