/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeDownscaledSize, downscaleImage } from '../../src/client/lib/downscaleImage.ts';

describe('computeDownscaledSize', () => {
  it('scales a landscape image down to maxEdge on the long edge', () => {
    expect(computeDownscaledSize(4000, 3000, 2000)).toEqual({ width: 2000, height: 1500 });
  });

  it('scales a portrait image down to maxEdge on the long edge', () => {
    expect(computeDownscaledSize(3000, 4000, 2000)).toEqual({ width: 1500, height: 2000 });
  });

  it('leaves an image already within the limit unchanged', () => {
    expect(computeDownscaledSize(1000, 800, 2000)).toEqual({ width: 1000, height: 800 });
  });

  it('leaves an image exactly at the limit unchanged', () => {
    expect(computeDownscaledSize(2000, 1500, 2000)).toEqual({ width: 2000, height: 1500 });
  });
});

function fakeBitmap(width: number, height: number) {
  return { width, height, close: vi.fn() };
}

describe('downscaleImage', () => {
  let drawImage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    drawImage = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn());
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
      this: HTMLCanvasElement,
      callback: BlobCallback,
    ) {
      callback(new Blob(['downscaled'], { type: 'image/jpeg' }));
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns the original file unchanged when it is already a small JPEG within the limit', async () => {
    vi.mocked(createImageBitmap).mockResolvedValue(fakeBitmap(800, 600) as unknown as ImageBitmap);
    const file = new File(['x'], 'receipt.jpg', { type: 'image/jpeg' });

    const result = await downscaleImage(file, { maxEdge: 2000, quality: 0.85 });

    expect(result).toBe(file);
    expect(drawImage).not.toHaveBeenCalled();
  });

  it('downscales a 4000x3000 image to at most 2000px on the long edge', async () => {
    vi.mocked(createImageBitmap).mockResolvedValue(
      fakeBitmap(4000, 3000) as unknown as ImageBitmap,
    );
    const file = new File(['x'], 'receipt.jpg', { type: 'image/jpeg' });

    const result = await downscaleImage(file, { maxEdge: 2000, quality: 0.85 });

    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 2000, 1500);
    expect(result.type).toBe('image/jpeg');
  });

  it('re-encodes a non-JPEG image even when it is already small', async () => {
    vi.mocked(createImageBitmap).mockResolvedValue(fakeBitmap(800, 600) as unknown as ImageBitmap);
    const file = new File(['x'], 'receipt.png', { type: 'image/png' });

    const result = await downscaleImage(file, { maxEdge: 2000, quality: 0.85 });

    expect(drawImage).toHaveBeenCalled();
    expect(result).not.toBe(file);
  });

  it('re-encodes a JPEG at or above 500 KB even when its dimensions are already within the limit', async () => {
    vi.mocked(createImageBitmap).mockResolvedValue(fakeBitmap(800, 600) as unknown as ImageBitmap);
    const largeBytes = new Uint8Array(600 * 1024);
    const file = new File([largeBytes], 'receipt.jpg', { type: 'image/jpeg' });

    const result = await downscaleImage(file, { maxEdge: 2000, quality: 0.85 });

    expect(drawImage).toHaveBeenCalled();
    expect(result).not.toBe(file);
  });
});
