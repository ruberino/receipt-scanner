import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import type {
  PatchProductRequest,
  PatchReceiptLineRequest,
  PatchReceiptRequest,
  Product,
  ProductDetail,
  ReceiptDetail,
  ReceiptLine,
  ReceiptStatus,
  ReceiptSummary,
} from '../../shared/schemas.ts';
import { fetchJson, uploadFile } from './client.ts';

const POLLING_STATUSES = new Set<ReceiptStatus>(['pending', 'processing']);
const POLLING_INTERVAL_MS = 2000;

/** Extracted so polling stopping on `done`/`failed` is directly testable, no timers involved. */
export function receiptRefetchInterval(status: ReceiptStatus | undefined): number | false {
  return status !== undefined && POLLING_STATUSES.has(status) ? POLLING_INTERVAL_MS : false;
}

/** A receipt/line correction can change product history and therefore suggestions too. */
function invalidateReceiptRelated(queryClient: QueryClient, receiptId?: number): void {
  if (receiptId !== undefined) {
    void queryClient.invalidateQueries({ queryKey: ['receipt', receiptId] });
  }
  void queryClient.invalidateQueries({ queryKey: ['receipts'] });
  void queryClient.invalidateQueries({ queryKey: ['products'] });
  void queryClient.invalidateQueries({ queryKey: ['suggestions'] });
}

type MeResponse = { authenticated: true };

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => fetchJson<MeResponse>('/api/auth/me'),
    retry: false,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (password: string) =>
      fetchJson<void>('/api/auth/login', { method: 'POST', body: JSON.stringify({ password }) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => fetchJson<void>('/api/auth/logout', { method: 'POST' }),
    onSettled: () => {
      // A 401 here means the cookie was already invalid: logged out either way.
      queryClient.clear();
    },
  });
}

export function useUploadReceipt() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      file,
      onProgress,
    }: {
      file: File | Blob;
      onProgress?: (fraction: number) => void;
    }) => uploadFile('/api/receipts', file, onProgress) as Promise<{ id: number }>,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['receipts'] });
    },
  });
}

export function useReceipt(id: number) {
  return useQuery({
    queryKey: ['receipt', id],
    queryFn: () => fetchJson<ReceiptDetail>(`/api/receipts/${id}`),
    refetchInterval: (query) => receiptRefetchInterval(query.state.data?.status),
  });
}

export function useReceipts() {
  return useQuery({
    queryKey: ['receipts'],
    queryFn: () => fetchJson<ReceiptSummary[]>('/api/receipts'),
  });
}

const RECEIPTS_LIST_PAGE_SIZE = 50;

/** Extracted so "keep polling while anything on the list is in flight" is testable without timers. */
export function receiptsListRefetchInterval(pages: ReceiptSummary[][] | undefined): number | false {
  const anyInFlight = (pages ?? []).some((page) =>
    page.some((receipt) => POLLING_STATUSES.has(receipt.status)),
  );
  return anyInFlight ? POLLING_INTERVAL_MS : false;
}

export function useReceiptsList() {
  return useInfiniteQuery({
    queryKey: ['receipts', 'list'],
    queryFn: ({ pageParam }: { pageParam: number | undefined }) =>
      fetchJson<ReceiptSummary[]>(
        pageParam === undefined
          ? `/api/receipts?limit=${RECEIPTS_LIST_PAGE_SIZE}`
          : `/api/receipts?limit=${RECEIPTS_LIST_PAGE_SIZE}&before=${pageParam}`,
      ),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.length === RECEIPTS_LIST_PAGE_SIZE ? lastPage[lastPage.length - 1]?.id : undefined,
    refetchInterval: (query) => receiptsListRefetchInterval(query.state.data?.pages),
  });
}

/** Unbound so ScanPage's "Skann alle" can call it per id from a dynamic list, not just ReceiptPage's own. */
export function useScanReceipt() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) =>
      fetchJson<ReceiptSummary>(`/api/receipts/${id}/scan`, { method: 'POST' }),
    onSuccess: (_data, id) => invalidateReceiptRelated(queryClient, id),
  });
}

export function useUpdateReceipt(id: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: PatchReceiptRequest) =>
      fetchJson<ReceiptDetail>(`/api/receipts/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: () => invalidateReceiptRelated(queryClient, id),
  });
}

export function useUpdateReceiptLine(receiptId: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ lineId, ...body }: { lineId: number } & PatchReceiptLineRequest) =>
      fetchJson<ReceiptLine>(`/api/receipt-lines/${lineId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: () => invalidateReceiptRelated(queryClient, receiptId),
  });
}

export function useRematch(id: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => fetchJson<ReceiptDetail>(`/api/receipts/${id}/rematch`, { method: 'POST' }),
    onSuccess: () => invalidateReceiptRelated(queryClient, id),
  });
}

export function useDeleteReceipt(id: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => fetchJson<void>(`/api/receipts/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ['receipt', id] });
      invalidateReceiptRelated(queryClient);
    },
  });
}

export function useProductSearch(query: string, enabled: boolean) {
  return useQuery({
    queryKey: ['products', 'search', query],
    queryFn: () => fetchJson<Product[]>(`/api/products?q=${encodeURIComponent(query)}`),
    enabled: enabled && query.trim().length > 0,
  });
}

export function useProducts(params: { q?: string; includeSuppressed?: boolean } = {}) {
  const trimmedQuery = params.q?.trim() ?? '';
  const includeSuppressed = params.includeSuppressed ?? false;
  const search = new URLSearchParams();
  if (trimmedQuery.length > 0) {
    search.set('q', trimmedQuery);
  }
  if (includeSuppressed) {
    search.set('includeSuppressed', 'true');
  }
  const queryString = search.toString();

  return useQuery({
    queryKey: ['products', 'list', trimmedQuery, includeSuppressed],
    queryFn: () =>
      fetchJson<Product[]>(`/api/products${queryString.length > 0 ? `?${queryString}` : ''}`),
  });
}

export function useProductDetail(id: number) {
  return useQuery({
    queryKey: ['products', 'detail', id],
    queryFn: () => fetchJson<ProductDetail>(`/api/products/${id}`),
  });
}

export function useUpdateProduct(id: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: PatchProductRequest) =>
      fetchJson<Product>(`/api/products/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });
}

/** Bound to the source product; merges it into whichever id is passed to `.mutate()`. */
export function useMergeProduct(id: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (intoProductId: number) =>
      fetchJson<Product>(`/api/products/${id}/merge`, {
        method: 'POST',
        body: JSON.stringify({ intoProductId }),
      }),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ['products', 'detail', id] });
      void queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });
}

export function useDeleteProductAlias() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (aliasId: number) =>
      fetchJson<void>(`/api/product-aliases/${aliasId}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });
}
