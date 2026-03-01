import { useQuery } from '@tanstack/react-query';
import { usePortfolioStore, type PortfolioPosition, type RecentTrade, type EquityCurvePoint } from '@/stores/portfolio-store';
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

export function usePortfolio() {
  const store = usePortfolioStore();

  const { data, isLoading, error } = useQuery({
    queryKey: ['portfolio'],
    queryFn: () => apiClient.get<PortfolioResponse>('/portfolio'),
    refetchInterval: 30_000,
    retry: 2,
  });

  // When API data is available, use it; otherwise fall back to store mock data
  if (data) {
    return {
      equity: data.equity,
      initialCapital: data.initialCapital,
      dailyPnl: data.dailyPnl,
      dailyPnlPercent: data.dailyPnlPercent,
      weeklyPnl: data.weeklyPnl,
      totalPnl: data.totalPnl,
      winRate: data.winRate,
      totalTrades: data.totalTrades,
      openPositions: data.openPositions,
      recentTrades: data.recentTrades,
      equityCurve: data.equityCurve,
      paperTrading: data.paperTrading,
      circuitBreaker: data.circuitBreaker,
      isLoading,
      error,
    };
  }

  // Fallback to Zustand store mock data when gateway is not running
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
    isLoading,
    error,
  };
}
