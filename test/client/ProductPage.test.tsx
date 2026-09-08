/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Product, ProductDetail } from '../../src/shared/schemas.ts';
import ProductPage from '../../src/client/pages/ProductPage.tsx';
import { ToastProvider } from '../../src/client/components/Toast.tsx';

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));

vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('../../src/client/api/queries.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/api/queries.ts')>();
  return {
    ...actual,
    useProductDetail: vi.fn(),
    useUpdateProduct: vi.fn(),
    useMergeProduct: vi.fn(),
    useDeleteProductAlias: vi.fn(),
    useProducts: vi.fn(),
    useAttachProductParent: vi.fn(),
    useDetachProductParent: vi.fn(),
    useCreateProductGroup: vi.fn(),
  };
});

const {
  useProductDetail,
  useUpdateProduct,
  useMergeProduct,
  useDeleteProductAlias,
  useProducts,
  useAttachProductParent,
  useDetachProductParent,
  useCreateProductGroup,
} = await import('../../src/client/api/queries.ts');

function productDetail(overrides: Partial<ProductDetail> = {}): ProductDetail {
  return {
    id: 1,
    name: 'Lettmelk 1 l',
    category: 'Meieri',
    suppressed: false,
    timesBought: 4,
    lastBought: '2026-09-01',
    medianIntervalDays: 7,
    aliases: [{ id: 10, alias: 'TINE LETTMELK 1L', source: 'user' }],
    purchases: [
      {
        receiptId: 42,
        date: '2026-09-01',
        storeName: 'KIWI Torshov',
        quantity: 1,
        unit: 'stk',
        totalOre: 3200,
      },
    ],
    parentId: null,
    variantCount: 0,
    parent: null,
    variants: [],
    groupStats: null,
    ...overrides,
  };
}

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 2,
    name: 'Yoghurt',
    category: 'Meieri',
    suppressed: false,
    timesBought: 1,
    lastBought: null,
    medianIntervalDays: null,
    parentId: null,
    variantCount: 0,
    ...overrides,
  };
}

function mockDetail(detail: ProductDetail) {
  vi.mocked(useProductDetail).mockReturnValue({
    data: detail,
    isPending: false,
    isError: false,
  } as unknown as ReturnType<typeof useProductDetail>);
}

function renderProductPage(id = 1) {
  render(
    <ToastProvider>
      <MemoryRouter initialEntries={[`/products/${id}`]}>
        <Routes>
          <Route path="/products/:id" element={<ProductPage />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

describe('ProductPage', () => {
  let updateMutate: ReturnType<typeof vi.fn>;
  let mergeMutate: ReturnType<typeof vi.fn>;
  let deleteAliasMutate: ReturnType<typeof vi.fn>;
  let attachMutate: ReturnType<typeof vi.fn>;
  let detachMutate: ReturnType<typeof vi.fn>;
  let createGroupMutate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    navigateMock.mockReset();
    updateMutate = vi.fn();
    mergeMutate = vi.fn();
    deleteAliasMutate = vi.fn();
    attachMutate = vi.fn();
    detachMutate = vi.fn();
    createGroupMutate = vi.fn();
    vi.mocked(useUpdateProduct).mockReturnValue({
      mutate: updateMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useUpdateProduct>);
    vi.mocked(useMergeProduct).mockReturnValue({
      mutate: mergeMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useMergeProduct>);
    vi.mocked(useDeleteProductAlias).mockReturnValue({
      mutate: deleteAliasMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useDeleteProductAlias>);
    vi.mocked(useProducts).mockReturnValue({
      data: [],
    } as unknown as ReturnType<typeof useProducts>);
    vi.mocked(useAttachProductParent).mockReturnValue({
      mutate: attachMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useAttachProductParent>);
    vi.mocked(useDetachProductParent).mockReturnValue({
      mutate: detachMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useDetachProductParent>);
    vi.mocked(useCreateProductGroup).mockReturnValue({
      mutate: createGroupMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useCreateProductGroup>);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows a loading state before the first fetch resolves', () => {
    vi.mocked(useProductDetail).mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
    } as unknown as ReturnType<typeof useProductDetail>);

    renderProductPage();

    expect(screen.getByText('Laster …')).toBeInTheDocument();
  });

  it('shows a not-found state on error', () => {
    vi.mocked(useProductDetail).mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
    } as unknown as ReturnType<typeof useProductDetail>);

    renderProductPage();

    expect(screen.getByText('Fant ikke varen.')).toBeInTheDocument();
  });

  it('pre-fills name, category and the suppressed toggle', () => {
    mockDetail(productDetail({ suppressed: true }));

    renderProductPage();

    expect(screen.getByLabelText('Navn')).toHaveValue('Lettmelk 1 l');
    expect(screen.getByLabelText('Kategori')).toHaveValue('Meieri');
    expect(screen.getByLabelText('Ikke foreslå')).toBeChecked();
  });

  it('saves the edited name and category', async () => {
    mockDetail(productDetail());
    renderProductPage();
    const user = userEvent.setup();

    await user.clear(screen.getByLabelText('Navn'));
    await user.type(screen.getByLabelText('Navn'), 'Lettmelk 1,5 l');
    await user.selectOptions(screen.getByLabelText('Kategori'), 'Drikke');
    await user.click(screen.getByRole('button', { name: 'Lagre' }));

    expect(updateMutate).toHaveBeenCalledWith(
      { name: 'Lettmelk 1,5 l', category: 'Drikke' },
      expect.anything(),
    );
  });

  it('toggles suppressed immediately, before the mutation resolves', async () => {
    mockDetail(productDetail({ suppressed: false }));
    renderProductPage();
    const user = userEvent.setup();

    await user.click(screen.getByLabelText('Ikke foreslå'));

    expect(updateMutate).toHaveBeenCalledWith({ suppressed: true }, expect.anything());
    // Optimistic: the checkbox itself reflects the change without waiting for the mutation, since
    // `updateMutate` above is a bare mock that never calls onSuccess/onError.
    expect(screen.getByLabelText('Ikke foreslå')).toBeChecked();
  });

  it('reverts the suppressed toggle and shows a toast when the mutation fails', async () => {
    mockDetail(productDetail({ suppressed: false }));
    updateMutate.mockImplementation((_body, options) => {
      options?.onError?.(new Error('nettverksfeil'));
    });
    renderProductPage();
    const user = userEvent.setup();

    await user.click(screen.getByLabelText('Ikke foreslå'));

    expect(screen.getByLabelText('Ikke foreslå')).not.toBeChecked();
    expect(screen.getByRole('status')).toHaveTextContent('Noe gikk galt');
  });

  it('renders aliases with a delete button that calls the delete mutation', async () => {
    mockDetail(productDetail());
    renderProductPage();
    const user = userEvent.setup();

    expect(screen.getByText('TINE LETTMELK 1L')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Slett' }));

    expect(deleteAliasMutate).toHaveBeenCalledWith(10, expect.anything());
  });

  it('renders purchase history linking to the receipt', () => {
    mockDetail(productDetail());

    renderProductPage();

    expect(screen.getByRole('link', { name: /KIWI Torshov/ })).toHaveAttribute(
      'href',
      '/receipts/42',
    );
  });

  it('opens the merge search, excludes the current product, and merges after confirmation', async () => {
    mockDetail(productDetail({ id: 1, name: 'Lettmelk 1 l' }));
    vi.mocked(useProducts).mockReturnValue({
      data: [product({ id: 1, name: 'Lettmelk 1 l' }), product({ id: 2, name: 'Yoghurt' })],
    } as unknown as ReturnType<typeof useProducts>);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mergeMutate.mockImplementation((_targetId, options) => options?.onSuccess?.());
    renderProductPage(1);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Slå sammen med…' }));
    await user.type(screen.getByLabelText('Slå sammen med'), 'Yog');

    expect(screen.queryByRole('button', { name: 'Lettmelk 1 l' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Yoghurt' }));

    expect(window.confirm).toHaveBeenCalledWith(
      'Slå sammen «Lettmelk 1 l» med «Yoghurt»? Dette kan ikke angres.\n\n' +
        'Er det varianter av samme vare, bruk Varegruppe i stedet.',
    );
    expect(mergeMutate).toHaveBeenCalledWith(2, expect.anything());
    expect(navigateMock).toHaveBeenCalledWith('/products/2');
  });

  it('does not merge when the confirmation is dismissed', async () => {
    mockDetail(productDetail({ id: 1, name: 'Lettmelk 1 l' }));
    vi.mocked(useProducts).mockReturnValue({
      data: [product({ id: 2, name: 'Yoghurt' })],
    } as unknown as ReturnType<typeof useProducts>);
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderProductPage(1);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Slå sammen med…' }));
    await user.type(screen.getByLabelText('Slå sammen med'), 'Yog');
    await user.click(screen.getByRole('button', { name: 'Yoghurt' }));

    expect(mergeMutate).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  describe('Varegruppe section (T40)', () => {
    it('shows a variant with a link to its parent and a detach button', async () => {
      mockDetail(
        productDetail({ id: 2, name: 'Skyr mini jordbær', parent: { id: 1, name: 'Skyr mini' } }),
      );
      renderProductPage(2);
      const user = userEvent.setup();

      expect(screen.getByRole('link', { name: 'Variant av «Skyr mini»' })).toHaveAttribute(
        'href',
        '/products/1',
      );

      await user.click(screen.getByRole('button', { name: 'Fjern fra gruppen' }));

      expect(detachMutate).toHaveBeenCalled();
    });

    it('shows a parent with its variants and folded group stats, no Legg i gruppe button', () => {
      mockDetail(
        productDetail({
          id: 1,
          name: 'Skyr mini',
          variantCount: 2,
          variants: [
            { id: 2, name: 'Skyr mini jordbær', timesBought: 3, lastBought: '2026-08-20' },
            { id: 3, name: 'Skyr mini banan', timesBought: 1, lastBought: null },
          ],
          groupStats: { timesBought: 4, lastBought: '2026-08-20', medianIntervalDays: 7 },
        }),
      );
      renderProductPage(1);

      expect(screen.getByText('Varianter (2)')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /Skyr mini jordbær/ })).toHaveAttribute(
        'href',
        '/products/2',
      );
      expect(
        screen.getByText(/Gruppen: kjøpt 4 ganger, sist.*ca\. hver 7\. dag/),
      ).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Legg i gruppe…' })).not.toBeInTheDocument();
    });

    it('attaches directly to a candidate that is already a group', async () => {
      mockDetail(productDetail({ id: 1, name: 'Skyr mini jordbær' }));
      vi.mocked(useProducts).mockReturnValue({
        data: [product({ id: 5, name: 'Skyr mini', variantCount: 2 })],
      } as unknown as ReturnType<typeof useProducts>);
      renderProductPage(1);
      const user = userEvent.setup();

      await user.click(screen.getByRole('button', { name: 'Legg i gruppe…' }));
      await user.type(screen.getByLabelText('Legg i gruppe'), 'Skyr');
      await user.click(screen.getByRole('button', { name: 'Skyr mini' }));

      expect(attachMutate).toHaveBeenCalledWith(5, expect.anything());
      expect(createGroupMutate).not.toHaveBeenCalled();
    });

    it('opens a naming dialog for an ungrouped candidate and creates the group with both ids', async () => {
      mockDetail(productDetail({ id: 1, name: 'Skyr mini jordbær' }));
      vi.mocked(useProducts).mockReturnValue({
        data: [product({ id: 6, name: 'Skyr mini banan', variantCount: 0 })],
      } as unknown as ReturnType<typeof useProducts>);
      renderProductPage(1);
      const user = userEvent.setup();

      await user.click(screen.getByRole('button', { name: 'Legg i gruppe…' }));
      await user.type(screen.getByLabelText('Legg i gruppe'), 'Skyr mini banan');
      await user.click(screen.getByRole('button', { name: 'Skyr mini banan' }));

      const nameInput = screen.getByLabelText('Navn på varegruppen');
      expect(nameInput).toHaveValue('Skyr mini');
      await user.click(screen.getByRole('button', { name: 'Lag gruppe' }));

      expect(createGroupMutate).toHaveBeenCalledWith(
        { name: 'Skyr mini', memberIds: [1, 6] },
        expect.anything(),
      );
    });

    it('creates a solo group from a typed name with no match', async () => {
      mockDetail(productDetail({ id: 1, name: 'Skyr mini jordbær' }));
      vi.mocked(useProducts).mockReturnValue({
        data: [],
      } as unknown as ReturnType<typeof useProducts>);
      renderProductPage(1);
      const user = userEvent.setup();

      await user.click(screen.getByRole('button', { name: 'Legg i gruppe…' }));
      await user.type(screen.getByLabelText('Legg i gruppe'), 'Skyr mini');
      await user.click(screen.getByRole('button', { name: 'Opprett «Skyr mini»' }));

      expect(createGroupMutate).toHaveBeenCalledWith(
        { name: 'Skyr mini', memberIds: [1] },
        expect.anything(),
      );
    });
  });
});
