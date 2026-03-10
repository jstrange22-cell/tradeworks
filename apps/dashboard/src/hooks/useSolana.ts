import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type {
  SolanaBalanceData, TokenInfo, TokenSafety, PumpFunToken,
  SniperConfig, SnipeExecution, WhaleActivity, TrackedWhale,
  MoonshotScore,
} from '@/types/solana';

// ─── Core Wallet / Balance Queries ──────────────────────────────────────

export function useWalletStatus() {
  return useQuery({
    queryKey: ['solana-wallet'],
    queryFn: () => apiClient.get<{ connected: boolean; wallet: string | null; rpcUrl: string | null }>('/solana/wallet'),
  });
}

export function useBalances(connected: boolean) {
  return useQuery({
    queryKey: ['solana-balances'],
    queryFn: () => apiClient.get<{ data: SolanaBalanceData }>('/solana/balances'),
    enabled: connected,
    refetchInterval: 30_000,
  });
}

// ─── Scanner Queries ────────────────────────────────────────────────────

export function useTrending() {
  return useQuery({
    queryKey: ['solana-trending'],
    queryFn: () => apiClient.get<{ data: TokenInfo[]; total: number }>('/solana/trending'),
    refetchInterval: 60_000,
  });
}

export function useNewTokens(enabled: boolean) {
  return useQuery({
    queryKey: ['solana-new-tokens'],
    queryFn: () => apiClient.get<{ data: TokenInfo[]; total: number }>('/solana/new-tokens'),
    enabled,
    refetchInterval: 60_000,
  });
}

export function useTokenDetail(mint: string | null) {
  return useQuery({
    queryKey: ['solana-token', mint],
    queryFn: () => apiClient.get<{ data: { token: TokenInfo | null; safety: TokenSafety } }>(`/solana/token/${mint}`),
    enabled: !!mint,
  });
}

export function useSwap() {
  return useMutation({
    mutationFn: (data: { inputMint: string; outputMint: string; amount: string; slippageBps: number }) =>
      apiClient.post<{ data: { signature: string; success: boolean }; message: string }>('/solana/swap', data),
  });
}

// ─── PumpFun Queries ────────────────────────────────────────────────────

export function usePumpFunLatest(enabled: boolean) {
  return useQuery({
    queryKey: ['pumpfun-latest'],
    queryFn: () => apiClient.get<{ data: PumpFunToken[] }>('/solana/pumpfun/latest?limit=30'),
    enabled,
    refetchInterval: 10_000,
  });
}

export function usePumpFunStatus(enabled: boolean) {
  return useQuery({
    queryKey: ['pumpfun-monitor'],
    queryFn: () => apiClient.get<{ running: boolean; totalDetected: number; recentLaunches: PumpFunToken[] }>('/solana/pumpfun/monitor/status'),
    enabled,
    refetchInterval: 5_000,
  });
}

export function usePumpFunToggle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (running: boolean) =>
      apiClient.post<{ message: string }>(running ? '/solana/pumpfun/monitor/stop' : '/solana/pumpfun/monitor/start', {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pumpfun-monitor'] }),
  });
}

// ─── Sniper Queries ─────────────────────────────────────────────────────

export function useSniperConfig(enabled: boolean) {
  return useQuery({
    queryKey: ['sniper-config'],
    queryFn: () => apiClient.get<{ data: SniperConfig }>('/solana/sniper/config'),
    enabled,
  });
}

export function useSniperStatus(enabled: boolean) {
  return useQuery({
    queryKey: ['sniper-status'],
    queryFn: () => apiClient.get<{ running: boolean; dailySpentSol: number; dailyBudgetSol: number; openPositions: unknown[]; recentExecutions: SnipeExecution[] }>('/solana/sniper/status'),
    enabled,
    refetchInterval: 5_000,
  });
}

export function useSniperToggle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (running: boolean) =>
      apiClient.post<{ message: string }>(running ? '/solana/sniper/stop' : '/solana/sniper/start', {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sniper-status'] }),
  });
}

export function useSniperUpdateConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (cfg: Partial<SniperConfig>) =>
      apiClient.put<{ data: SniperConfig }>('/solana/sniper/config', cfg),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sniper-config'] }),
  });
}

export function useSniperExecute() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { mint: string; symbol?: string; name?: string }) =>
      apiClient.post<{ data: SnipeExecution }>('/solana/sniper/execute', data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sniper-status'] }),
  });
}

// ─── Whale Queries ──────────────────────────────────────────────────────

export function useWhaleList(enabled: boolean) {
  return useQuery({
    queryKey: ['whale-list'],
    queryFn: () => apiClient.get<{ data: TrackedWhale[] }>('/solana/whales/list'),
    enabled,
  });
}

export function useWhaleActivity(enabled: boolean) {
  return useQuery({
    queryKey: ['whale-activity'],
    queryFn: () => apiClient.get<{ data: WhaleActivity[] }>('/solana/whales/activity?limit=50'),
    enabled,
    refetchInterval: 10_000,
  });
}

export function useWhaleMonitorStatus(enabled: boolean) {
  return useQuery({
    queryKey: ['whale-monitor'],
    queryFn: () => apiClient.get<{ running: boolean; trackedWhales: number }>('/solana/whales/monitor/status'),
    enabled,
    refetchInterval: 5_000,
  });
}

export function useWhaleAdd() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { address: string; label: string }) =>
      apiClient.post<unknown>('/solana/whales/add', data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['whale-list'] }),
  });
}

export function useWhaleMonitorToggle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (running: boolean) =>
      apiClient.post<unknown>(running ? '/solana/whales/monitor/stop' : '/solana/whales/monitor/start', {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['whale-monitor'] }),
  });
}

// ─── Moonshot Queries ───────────────────────────────────────────────────

export function useMoonshotLeaderboard(enabled: boolean) {
  return useQuery({
    queryKey: ['moonshot-leaderboard'],
    queryFn: () => apiClient.get<{ data: MoonshotScore[] }>('/solana/moonshot/leaderboard'),
    enabled,
    refetchInterval: 30_000,
  });
}

export function useMoonshotAlerts(enabled: boolean) {
  return useQuery({
    queryKey: ['moonshot-alerts'],
    queryFn: () => apiClient.get<{ data: MoonshotScore[] }>('/solana/moonshot/alerts?limit=10'),
    enabled,
    refetchInterval: 15_000,
  });
}

export function useMoonshotScan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiClient.post<{ data: MoonshotScore[] }>('/solana/moonshot/scan', { limit: 15 }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['moonshot-leaderboard'] });
      queryClient.invalidateQueries({ queryKey: ['moonshot-alerts'] });
    },
  });
}

export function useMoonshotScoreOne() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (mint: string) => apiClient.post<{ data: MoonshotScore }>('/solana/moonshot/score', { mint }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['moonshot-leaderboard'] }),
  });
}
