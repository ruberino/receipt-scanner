/** @vitest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../src/client/components/Toast.tsx';
import ScanPage from '../../src/client/pages/ScanPage.tsx';

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));

vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('../../src/client/lib/downscaleImage.ts', () => ({
  downscaleImage: vi.fn(),
}));

vi.mock('../../src/client/api/queries.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/api/queries.ts')>();
  return { ...actual, useUploadReceipt: vi.fn() };
});

const { downscaleImage } = await import('../../src/client/lib/downscaleImage.ts');
const { useUploadReceipt } = await import('../../src/client/api/queries.ts');
const { ApiRequestError } = await import('../../src/client/api/client.ts');

function renderScanPage() {
  render(
    <MemoryRouter initialEntries={['/scan']}>
      <ToastProvider>
        <ScanPage />
      </ToastProvider>
    </MemoryRouter>,
  );
}

function selectAFile() {
  const file = new File(['x'], 'receipt.jpg', { type: 'image/jpeg' });
  const input = screen.getByTestId('camera-input');
  return userEvent.upload(input, file);
}

function mockUpload(mutateAsync: ReturnType<typeof vi.fn>) {
  vi.mocked(useUploadReceipt).mockReturnValue({
    mutateAsync,
    isPending: false,
  } as unknown as ReturnType<typeof useUploadReceipt>);
}

describe('ScanPage', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    vi.mocked(downscaleImage).mockResolvedValue(new Blob(['downscaled'], { type: 'image/jpeg' }));
  });

  afterEach(() => {
    vi.mocked(downscaleImage).mockReset();
  });

  it('has a camera input with capture=environment and a library input without it', () => {
    mockUpload(vi.fn());
    renderScanPage();

    expect(screen.getByTestId('camera-input')).toHaveAttribute('capture', 'environment');
    expect(screen.getByTestId('library-input')).not.toHaveAttribute('capture');
  });

  it('shows a preview after selecting a file', async () => {
    mockUpload(vi.fn());
    renderScanPage();

    await selectAFile();

    expect(screen.getByAltText('Forhåndsvisning av kvittering')).toBeInTheDocument();
  });

  it('downscales, uploads with a progress bar that reaches 100%, and navigates to the receipt on success', async () => {
    let resolveUpload: ((value: { id: number }) => void) | undefined;
    let isPending = false;
    const mutateAsync = vi.fn(
      ({ onProgress }: { onProgress?: (fraction: number) => void }) =>
        new Promise((resolve) => {
          isPending = true;
          resolveUpload = (value) => {
            isPending = false;
            resolve(value);
          };
          onProgress?.(1);
        }),
    );
    // isPending must be read fresh on every render, not captured once, since the upload starts
    // synchronously inside handleUse (no await before it) and only then does React re-render.
    vi.mocked(useUploadReceipt).mockImplementation(
      () => ({ mutateAsync, isPending }) as unknown as ReturnType<typeof useUploadReceipt>,
    );
    renderScanPage();
    await selectAFile();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Bruk' }));

    await waitFor(() => {
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    });
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuemin', '0');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuemax', '100');

    resolveUpload?.({ id: 7 });

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/receipts/7');
    });
    expect(downscaleImage).toHaveBeenCalledWith(expect.any(File), {
      maxEdge: 2000,
      quality: 0.85,
    });
    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ onProgress: expect.any(Function) }),
    );
  });

  it('shows the toast and navigates to the existing receipt on a 409', async () => {
    const mutateAsync = vi.fn().mockRejectedValue(
      new ApiRequestError(409, {
        code: 'CONFLICT',
        message: 'Denne kvitteringen er allerede skannet',
        details: { existingReceiptId: 3 },
        requestId: 'x',
      }),
    );
    mockUpload(mutateAsync);
    renderScanPage();
    await selectAFile();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Bruk' }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        'Denne kvitteringen er allerede skannet',
      );
    });
    expect(navigateMock).toHaveBeenCalledWith('/receipts/3');
  });

  it('shows the server message for a 400', async () => {
    const mutateAsync = vi.fn().mockRejectedValue(
      new ApiRequestError(400, {
        code: 'VALIDATION_ERROR',
        message: 'Filen er ikke et gjenkjent bilde (JPEG, PNG eller WebP)',
        requestId: 'x',
      }),
    );
    mockUpload(mutateAsync);
    renderScanPage();
    await selectAFile();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Bruk' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Filen er ikke et gjenkjent bilde (JPEG, PNG eller WebP)',
      );
    });
  });

  it('shows the server message for a 413', async () => {
    const mutateAsync = vi.fn().mockRejectedValue(
      new ApiRequestError(413, {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Filen er for stor',
        requestId: 'x',
      }),
    );
    mockUpload(mutateAsync);
    renderScanPage();
    await selectAFile();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Bruk' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Filen er for stor');
    });
  });
});
