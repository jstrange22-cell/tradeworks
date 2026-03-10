import { useQuery } from '@tanstack/react-query';
import type { PortfolioPosition, RecentTrade, EquityCurvePoint } from '@/stores/portfolio-store';
import { apiClient } from '@/lib/api-client';

interface PortfolioResponse {
  equity: number;
  initialCapital: number;
  dailyPnl: number;
  dailyPnlPercent: number;
  weeklyPnl: number;
  totalPnl: number;
  winRate: number;
  totalTrades: number;
  openPositions: PortfolioPosition[];
  recentTrades: RecentTrade[];
  equityCurve: EquityCurvePoint[];
  paperTrading: boolean;
  circuitBreaker: boolean;
}

const DEFAULTS: PortfolioResponse = {
  equity: 0, initialCapital: 0, dailyPnl: 0, dailyPnlPercent: 0,
  weeklyPnl: 0, totalPnl: 0, winRate: 0, totalTrades: 0,
  openPositions: [], recentTrades: [], equityCurve: [],
  paperTrading: true, circuitBreaker: false,
};

/**
 * Single source of truth for portfolio data.
 * TanStack Query fetches initial data; WebSocket events update the cache
 * via queryClient.setQueryData() in useWebSocket — no Zustand duplication.
 */
export function usePortfolio() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['portfolio'],
    queryFn: () => apiClient.get<PortfolioResponse>('/portfolio'),
    refetchInterval: 30_000,
    retry: 2,
  });

  const portfolio = data ?? DEFAULTS;

  return {
    ...portfolio,
    isLoading,
    error,
  };
}
