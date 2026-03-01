import { useQuery } from '@tanstack/react-query';
import { usePortfolioStore } from '@/stores/portfolio-store';
import { apiClient } from '@/lib/api-client';

interface PortfolioResponse {
  equity: number;
  dailyPnl: number;
  dailyPnlPercent: number;
  weeklyPnl: number;
  totalPnl: number;
  winRate: number;
  totalTrades: number;
  openPositions: unknown[];
  recentTrades: unknown[];
  equityCurve: unknown[];
  paperTrading: boolean;
  circuitBreaker: boolean;
}

export function usePortfolio() {
  const store = usePortfolioStore();

  const query = useQuery({
    queryKey: ['portfolio'],
    queryFn: () => apiClient.get<PortfolioResponse>('/portfolio'),
    enabled: false, // Disabled until API is available; using mock data from store
    refetchInterval: 30_000,
  });

  return {
    equity: store.equity,
    initialCapital: store.initialCapital,
    dailyPnl: store.dailyPnl,
    dailyPnlPercent: store.dailyPnlPercent,
    weeklyPnl: store.weeklyPnl,
    totalPnl: store.totalPnl,
    winRate: store.winRate,
    totalTrades: store.totalTrades,
    openPositions: store.openPositions,
    recentTrades: store.recentTrades,
    equityCurve: store.equityCurve,
    paperTrading: store.paperTrading,
    circuitBreaker: store.circuitBreaker,
    isLoading: query.isLoading,
    error: query.error,
  };
}
