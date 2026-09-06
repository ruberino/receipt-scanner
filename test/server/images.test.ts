import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../src/server/lib/errors.ts';
import { normaliseImage } from '../../src/server/lib/images.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(here, '..', 'fixtures', 'images');

async function readFixture(name: string): Promise<Buffer> {
  return readFile(path.join(fixturesDir, name));
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

  it('resizes so the long edge is at most 2000 px, without enlarging a smaller image', async () => {
    const large = await sharp({
      create: { width: 3000, height: 1500, channels: 3, background: { r: 10, g: 20, b: 30 } },
    })
      .jpeg()
      .toBuffer();

    const result = await normaliseImage(large);

    expect(result.width).toBe(2000);
    expect(result.height).toBe(1000);
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
