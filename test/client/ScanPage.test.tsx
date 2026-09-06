/** @vitest-environment jsdom */
import { act } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReceiptSummary } from '../../src/shared/schemas.ts';
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
  return {
    ...actual,
    useUploadReceipt: vi.fn(),
    useScanReceipt: vi.fn(),
    useReceipts: vi.fn(),
  };
});

const { downscaleImage } = await import('../../src/client/lib/downscaleImage.ts');
const { useUploadReceipt, useScanReceipt, useReceipts } =
  await import('../../src/client/api/queries.ts');
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

function selectFiles(names: string[]) {
  const files = names.map((name) => new File(['x'], name, { type: 'image/jpeg' }));
  const input = screen.getByTestId('library-input');
  return userEvent.upload(input, files);
}

function receiptSummary(id: number, status: ReceiptSummary['status']): ReceiptSummary {
  return {
    id,
    status,
    storeName: null,
    purchasedAt: null,
    totalOre: null,
    lineCount: 0,
    warnings: [],
  } as unknown as ReceiptSummary;
}

function mockReceipts(receipts: ReceiptSummary[]) {
  vi.mocked(useReceipts).mockReturnValue({
    data: receipts,
  } as unknown as ReturnType<typeof useReceipts>);
}

type UploadCall = {
  resolve: (value: { id: number }) => void;
  reject: (error: unknown) => void;
};

function mockControllableUpload() {
  const calls: UploadCall[] = [];
  const mutateAsync = vi.fn(() => {
    return new Promise((resolve, reject) => {
      calls.push({ resolve, reject });
    });
  });
  vi.mocked(useUploadReceipt).mockReturnValue({
    mutateAsync,
    isPending: false,
  } as unknown as ReturnType<typeof useUploadReceipt>);
  return { mutateAsync, calls };
}

function callAt(calls: UploadCall[], index: number): UploadCall {
  const call = calls[index];
  if (!call) {
    throw new Error(`expected an upload call at index ${index}`);
  }
  return call;
}

describe('ScanPage', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    vi.mocked(downscaleImage).mockResolvedValue(new Blob(['downscaled'], { type: 'image/jpeg' }));
    mockReceipts([]);
    vi.mocked(useScanReceipt).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useScanReceipt>);
  });

  afterEach(() => {
    vi.mocked(downscaleImage).mockReset();
  });

  it('has a camera input with capture=environment and a library input without it, multiple', () => {
    renderScanPage();

    expect(screen.getByTestId('camera-input')).toHaveAttribute('capture', 'environment');
    expect(screen.getByTestId('library-input')).not.toHaveAttribute('capture');
    expect(screen.getByTestId('library-input')).toHaveAttribute('multiple');
  });

  it('uploads three files one after the other, in selection order, each ending as "Lastet opp"', async () => {
    const { mutateAsync, calls } = mockControllableUpload();
    renderScanPage();

    await selectFiles(['a.jpg', 'b.jpg', 'c.jpg']);

    await waitFor(() => expect(screen.getByText('a.jpg')).toBeInTheDocument());
    expect(screen.getByText('b.jpg')).toBeInTheDocument();
    expect(screen.getByText('c.jpg')).toBeInTheDocument();

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledTimes(1);

    await act(async () => {
      callAt(calls, 0).resolve({ id: 1 });
    });
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2));

    await act(async () => {
      callAt(calls, 1).resolve({ id: 2 });
    });
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(3));

    await act(async () => {
      callAt(calls, 2).resolve({ id: 3 });
    });

    await waitFor(() => {
      const items = screen.getAllByText('Lastet opp');
      expect(items).toHaveLength(3);
    });
  });

  it('shows "Allerede skannet" with a link on a 409, and still uploads the remaining files', async () => {
    const { mutateAsync, calls } = mockControllableUpload();
    renderScanPage();

    await selectFiles(['a.jpg', 'b.jpg']);
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));

    await act(async () => {
      callAt(calls, 0).reject(
        new ApiRequestError(409, {
          code: 'CONFLICT',
          message: 'Denne kvitteringen er allerede skannet',
          details: { existingReceiptId: 9 },
          requestId: 'x',
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Allerede skannet' })).toHaveAttribute(
        'href',
        '/receipts/9',
      );
    });
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2));

    await act(async () => {
      callAt(calls, 1).resolve({ id: 2 });
    });
    await waitFor(() => expect(screen.getByText('Lastet opp')).toBeInTheDocument());
  });

  it('shows "Feilet: {message}" for a non-conflict error', async () => {
    const { mutateAsync, calls } = mockControllableUpload();
    renderScanPage();

    await selectFiles(['a.jpg']);
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));

    await act(async () => {
      callAt(calls, 0).reject(
        new ApiRequestError(400, {
          code: 'VALIDATION_ERROR',
          message: 'Filen er ikke et gjenkjent bilde (JPEG, PNG eller WebP)',
          requestId: 'x',
        }),
      );
    });

    await waitFor(() => {
      expect(
        screen.getByText('Feilet: Filen er ikke et gjenkjent bilde (JPEG, PNG eller WebP)'),
      ).toBeInTheDocument();
    });
  });

  it('has no "Skann"/"Skann alle" button when there are no uploaded receipts', () => {
    mockReceipts([receiptSummary(1, 'done')]);
    renderScanPage();

    expect(screen.queryByRole('button', { name: /Skann/ })).not.toBeInTheDocument();
  });

  it('shows "Skann (1)", calls scan and navigates to the receipt for a single uploaded receipt', async () => {
    mockReceipts([receiptSummary(5, 'uploaded'), receiptSummary(6, 'done')]);
    const scanMutateAsync = vi.fn().mockResolvedValue(receiptSummary(5, 'pending'));
    vi.mocked(useScanReceipt).mockReturnValue({
      mutateAsync: scanMutateAsync,
      isPending: false,
    } as unknown as ReturnType<typeof useScanReceipt>);
    renderScanPage();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Skann (1)' }));

    await waitFor(() => expect(scanMutateAsync).toHaveBeenCalledWith(5));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/receipts/5'));
  });

  it('shows "Skann alle (3)", calls scan for every id in order and navigates to /receipts', async () => {
    mockReceipts([
      receiptSummary(1, 'uploaded'),
      receiptSummary(2, 'uploaded'),
      receiptSummary(3, 'uploaded'),
    ]);
    const scanMutateAsync = vi.fn().mockResolvedValue(receiptSummary(1, 'pending'));
    vi.mocked(useScanReceipt).mockReturnValue({
      mutateAsync: scanMutateAsync,
      isPending: false,
    } as unknown as ReturnType<typeof useScanReceipt>);
    renderScanPage();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Skann alle (3)' }));

    await waitFor(() => expect(scanMutateAsync).toHaveBeenCalledTimes(3));
    expect(scanMutateAsync.mock.calls.map((call) => call[0])).toEqual([1, 2, 3]);
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/receipts'));
  });

  it('disables "Skann" while a file is still uploading, and enables it once uploaded (T24 F2)', async () => {
    mockReceipts([receiptSummary(5, 'uploaded')]);
    const { calls } = mockControllableUpload();
    renderScanPage();

    await selectFiles(['a.jpg']);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Skann (1)' })).toBeDisabled());

    await act(async () => {
      callAt(calls, 0).resolve({ id: 7 });
    });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Skann (1)' })).not.toBeDisabled(),
    );
  });
});
