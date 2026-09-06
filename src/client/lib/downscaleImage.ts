export type DownscaleOptions = {
  maxEdge: number;
  quality: number;
};

const SKIP_MAX_BYTES = 500 * 1024;

/** Scales down proportionally so the long edge is at most `maxEdge`; never upscales. */
export function computeDownscaledSize(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  const longEdge = Math.max(width, height);
  if (longEdge <= maxEdge) {
    return { width, height };
  }

  const scale = maxEdge / longEdge;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

type ImageSource = {
  width: number;
  height: number;
  drawable: CanvasImageSource;
  cleanup: () => void;
};

async function loadImageSource(file: Blob): Promise<ImageSource> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file);
    return {
      width: bitmap.width,
      height: bitmap.height,
      drawable: bitmap,
      cleanup: () => bitmap.close(),
    };
  }

  const url = URL.createObjectURL(file);
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Kunne ikke lese bildet'));
    image.src = url;
  });
  return {
    width: image.naturalWidth,
    height: image.naturalHeight,
    drawable: image,
    cleanup: () => URL.revokeObjectURL(url),
  };
}

/**
 * Shrinks an image client-side before upload so a multi-MB camera photo does not have to cross a
 * slow mobile connection at full size; the server re-normalises regardless (ADR-0005), so this is
 * purely a bandwidth/UX optimisation, not a correctness requirement.
 */
export async function downscaleImage(
  file: File | Blob,
  { maxEdge, quality }: DownscaleOptions,
): Promise<Blob> {
  const { width, height, drawable, cleanup } = await loadImageSource(file);
  const target = computeDownscaledSize(width, height, maxEdge);

  const alreadySmallJpeg =
    file.type === 'image/jpeg' &&
    file.size < SKIP_MAX_BYTES &&
    target.width === width &&
    target.height === height;
  if (alreadySmallJpeg) {
    cleanup();
    return file;
  }

  const canvas = document.createElement('canvas');
  canvas.width = target.width;
  canvas.height = target.height;
  const context = canvas.getContext('2d');
  if (!context) {
    cleanup();
    throw new Error('Kunne ikke behandle bildet');
  }
  context.drawImage(drawable, 0, 0, target.width, target.height);
  cleanup();

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Kunne ikke behandle bildet'));
        }
      },
      'image/jpeg',
      quality,
    );
  });
}
