/**
 * TanStack Query hooks for the cockpit.
 *
 * Two refetch tiers:
 *   - hot  (5s):  P&L, positions, decisions feed
 *   - slow (30s): bandit, heat, regime, kill switches, exits status
 *
 * Future: agent E5 will replace these with SSE streams. Until then, polling.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type {
  BanditWeightsResponse,
  ExitMonitorStatusResponse,
  ExitPositionsResponse,
  HeatResponse,
  KillSwitchStatusResponse,
  PortfolioSummary,
  RegimeResponse,
  TradevisorDecisionsResponse,
} from './types';

const HOT_INTERVAL_MS = 5_000;
const SLOW_INTERVAL_MS = 30_000;

// `retry: 1` keeps a single re-attempt per fetch but stops noisy retry loops
// when the gateway is down (so the page renders error state quickly).
const COMMON_OPTS = {
  retry: 1,
  refetchOnWindowFocus: false,
  staleTime: 1_000,
} as const;

// ── Hot data ─────────────────────────────────────────────────────────────

export function usePortfolioSummary() {
  return useQuery<PortfolioSummary>({
    queryKey: ['cockpit', 'portfolio'],
    queryFn: () => apiClient.get('/portfolio'),
    refetchInterval: HOT_INTERVAL_MS,
    ...COMMON_OPTS,
  });
}

export function useTradevisorDecisions(limit = 20) {
  return useQuery<TradevisorDecisionsResponse>({
    queryKey: ['cockpit', 'tradevisor-decisions', limit],
    queryFn: () => apiClient.get('/tradevisor-agent/decisions', { limit }),
    refetchInterval: HOT_INTERVAL_MS,
    ...COMMON_OPTS,
  });
}

// ── Slow data ────────────────────────────────────────────────────────────

export function useRegime() {
  return useQuery<RegimeResponse>({
    queryKey: ['cockpit', 'regime'],
    queryFn: () => apiClient.get('/regime'),
    refetchInterval: SLOW_INTERVAL_MS,
    ...COMMON_OPTS,
  });
}

export function usePortfolioHeat() {
  return useQuery<HeatResponse>({
    queryKey: ['cockpit', 'heat'],
    queryFn: () => apiClient.get('/heat'),
    refetchInterval: SLOW_INTERVAL_MS,
    ...COMMON_OPTS,
  });
}

export function useBanditWeights() {
  return useQuery<BanditWeightsResponse>({
    queryKey: ['cockpit', 'bandit-weights'],
    queryFn: () => apiClient.get('/bandit/weights'),
    refetchInterval: SLOW_INTERVAL_MS,
    ...COMMON_OPTS,
  });
}

export function useKillSwitchStatus() {
  return useQuery<KillSwitchStatusResponse>({
    queryKey: ['cockpit', 'kill-switches'],
    queryFn: () => apiClient.get('/kill-switches/status'),
    refetchInterval: SLOW_INTERVAL_MS,
    ...COMMON_OPTS,
  });
}

export function useExitMonitorStatus() {
  return useQuery<ExitMonitorStatusResponse>({
    queryKey: ['cockpit', 'exits-status'],
    queryFn: () => apiClient.get('/exits/status'),
    refetchInterval: SLOW_INTERVAL_MS,
    ...COMMON_OPTS,
  });
}

export function useExitPositions() {
  return useQuery<ExitPositionsResponse>({
    queryKey: ['cockpit', 'exits-positions'],
    queryFn: () => apiClient.get('/exits/positions'),
    refetchInterval: SLOW_INTERVAL_MS,
    ...COMMON_OPTS,
  });
}

// ── Master kill mutation ─────────────────────────────────────────────────

export function useMasterKillMutation() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, { reason: string }>({
    mutationFn: (body) => apiClient.post('/kill-switches/master-kill', body),
    onSuccess: () => {
      // Refetch every cockpit query so the UI reflects the new state.
      qc.invalidateQueries({ queryKey: ['cockpit'] });
    },
  });
}
