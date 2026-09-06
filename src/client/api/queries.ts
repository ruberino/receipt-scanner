import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReceiptDetail, ReceiptStatus, ReceiptSummary } from '../../shared/schemas.ts';
import { fetchJson, uploadFile } from './client.ts';

const POLLING_STATUSES = new Set<ReceiptStatus>(['pending', 'processing']);
const POLLING_INTERVAL_MS = 2000;

/** Extracted so polling stopping on `done`/`failed` is directly testable, no timers involved. */
export function receiptRefetchInterval(status: ReceiptStatus | undefined): number | false {
  return status !== undefined && POLLING_STATUSES.has(status) ? POLLING_INTERVAL_MS : false;
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
  return useMutation({
    mutationFn: ({
      file,
      onProgress,
    }: {
      file: File | Blob;
      onProgress?: (fraction: number) => void;
    }) => uploadFile('/api/receipts', file, onProgress) as Promise<{ id: number }>,
  });
}

export function useReceipt(id: number) {
  return useQuery({
    queryKey: ['receipt', id],
    queryFn: () => fetchJson<ReceiptDetail>(`/api/receipts/${id}`),
    refetchInterval: (query) => receiptRefetchInterval(query.state.data?.status),
  });
}

export function useRetryReceipt(id: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => fetchJson<ReceiptSummary>(`/api/receipts/${id}/retry`, { method: 'POST' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['receipt', id] });
    },
  });
}
