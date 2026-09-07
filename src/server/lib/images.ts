import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { ValidationError } from './errors.ts';

const SUPPORTED_FORMATS = new Set(['jpeg', 'png', 'webp']);
const SHORT_EDGE_MAX_PX = 1600;
const JPEG_QUALITY = 85;
const SEGMENT_MAX_HEIGHT_PX = 2000;
const SEGMENT_OVERLAP_PX = 120;

// EXIF orientations 5-8 rotate the image 90 degrees, which swaps which raw stored dimension ends
// up visually the short edge; 1-4 only flip or rotate 180, no swap.
const ROTATED_ORIENTATIONS = new Set([5, 6, 7, 8]);

export type NormalisedImage = {
  bytes: Buffer;
  width: number;
  height: number;
  sha256: string;
};

/**
 * Validates the format, applies EXIF rotation, resizes so the short edge is at most 1600 px
 * (never the long edge, and never enlarging) and re-encodes as JPEG quality 85 (ADR-0005,
 * architecture.md 7.1). A long receipt strip stays wide enough to read; a receipt taller than
 * 2000 px is tiled into overlapping segments at extraction time instead, on the stored bytes
 * unchanged (extractReceipt.ts).
 */
export async function normaliseImage(buffer: Buffer): Promise<NormalisedImage> {
  const image = sharp(buffer, { failOn: 'none' }).rotate();

  const metadata = await image.metadata().catch(() => undefined);
  if (!metadata?.format || !SUPPORTED_FORMATS.has(metadata.format)) {
    throw new ValidationError('Filen er ikke et gjenkjent bilde (JPEG, PNG eller WebP)');
  }
  if (!metadata.width || !metadata.height) {
    throw new ValidationError('Filen er ikke et gjenkjent bilde (JPEG, PNG eller WebP)');
  }

  // metadata.width/height are the raw stored pixels, read before .rotate() runs.
  const rotated = ROTATED_ORIENTATIONS.has(metadata.orientation ?? 1);
  const visualWidth = rotated ? metadata.height : metadata.width;
  const visualHeight = rotated ? metadata.width : metadata.height;
  const resizeOptions =
    visualWidth <= visualHeight
      ? { width: SHORT_EDGE_MAX_PX, withoutEnlargement: true }
      : { height: SHORT_EDGE_MAX_PX, withoutEnlargement: true };

  const bytes = await image.resize(resizeOptions).jpeg({ quality: JPEG_QUALITY }).toBuffer();

  const { width, height } = await sharp(bytes).metadata();
  if (!width || !height) {
    throw new ValidationError('Filen er ikke et gjenkjent bilde (JPEG, PNG eller WebP)');
  }

  const sha256 = createHash('sha256').update(bytes).digest('hex');

  return { bytes, width, height, sha256 };
}

/**
 * Cuts a receipt image taller than `SEGMENT_MAX_HEIGHT_PX` into consecutive vertical segments of
 * at most that height, each overlapping the previous one by `SEGMENT_OVERLAP_PX`, top to bottom
 * (architecture.md 7.1, T28), for `extractReceipt.ts` to send as separate `image_url` parts. A
 * shorter image comes back as a single segment. The stored bytes themselves are never modified —
 * this only shapes the request sent to the LLM.
 */
export async function segmentImage(bytes: Buffer): Promise<Buffer[]> {
  const { width, height } = await sharp(bytes).metadata();
  if (!width || !height || height <= SEGMENT_MAX_HEIGHT_PX) {
    return [bytes];
  }

  const step = SEGMENT_MAX_HEIGHT_PX - SEGMENT_OVERLAP_PX;
  const segments: Buffer[] = [];
  let top = 0;
  for (;;) {
    const segmentHeight = Math.min(SEGMENT_MAX_HEIGHT_PX, height - top);
    segments.push(
      await sharp(bytes)
        .extract({ left: 0, top, width, height: segmentHeight })
        .jpeg({ quality: JPEG_QUALITY })
        .toBuffer(),
    );
    if (top + segmentHeight >= height) {
      break;
    }
    top += step;
  }
  return segments;
}
