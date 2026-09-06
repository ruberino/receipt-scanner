import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from './client.ts';

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
