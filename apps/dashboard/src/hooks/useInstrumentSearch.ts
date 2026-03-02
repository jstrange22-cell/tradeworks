import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useDebounce } from './useDebounce';

export interface InstrumentInfo {
  symbol: string;
  displayName: string;
  market: 'crypto' | 'equities' | 'prediction';
  exchange: string;
  tradable: boolean;
}

interface InstrumentsResponse {
  data: InstrumentInfo[];
  total: number;
  cached: boolean;
}

/**
 * Hook for searching tradable instruments across all markets.
 * Calls the gateway /market/instruments endpoint with debounced search.
 *
 * @param market - Optional filter: 'crypto' | 'equities' | 'prediction'
 * @param limit  - Max results (default 50)
 */
export function useInstrumentSearch(market?: string, limit = 50) {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 300);

  const { data, isLoading } = useQuery<InstrumentsResponse>({
    queryKey: ['instruments', market, debouncedQuery, limit],
    queryFn: () =>
      apiClient.get<InstrumentsResponse>('/market/instruments', {
        market: market || undefined,
        search: debouncedQuery || undefined,
        limit,
      }),
    staleTime: 60_000,
    placeholderData: (prev) => prev, // keep previous data while loading
  });

  const results = data?.data ?? [];

  return {
    query,
    setQuery,
    results,
    isLoading,
    total: data?.total ?? 0,
  };
}

/**
 * Fetch instruments once (no search/debounce) — for market pages that just
 * need a list of instruments for a given market.
 */
export function useInstruments(market: string, limit = 50) {
  return useQuery<InstrumentsResponse>({
    queryKey: ['instruments-list', market, limit],
    queryFn: () =>
      apiClient.get<InstrumentsResponse>('/market/instruments', {
        market,
        limit,
      }),
    staleTime: 5 * 60_000, // cache for 5 min
  });
}
