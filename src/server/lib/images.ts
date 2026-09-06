import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { ValidationError } from './errors.ts';

const SUPPORTED_FORMATS = new Set(['jpeg', 'png', 'webp']);
const MAX_EDGE_PX = 2000;
const JPEG_QUALITY = 85;

export type NormalisedImage = {
  bytes: Buffer;
  width: number;
  height: number;
  sha256: string;
};

/**
 * Validates the format, applies EXIF rotation, resizes so the long edge is at most 2000 px and
 * re-encodes as JPEG quality 85 (ADR-0005, architecture.md 7.1).
 */
export async function normaliseImage(buffer: Buffer): Promise<NormalisedImage> {
  const image = sharp(buffer, { failOn: 'none' }).rotate();

  const metadata = await image.metadata().catch(() => undefined);
  if (!metadata?.format || !SUPPORTED_FORMATS.has(metadata.format)) {
    throw new ValidationError('Filen er ikke et gjenkjent bilde (JPEG, PNG eller WebP)');
  }

  const bytes = await image
    .resize({ width: MAX_EDGE_PX, height: MAX_EDGE_PX, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();

  const { width, height } = await sharp(bytes).metadata();
  if (!width || !height) {
    throw new ValidationError('Filen er ikke et gjenkjent bilde (JPEG, PNG eller WebP)');
  }

  const sha256 = createHash('sha256').update(bytes).digest('hex');

  return { bytes, width, height, sha256 };
}
