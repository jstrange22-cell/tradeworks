import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { ApiKeysResponse, TestResult, MaskedApiKey } from '@/types/settings';

// ---------------------------------------------------------------------------
// Query: fetch all API keys
// ---------------------------------------------------------------------------

export function useApiKeysQuery() {
  const { data, isLoading, error } = useQuery<ApiKeysResponse>({
    queryKey: ['api-keys'],
    queryFn: () => apiClient.get<ApiKeysResponse>('/settings/api-keys'),
    refetchInterval: 30000,
  });

  return {
    apiKeys: data?.data ?? [],
    isLoading,
    error,
  };
}

// ---------------------------------------------------------------------------
// Mutation: add a new API key
// ---------------------------------------------------------------------------

interface AddKeyPayload {
  service: string;
  keyName: string;
  apiKey: string;
  apiSecret?: string;
  passphrase?: string;
  environment: string;
}

export function useAddApiKeyMutation(options?: { onSuccess?: () => void; onError?: (err: Error) => void }) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: AddKeyPayload) => apiClient.post('/settings/api-keys', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      options?.onSuccess?.();
    },
    onError: (err: Error) => {
      options?.onError?.(err);
    },
  });
}

// ---------------------------------------------------------------------------
// Mutation: test an API key connection
// ---------------------------------------------------------------------------

export function useTestApiKeyMutation(apiKey: MaskedApiKey) {
  return useMutation({
    mutationFn: () => apiClient.post<TestResult>(`/settings/api-keys/${apiKey.id}/test`),
  });
}

// ---------------------------------------------------------------------------
// Mutation: delete an API key
// ---------------------------------------------------------------------------

export function useDeleteApiKeyMutation(options?: { onSuccess?: () => void }) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (keyId: string) => apiClient.delete(`/settings/api-keys/${keyId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      options?.onSuccess?.();
    },
  });
}

// ---------------------------------------------------------------------------
// Helper: invalidate API keys cache
// ---------------------------------------------------------------------------

export function useInvalidateApiKeys() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['api-keys'] });
}
