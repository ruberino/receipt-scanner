/** @vitest-environment jsdom */
import { act } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ReceiptPage from '../../src/client/pages/ReceiptPage.tsx';
import { ToastProvider } from '../../src/client/components/Toast.tsx';

vi.mock('../../src/client/api/queries.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/api/queries.ts')>();
  return {
    ...actual,
    useReceipt: vi.fn(),
    useScanReceipt: vi.fn(),
    useDeleteReceipt: vi.fn(),
  };
});

const { useReceipt, useScanReceipt, useDeleteReceipt, receiptRefetchInterval } =
  await import('../../src/client/api/queries.ts');

function renderReceiptPage(id = 42) {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[`/receipts/${id}`]}>
        <Routes>
          <Route path="/receipts/:id" element={<ReceiptPage />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

describe('ReceiptPage — uploaded, processing and failed states', () => {
  beforeEach(() => {
    vi.mocked(useScanReceipt).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useScanReceipt>);
    vi.mocked(useDeleteReceipt).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useDeleteReceipt>);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shows the thumbnail and "Skann"/"Slett kvittering" while uploaded', async () => {
    const scanMutate = vi.fn();
    vi.mocked(useScanReceipt).mockReturnValue({
      mutate: scanMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useScanReceipt>);
    vi.mocked(useReceipt).mockReturnValue({
      data: { status: 'uploaded', imageUrl: '/api/receipts/42/image' },
      isPending: false,
      isError: false,
    } as unknown as ReturnType<typeof useReceipt>);

    renderReceiptPage();
    const user = userEvent.setup();

    expect(screen.getByRole('img', { name: 'Kvittering' })).toHaveAttribute(
      'src',
      '/api/receipts/42/image',
    );
    await user.click(screen.getByRole('button', { name: 'Skann' }));
    expect(scanMutate).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Slett kvittering' })).toBeInTheDocument();
  });

  it('shows the thumbnail, a spinner and the elapsed seconds since updatedAt while processing, ticking (T30)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-03T12:00:10.000Z'));
    vi.mocked(useReceipt).mockReturnValue({
      data: {
        status: 'processing',
        imageUrl: '/api/receipts/42/image',
        updatedAt: '2026-09-03T12:00:00.000Z',
      },
      isPending: false,
      isError: false,
    } as unknown as ReturnType<typeof useReceipt>);

    renderReceiptPage();

    expect(screen.getByRole('img', { name: 'Kvittering' })).toHaveAttribute(
      'src',
      '/api/receipts/42/image',
    );
    expect(screen.getByRole('status', { name: 'Laster' })).toBeInTheDocument();
    expect(screen.getByText('Leser kvittering… (10 s)')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByText('Leser kvittering… (13 s)')).toBeInTheDocument();
  });

  it('shows "I kø… (x s)" while pending, counted the same way (T30)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-03T12:00:05.000Z'));
    vi.mocked(useReceipt).mockReturnValue({
      data: {
        status: 'pending',
        imageUrl: '/api/receipts/42/image',
        updatedAt: '2026-09-03T12:00:00.000Z',
      },
      isPending: false,
      isError: false,
    } as unknown as ReturnType<typeof useReceipt>);

    renderReceiptPage();

    expect(screen.getByText('I kø… (5 s)')).toBeInTheDocument();
  });

  it('shows the same elapsed time after a remount, since it is derived from updatedAt, not mount time (T30)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-03T12:00:20.000Z'));
    vi.mocked(useReceipt).mockReturnValue({
      data: {
        status: 'processing',
        imageUrl: '/api/receipts/42/image',
        updatedAt: '2026-09-03T12:00:00.000Z',
      },
      isPending: false,
      isError: false,
    } as unknown as ReturnType<typeof useReceipt>);

    const { unmount } = renderReceiptPage();
    expect(screen.getByText('Leser kvittering… (20 s)')).toBeInTheDocument();
    unmount();

    renderReceiptPage();
    expect(screen.getByText('Leser kvittering… (20 s)')).toBeInTheDocument();
  });

  it('never shows a negative elapsed time when the clock is slightly behind updatedAt', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-03T12:00:00.000Z'));
    vi.mocked(useReceipt).mockReturnValue({
      data: {
        status: 'processing',
        imageUrl: '/api/receipts/42/image',
        updatedAt: '2026-09-03T12:00:05.000Z',
      },
      isPending: false,
      isError: false,
    } as unknown as ReturnType<typeof useReceipt>);

    renderReceiptPage();

    expect(screen.getByText('Leser kvittering… (0 s)')).toBeInTheDocument();
  });

  it('shows the error message and a working "Prøv igjen" button (calling scan) when failed', async () => {
    const scanMutate = vi.fn();
    vi.mocked(useScanReceipt).mockReturnValue({
      mutate: scanMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useScanReceipt>);
    vi.mocked(useReceipt).mockReturnValue({
      data: {
        status: 'failed',
        imageUrl: '/api/receipts/42/image',
        errorMessage: 'Kunne ikke lese kvitteringen',
      },
      isPending: false,
      isError: false,
    } as unknown as ReturnType<typeof useReceipt>);

    renderReceiptPage();
    const user = userEvent.setup();

    expect(screen.getByRole('alert')).toHaveTextContent('Kunne ikke lese kvitteringen');
    await user.click(screen.getByRole('button', { name: 'Prøv igjen' }));
    expect(scanMutate).toHaveBeenCalledOnce();
  });

  it('shows "Slett kvittering" while failed, and deletes after confirmation (T30)', async () => {
    const deleteMutate = vi.fn();
    vi.mocked(useDeleteReceipt).mockReturnValue({
      mutate: deleteMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useDeleteReceipt>);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(useReceipt).mockReturnValue({
      data: {
        status: 'failed',
        imageUrl: '/api/receipts/42/image',
        errorMessage: 'Kunne ikke lese kvitteringen',
      },
      isPending: false,
      isError: false,
    } as unknown as ReturnType<typeof useReceipt>);

    renderReceiptPage();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Slett kvittering' }));

    expect(deleteMutate).toHaveBeenCalledOnce();
  });

  it('does not delete a failed receipt when the confirmation is dismissed (T30)', async () => {
    const deleteMutate = vi.fn();
    vi.mocked(useDeleteReceipt).mockReturnValue({
      mutate: deleteMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useDeleteReceipt>);
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    vi.mocked(useReceipt).mockReturnValue({
      data: {
        status: 'failed',
        imageUrl: '/api/receipts/42/image',
        errorMessage: 'Kunne ikke lese kvitteringen',
      },
      isPending: false,
      isError: false,
    } as unknown as ReturnType<typeof useReceipt>);

    renderReceiptPage();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Slett kvittering' }));

    expect(deleteMutate).not.toHaveBeenCalled();
  });

  it('shows a toast when "Prøv igjen" fails (T24 F3)', async () => {
    const scanMutate = vi.fn((_id: number, options: { onError: (error: unknown) => void }) => {
      options.onError(new Error('nettverksfeil'));
    });
    vi.mocked(useScanReceipt).mockReturnValue({
      mutate: scanMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useScanReceipt>);
    vi.mocked(useReceipt).mockReturnValue({
      data: {
        status: 'failed',
        imageUrl: '/api/receipts/42/image',
        errorMessage: 'Kunne ikke lese kvitteringen',
      },
      isPending: false,
      isError: false,
    } as unknown as ReturnType<typeof useReceipt>);

    renderReceiptPage();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Prøv igjen' }));

    expect(screen.getByRole('status')).toHaveTextContent('Noe gikk galt');
  });

  it('shows a loading state before the first fetch resolves', () => {
    vi.mocked(useReceipt).mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
    } as unknown as ReturnType<typeof useReceipt>);

    renderReceiptPage();

    expect(screen.getByText('Laster …')).toBeInTheDocument();
  });
});

describe('receiptRefetchInterval', () => {
  it('polls every 2s while pending or processing', () => {
    expect(receiptRefetchInterval('pending')).toBe(2000);
    expect(receiptRefetchInterval('processing')).toBe(2000);
  });

  it('stops polling once the receipt is done or failed', () => {
    expect(receiptRefetchInterval('done')).toBe(false);
    expect(receiptRefetchInterval('failed')).toBe(false);
  });

  it('stops polling when there is no data yet', () => {
    expect(receiptRefetchInterval(undefined)).toBe(false);
  });
});
