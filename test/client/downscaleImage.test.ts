/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeDownscaledSize, downscaleImage } from '../../src/client/lib/downscaleImage.ts';

describe('computeDownscaledSize', () => {
  it('scales a landscape image down to maxEdge on the short edge (height), not the long one', () => {
    expect(computeDownscaledSize(4000, 3000, 1600)).toEqual({ width: 2133, height: 1600 });
  });

  it('scales a portrait image down to maxEdge on the short edge (width), not the long one', () => {
    expect(computeDownscaledSize(3000, 4000, 1600)).toEqual({ width: 1600, height: 2133 });
  });

  it('leaves a long, narrow receipt strip untouched when its short edge is already within the limit (T28)', () => {
    expect(computeDownscaledSize(600, 8000, 1600)).toEqual({ width: 600, height: 8000 });
  });

  it('leaves an image already within the limit unchanged', () => {
    expect(computeDownscaledSize(1000, 800, 1600)).toEqual({ width: 1000, height: 800 });
  });

  it('leaves an image exactly at the limit unchanged', () => {
    expect(computeDownscaledSize(1600, 1200, 1600)).toEqual({ width: 1600, height: 1200 });
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

  it('downscales a 4000x3000 image to at most 2000px on the short edge (height)', async () => {
    vi.mocked(createImageBitmap).mockResolvedValue(
      fakeBitmap(4000, 3000) as unknown as ImageBitmap,
    );
    const file = new File(['x'], 'receipt.jpg', { type: 'image/jpeg' });

    const result = await downscaleImage(file, { maxEdge: 2000, quality: 0.85 });

    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 2667, 2000);
    expect(result.type).toBe('image/jpeg');
  });

  it('leaves a long, narrow receipt photo untouched: no long-edge cap (T28)', async () => {
    vi.mocked(createImageBitmap).mockResolvedValue(fakeBitmap(600, 8000) as unknown as ImageBitmap);
    const file = new File(['x'], 'receipt.jpg', { type: 'image/jpeg' });

    const result = await downscaleImage(file, { maxEdge: 1600, quality: 0.85 });

    expect(drawImage).not.toHaveBeenCalled();
    expect(result).toBe(file);
  });

  it("returns the original file unchanged when the target canvas would exceed WebKit's iOS area limit (T28 F2)", async () => {
    vi.mocked(createImageBitmap).mockResolvedValue(
      fakeBitmap(3000, 20000) as unknown as ImageBitmap,
    );
    const file = new File(['x'], 'receipt.jpg', { type: 'image/jpeg' });

    const result = await downscaleImage(file, { maxEdge: 1600, quality: 0.85 });

    expect(drawImage).not.toHaveBeenCalled();
    expect(result).toBe(file);
  });

  it('still goes through the canvas when the target stays within the WebKit canvas limit (T28 F2)', async () => {
    vi.mocked(createImageBitmap).mockResolvedValue(
      fakeBitmap(3000, 4000) as unknown as ImageBitmap,
    );
    const file = new File(['x'], 'receipt.jpg', { type: 'image/jpeg' });

    const result = await downscaleImage(file, { maxEdge: 1600, quality: 0.85 });

    expect(drawImage).toHaveBeenCalled();
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
