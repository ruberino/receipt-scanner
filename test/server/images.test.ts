import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../src/server/lib/errors.ts';
import { normaliseImage, segmentImage } from '../../src/server/lib/images.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(here, '..', 'fixtures', 'images');

async function readFixture(name: string): Promise<Buffer> {
  return readFile(path.join(fixturesDir, name));
}

async function syntheticJpeg(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 10, g: 20, b: 30 } },
  })
    .jpeg()
    .toBuffer();
}

describe('normaliseImage', () => {
  it('re-encodes a small JPEG as JPEG and reports its dimensions', async () => {
    const buffer = await readFixture('receipt-small.jpg');

    const result = await normaliseImage(buffer);

    const metadata = await sharp(result.bytes).metadata();
    expect(metadata.format).toBe('jpeg');
    expect(result.width).toBe(300);
    expect(result.height).toBe(500);
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('applies EXIF rotation so the normalised width and height are swapped relative to the raw pixel data', async () => {
    const buffer = await readFixture('rotated.jpg');
    const rawMetadata = await sharp(buffer).metadata();
    expect([rawMetadata.width, rawMetadata.height]).toEqual([40, 30]);

    const result = await normaliseImage(buffer);

    expect(result.width).toBe(30);
    expect(result.height).toBe(40);
  });

  it('leaves a 600x8000 image untouched: the short edge (600) is already within the 1600px cap, and there is no long-edge cap (T28)', async () => {
    const tall = await syntheticJpeg(600, 8000);

    const result = await normaliseImage(tall);

    expect(result.width).toBe(600);
    expect(result.height).toBe(8000);
  });

  it('resizes a 3000x20000 image to 1600x10667 by the short edge, never the long one (T28)', async () => {
    const tall = await syntheticJpeg(3000, 20000);

    const result = await normaliseImage(tall);

    expect(result.width).toBe(1600);
    expect(result.height).toBe(10667);
  });

  it('resizes a landscape image by its short edge (height), not the long one', async () => {
    const wide = await syntheticJpeg(20000, 3000);

    const result = await normaliseImage(wide);

    expect(result.width).toBe(10667);
    expect(result.height).toBe(1600);
  });

  it('never enlarges an image whose short edge is already at or under the cap', async () => {
    const small = await syntheticJpeg(1000, 800);

    const result = await normaliseImage(small);

    expect(result.width).toBe(1000);
    expect(result.height).toBe(800);
  });

  it('is deterministic: the same bytes produce the same sha256', async () => {
    const buffer = await readFixture('receipt-small.jpg');

    const first = await normaliseImage(buffer);
    const second = await normaliseImage(buffer);

    expect(first.sha256).toBe(second.sha256);
  });

  it('rejects a file that is not a recognised image format', async () => {
    const buffer = await readFixture('not-an-image.txt');

    await expect(normaliseImage(buffer)).rejects.toBeInstanceOf(ValidationError);
    await expect(normaliseImage(buffer)).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('segmentImage', () => {
  it('returns the same buffer as a single segment when it is at most 2000px tall', async () => {
    const buffer = await syntheticJpeg(1200, 1600);

    const segments = await segmentImage(buffer);

    expect(segments).toHaveLength(1);
    expect(segments[0]).toBe(buffer);
  });

  it('returns exactly one segment at the 2000px boundary itself', async () => {
    const buffer = await syntheticJpeg(1200, 2000);

    const segments = await segmentImage(buffer);

    expect(segments).toHaveLength(1);
  });

  it('cuts a 1600x10667 image into six consecutive segments with 120px overlap, top to bottom (T28)', async () => {
    const buffer = await syntheticJpeg(1600, 10667);

    const segments = await segmentImage(buffer);

    expect(segments).toHaveLength(6);
    const heights = await Promise.all(
      segments.map(async (segment) => (await sharp(segment).metadata()).height),
    );
    // Each of the first five is a full 2000px segment; the last is the remainder (10667 - 5*1880).
    expect(heights).toEqual([2000, 2000, 2000, 2000, 2000, 1267]);
    for (const segment of segments) {
      const metadata = await sharp(segment).metadata();
      expect(metadata.width).toBe(1600);
    }
  });
});
