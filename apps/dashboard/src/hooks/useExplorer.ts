/**
 * Trades & Decisions Explorer — data hooks.
 *
 * Two independent hooks:
 *   - `useExplorerList`: paginated, filtered list (drives the table + ribbon)
 *   - `useExplorerDetail`: single decision with full join (signal, context,
 *      reasoning, RAG retrievals, executions, outcome, active heuristics).
 *
 * Both backed by TanStack Query so route changes / filter tweaks naturally
 * dedupe and cache.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type {
  ExplorerListFilters,
  ExplorerListResponse,
  ExplorerDetailResponse,
  ExplorerAggregateResponse,
  AggregateGroupBy,
} from '@/types/explorer';

function filtersToParams(
  filters: ExplorerListFilters,
): Record<string, string | number | boolean | undefined> {
  const out: Record<string, string | number | boolean | undefined> = {};
  if (filters.strategy) out['strategy'] = filters.strategy;
  if (filters.verdict) out['verdict'] = filters.verdict;
  if (filters.regime) out['regime'] = filters.regime;
  if (filters.sector) out['sector'] = filters.sector;
  if (filters.symbol) out['symbol'] = filters.symbol;
  if (filters.minConfidence !== undefined) out['minConfidence'] = filters.minConfidence;
  if (filters.maxConfidence !== undefined) out['maxConfidence'] = filters.maxConfidence;
  if (filters.startDate) out['startDate'] = filters.startDate;
  if (filters.endDate) out['endDate'] = filters.endDate;
  return out;
}

export interface UseExplorerListOptions {
  filters: ExplorerListFilters;
  limit?: number;
  offset?: number;
  enabled?: boolean;
}

export function useExplorerList({
  filters,
  limit = 500,
  offset = 0,
  enabled = true,
}: UseExplorerListOptions) {
  const params = useMemo(
    () => ({ ...filtersToParams(filters), limit, offset }),
    [filters, limit, offset],
  );

  return useQuery<ExplorerListResponse>({
    queryKey: ['explorer', 'list', params],
    queryFn: () => apiClient.get<ExplorerListResponse>('/explorer/decisions', params),
    enabled,
    staleTime: 15_000,
  });
}

export function useExplorerDetail(id: string | undefined) {
  return useQuery<ExplorerDetailResponse>({
    queryKey: ['explorer', 'detail', id],
    queryFn: () => apiClient.get<ExplorerDetailResponse>(`/explorer/decisions/${id}`),
    enabled: !!id,
    staleTime: 30_000,
  });
}

export interface UseExplorerAggregateOptions {
  filters: ExplorerListFilters;
  groupBy: AggregateGroupBy;
  enabled?: boolean;
}

export function useExplorerAggregate({
  filters,
  groupBy,
  enabled = true,
}: UseExplorerAggregateOptions) {
  const params = useMemo(
    () => ({ ...filtersToParams(filters), groupBy }),
    [filters, groupBy],
  );
  return useQuery<ExplorerAggregateResponse>({
    queryKey: ['explorer', 'aggregate', params],
    queryFn: () => apiClient.get<ExplorerAggregateResponse>('/explorer/aggregates', params),
    enabled,
    staleTime: 30_000,
  });
}
