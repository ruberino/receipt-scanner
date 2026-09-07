import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import type {
  CreateShoppingListItemRequest,
  PatchProductRequest,
  PatchReceiptLineFieldsRequest,
  PatchReceiptLineRequest,
  PatchReceiptRequest,
  Product,
  ProductDetail,
  ReceiptDetail,
  ReceiptLine,
  ReceiptStatus,
  ReceiptSummary,
  ShoppingList,
  ShoppingListItem,
  ShoppingListSummary,
  StatsSummary,
  Suggestion,
} from '../../shared/schemas.ts';
import { ApiRequestError, fetchJson, uploadFile } from './client.ts';

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

/** T29: the amount/quantity/kind body, distinct from useUpdateReceiptLine's product-matching bodies. */
export function useUpdateReceiptLineFields(receiptId: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ lineId, ...body }: { lineId: number } & PatchReceiptLineFieldsRequest) =>
      fetchJson<ReceiptLine>(`/api/receipt-lines/${lineId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: () => invalidateReceiptRelated(queryClient, receiptId),
  });
}

export function useDeleteReceiptLine(receiptId: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (lineId: number) =>
      fetchJson<void>(`/api/receipt-lines/${lineId}`, { method: 'DELETE' }),
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

export function useSuggestions() {
  return useQuery({
    queryKey: ['suggestions'],
    queryFn: () => fetchJson<Suggestion[]>('/api/suggestions'),
  });
}

const CURRENT_SHOPPING_LIST_KEY = ['shopping-list', 'current'];

/** `null` means "no open list" (the server answers 404), a real success state, not an error. */
export function useCurrentShoppingList() {
  return useQuery({
    queryKey: CURRENT_SHOPPING_LIST_KEY,
    queryFn: async () => {
      try {
        return await fetchJson<ShoppingList>('/api/shopping-lists/current');
      } catch (error) {
        if (error instanceof ApiRequestError && error.status === 404) {
          return null;
        }
        throw error;
      }
    },
  });
}

export function useCreateShoppingList() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => fetchJson<ShoppingList>('/api/shopping-lists', { method: 'POST' }),
    onSuccess: (list) => {
      queryClient.setQueryData(CURRENT_SHOPPING_LIST_KEY, list);
    },
  });
}

export function useCreateShoppingListItem(listId: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: CreateShoppingListItemRequest) =>
      fetchJson<ShoppingListItem>(`/api/shopping-lists/${listId}/items`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CURRENT_SHOPPING_LIST_KEY });
    },
  });
}

/**
 * Unbound so every row can share it. The instant, revert-on-failure checked state itself lives in
 * `OpenListView`'s own state, not react-query's cache: `useMutation`'s `onMutate` still isn't
 * synchronous with the click that triggers `.mutate()` (its internal state machine always defers
 * at least a tick, async `onMutate` or not), which is exactly the T17 suppressed-checkbox bug again
 * if the checkbox's `checked` prop is bound to anything that updates on that delay. Plain local
 * `useState`, flipped directly in the click handler, is the only thing synchronous enough.
 */
export function useToggleShoppingListItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, checked }: { id: number; checked: boolean }) =>
      fetchJson<ShoppingListItem>(`/api/shopping-list-items/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ checked }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CURRENT_SHOPPING_LIST_KEY });
    },
  });
}

export function useDeleteShoppingListItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) =>
      fetchJson<void>(`/api/shopping-list-items/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CURRENT_SHOPPING_LIST_KEY });
    },
  });
}

/** `enabled` ties the fetch to the "Statistikk og historikk" `<details>` being open, so the everyday
 * visit to `/receipts` costs no extra request. */
export function useStatsSummary(enabled: boolean) {
  return useQuery({
    queryKey: ['stats', 'summary'],
    queryFn: () => fetchJson<StatsSummary>('/api/stats/summary'),
    enabled,
  });
}

/** Same gating as {@link useStatsSummary}. */
export function useShoppingListHistory(enabled: boolean) {
  return useQuery({
    queryKey: ['shopping-lists', 'history'],
    queryFn: () => fetchJson<ShoppingListSummary[]>('/api/shopping-lists'),
    enabled,
  });
}

export function useCompleteShoppingList(listId: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      fetchJson<ShoppingList>(`/api/shopping-lists/${listId}/complete`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.setQueryData(CURRENT_SHOPPING_LIST_KEY, null);
    },
  });
}

function invalidateShoppingListQueries(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: ['shopping-list'] });
  void queryClient.invalidateQueries({ queryKey: ['shopping-lists'] });
  void queryClient.invalidateQueries({ queryKey: ['suggestions'] });
}

export function useReopenShoppingList(listId: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      fetchJson<ShoppingList>(`/api/shopping-lists/${listId}/reopen`, { method: 'POST' }),
    onSuccess: () => invalidateShoppingListQueries(queryClient),
  });
}

export function useDeleteShoppingList(listId: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => fetchJson<void>(`/api/shopping-lists/${listId}`, { method: 'DELETE' }),
    onSuccess: () => invalidateShoppingListQueries(queryClient),
  });
}

/** The latest list regardless of status, so the preview can offer `Gjenåpne listen` when it was
 * completed today (T31); `useShoppingListHistory` is gated behind the collapsed stats section and
 * not always fetched, so this is its own always-on query. */
export function useLatestShoppingList() {
  return useQuery({
    queryKey: ['shopping-lists', 'latest'],
    queryFn: async () => {
      const lists = await fetchJson<ShoppingListSummary[]>('/api/shopping-lists?limit=1');
      return lists[0] ?? null;
    },
  });
}
