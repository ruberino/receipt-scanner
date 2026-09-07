/** @vitest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReceiptLine } from '../../src/shared/schemas.ts';
import { ApiRequestError } from '../../src/client/api/client.ts';
import ReceiptLineRow from '../../src/client/components/ReceiptLineRow.tsx';
import { ToastProvider } from '../../src/client/components/Toast.tsx';

vi.mock('../../src/client/api/queries.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/api/queries.ts')>();
  return {
    ...actual,
    useProductSearch: vi.fn(),
    useUpdateReceiptLine: vi.fn(),
    useUpdateReceiptLineFields: vi.fn(),
    useDeleteReceiptLine: vi.fn(),
  };
});

const { useProductSearch, useUpdateReceiptLine, useUpdateReceiptLineFields, useDeleteReceiptLine } =
  await import('../../src/client/api/queries.ts');

function itemLine(overrides: Partial<ReceiptLine> = {}): ReceiptLine {
  return {
    id: 1,
    lineNo: 1,
    kind: 'item',
    rawText: 'TINE LETTMELK 1L',
    quantity: 1,
    unit: 'stk',
    unitPriceOre: 4380,
    totalOre: 4380,
    product: { id: 5, name: 'Lettmelk 1 l', category: 'Meieri' },
    matchSource: 'alias',
    ...overrides,
  };
}

function renderRow(line: ReceiptLine) {
  render(
    <ToastProvider>
      <ReceiptLineRow line={line} receiptId={10} />
    </ToastProvider>,
  );
}

describe('ReceiptLineRow', () => {
  let updateFieldsMutate: ReturnType<typeof vi.fn>;
  let deleteLineMutate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.mocked(useProductSearch).mockReturnValue({
      data: [],
    } as unknown as ReturnType<typeof useProductSearch>);
    vi.mocked(useUpdateReceiptLine).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useUpdateReceiptLine>);
    updateFieldsMutate = vi.fn();
    vi.mocked(useUpdateReceiptLineFields).mockReturnValue({
      mutate: updateFieldsMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useUpdateReceiptLineFields>);
    deleteLineMutate = vi.fn();
    vi.mocked(useDeleteReceiptLine).mockReturnValue({
      mutate: deleteLineMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useDeleteReceiptLine>);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows a "Rediger" button on both item and non-item lines', () => {
    renderRow(itemLine({ kind: 'discount', totalOre: -500, product: null }));

    expect(screen.getByRole('button', { name: 'Rediger' })).toBeInTheDocument();
  });

  it('opens edit mode prefilled with the amount in kroner and the current kind', async () => {
    renderRow(itemLine({ totalOre: 4380 }));
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Rediger' }));

    expect(screen.getByLabelText('Beløp (kr)')).toHaveValue('43,80');
    expect(screen.getByLabelText('Type')).toHaveValue('item');
  });

  it('sends only the changed field when just the amount changes', async () => {
    renderRow(itemLine({ totalOre: 4380 }));
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Rediger' }));
    const amountField = screen.getByLabelText('Beløp (kr)');
    await user.clear(amountField);
    await user.type(amountField, '50,00');
    await user.click(screen.getByRole('button', { name: 'Lagre' }));

    expect(updateFieldsMutate).toHaveBeenCalledWith(
      { lineId: 1, totalOre: 5000 },
      expect.anything(),
    );
  });

  it('sends only kind when just the kind changes', async () => {
    renderRow(itemLine({ totalOre: 4380 }));
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Rediger' }));
    await user.selectOptions(screen.getByLabelText('Type'), 'other');
    await user.click(screen.getByRole('button', { name: 'Lagre' }));

    expect(updateFieldsMutate).toHaveBeenCalledWith(
      { lineId: 1, kind: 'other' },
      expect.anything(),
    );
  });

  it('shows "Ugyldig beløp" and does not call the mutation for an invalid amount', async () => {
    renderRow(itemLine());
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Rediger' }));
    const amountField = screen.getByLabelText('Beløp (kr)');
    await user.clear(amountField);
    await user.type(amountField, 'ikke et beløp');
    await user.click(screen.getByRole('button', { name: 'Lagre' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Ugyldig beløp');
    expect(updateFieldsMutate).not.toHaveBeenCalled();
  });

  it('shows "Linjen er oppdatert" and exits edit mode on success', async () => {
    updateFieldsMutate.mockImplementation((_body, options) => options.onSuccess());
    renderRow(itemLine({ totalOre: 4380 }));
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Rediger' }));
    const amountField = screen.getByLabelText('Beløp (kr)');
    await user.clear(amountField);
    await user.type(amountField, '50,00');
    await user.click(screen.getByRole('button', { name: 'Lagre' }));

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Linjen er oppdatert'),
    );
    expect(screen.queryByLabelText('Beløp (kr)')).not.toBeInTheDocument();
  });

  it('shows the server error message in a toast on failure', async () => {
    updateFieldsMutate.mockImplementation((_body, options) =>
      options.onError(
        new ApiRequestError(400, {
          code: 'VALIDATION_ERROR',
          message: 'Beløpet for en rabatt kan ikke være positivt',
          requestId: 'req-1',
        }),
      ),
    );
    renderRow(itemLine({ totalOre: 4380 }));
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Rediger' }));
    const amountField = screen.getByLabelText('Beløp (kr)');
    await user.clear(amountField);
    await user.type(amountField, '50,00');
    await user.click(screen.getByRole('button', { name: 'Lagre' }));

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Beløpet for en rabatt kan ikke være positivt',
      ),
    );
  });

  it('closes edit mode without saving on "Avbryt"', async () => {
    renderRow(itemLine());
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Rediger' }));
    await user.click(screen.getByRole('button', { name: 'Avbryt' }));

    expect(screen.queryByLabelText('Beløp (kr)')).not.toBeInTheDocument();
    expect(updateFieldsMutate).not.toHaveBeenCalled();
  });

  it('deletes only after confirmation, and shows "Linjen er slettet" on success', async () => {
    deleteLineMutate.mockImplementation((_id, options) => options.onSuccess());
    renderRow(itemLine());
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Rediger' }));
    await user.click(screen.getByRole('button', { name: 'Slett linje' }));

    expect(window.confirm).toHaveBeenCalled();
    expect(deleteLineMutate).toHaveBeenCalledWith(1, expect.anything());
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Linjen er slettet'));
  });

  it('does not delete when the confirmation is dismissed', async () => {
    vi.mocked(window.confirm).mockReturnValue(false);
    renderRow(itemLine());
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Rediger' }));
    await user.click(screen.getByRole('button', { name: 'Slett linje' }));

    expect(deleteLineMutate).not.toHaveBeenCalled();
  });
});
