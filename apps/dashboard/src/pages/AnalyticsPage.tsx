import { BarChart3, TrendingUp, Trophy, Layers, Coins } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { TradesResponse } from '@/types/analytics';
import { AnalyticsSummary } from '@/components/analytics/AnalyticsSummary';
import { MonthlyPnlHeatmap } from '@/components/analytics/MonthlyPnlHeatmap';
import { WinRateByStrategy } from '@/components/analytics/WinRateByStrategy';
import { SharpeRatioChart } from '@/components/analytics/SharpeRatioChart';
import { BestWorstTrades } from '@/components/analytics/BestWorstTrades';
import { TradeFrequencyChart } from '@/components/analytics/TradeFrequencyChart';
import { CumulativePnlChart } from '@/components/analytics/CumulativePnlChart';
import { SolanaAnalyticsPanel } from '@/components/analytics/SolanaAnalyticsPanel';
import { EVMetricsPanel } from '@/components/analytics/EVMetricsPanel';

// Multi-platform types
interface PlatformStats { trades: number; pnl: number; winRate: number; label: string; icon: React.ReactNode; color: string };

export function AnalyticsPage() {
  const { data: tradesData, isLoading } = useQuery<TradesResponse>({
    queryKey: ['trades-analytics'],
    queryFn: () => apiClient.get<TradesResponse>('/trades?limit=200'),
    refetchInterval: 60_000,
  });

  const trades = tradesData?.data ?? [];

  // Fetch all platform stats
  const { data: cryptoData } = useQuery({ queryKey: ['analytics-crypto'], queryFn: () => apiClient.get<{ data: { paperTrades: number; paperPnlUsd: number; paperWinRate: number } }>('/crypto/status'), refetchInterval: 30_000 });
  const { data: kalshiData } = useQuery({ queryKey: ['analytics-kalshi'], queryFn: () => apiClient.get<{ data: { trades: number; totalPnlUsd: number; wins: number; losses: number } }>('/polymarket/kalshi/paper'), refetchInterval: 30_000 });
  const { data: sportsData } = useQuery({ queryKey: ['analytics-sports'], queryFn: () => apiClient.get<{ data: { totalBets: number; totalPnlUsd: number; wins: number; losses: number; winRate: number } }>('/sports/portfolio'), refetchInterval: 30_000 });
  const { data: stocksData } = useQuery({ queryKey: ['analytics-stocks'], queryFn: () => apiClient.get<{ data: { totalTrades: number; totalPnlUsd: number; wins: number; losses: number; winRate: number } }>('/stocks-intel/portfolio'), refetchInterval: 30_000 });
  const { data: arbData } = useQuery({ queryKey: ['analytics-arb'], queryFn: () => apiClient.get<{ data: { tradesExecuted: number; opportunitiesFound: number } }>('/arb-intel/status'), refetchInterval: 30_000 });

  const crypto = (cryptoData as { data: { paperTrades: number; paperPnlUsd: number; paperWinRate: number } } | undefined)?.data;
  const kalshi = (kalshiData as { data: { trades: number; totalPnlUsd: number; wins: number; losses: number } } | undefined)?.data;
  const sports = (sportsData as { data: { totalBets: number; totalPnlUsd: number; wins: number; losses: number; winRate: number } } | undefined)?.data;
  const stocks = (stocksData as { data: { totalTrades: number; totalPnlUsd: number; wins: number; losses: number; winRate: number } } | undefined)?.data;
  const arb = (arbData as { data: { tradesExecuted: number; opportunitiesFound: number } } | undefined)?.data;

  const platforms: PlatformStats[] = [
    { label: 'Crypto Agent', trades: crypto?.paperTrades ?? 0, pnl: crypto?.paperPnlUsd ?? 0, winRate: crypto?.paperWinRate ?? 0, icon: <Coins className="h-4 w-4" />, color: 'text-blue-400' },
    { label: 'Kalshi', trades: kalshi?.trades ?? 0, pnl: kalshi?.totalPnlUsd ?? 0, winRate: kalshi?.trades ? Math.round(((kalshi?.wins ?? 0) / kalshi.trades) * 100) : 0, icon: <TrendingUp className="h-4 w-4" />, color: 'text-purple-400' },
    { label: 'Sports', trades: sports?.totalBets ?? 0, pnl: sports?.totalPnlUsd ?? 0, winRate: sports?.winRate ?? 0, icon: <Trophy className="h-4 w-4" />, color: 'text-emerald-400' },
    { label: 'Stocks', trades: stocks?.totalTrades ?? 0, pnl: stocks?.totalPnlUsd ?? 0, winRate: stocks?.winRate ?? 0, icon: <BarChart3 className="h-4 w-4" />, color: 'text-indigo-400' },
    { label: 'Arb Intel', trades: arb?.tradesExecuted ?? 0, pnl: 0, winRate: 0, icon: <Layers className="h-4 w-4" />, color: 'text-cyan-400' },
  ];

  const totalAllPlatformPnl = platforms.reduce((s, p) => s + p.pnl, 0);
  const totalAllPlatformTrades = platforms.reduce((s, p) => s + p.trades, 0);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <BarChart3 className="h-6 w-6 text-blue-400" />
          <h1 className="text-2xl font-bold text-slate-100">Portfolio Analytics</h1>
        </div>
        <div className="flex h-64 items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BarChart3 className="h-6 w-6 text-blue-400" />
          <h1 className="text-2xl font-bold text-slate-100">Portfolio Analytics</h1>
        </div>
        <div className="text-sm text-slate-500">
          {trades.length} trades analyzed
        </div>
      </div>

      {/* All-Platform Summary */}
      <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 overflow-hidden">
        <div className="border-b border-slate-700/30 px-4 py-2.5">
          <h2 className="text-xs font-semibold text-slate-300">All Trading Platforms</h2>
        </div>
        <div className="grid grid-cols-2 gap-px bg-slate-700/30 md:grid-cols-5">
          {platforms.map(p => (
            <div key={p.label} className="bg-slate-800/80 p-3">
              <div className="flex items-center gap-2 mb-1">
                <span className={p.color}>{p.icon}</span>
                <span className="text-[11px] font-medium text-slate-300">{p.label}</span>
              </div>
              <div className={`text-sm font-bold font-mono ${p.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {p.pnl >= 0 ? '+' : ''}${p.pnl.toFixed(2)}
              </div>
              <div className="text-[9px] text-slate-500">{p.trades}t · {p.winRate}% WR</div>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between px-4 py-2 bg-slate-900/50">
          <span className="text-xs text-slate-400">Total across all platforms</span>
          <div className="flex items-center gap-4">
            <span className="text-xs text-slate-500">{totalAllPlatformTrades} trades</span>
            <span className={`text-sm font-bold font-mono ${totalAllPlatformPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {totalAllPlatformPnl >= 0 ? '+' : ''}${totalAllPlatformPnl.toFixed(2)}
            </span>
          </div>
        </div>
      </div>

      {/* Crypto Trade Summary */}
      <AnalyticsSummary trades={trades} />

      {/* Expected Value Analysis */}
      <EVMetricsPanel trades={trades} />

      {/* Cumulative P&L Curve */}
      <CumulativePnlChart trades={trades} />

      {/* Solana Sniper Analytics */}
      <SolanaAnalyticsPanel />

      {/* Charts Row 1: Heatmap + Win Rate */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <MonthlyPnlHeatmap trades={trades} />
        <WinRateByStrategy trades={trades} />
      </div>

      {/* Charts Row 2: Sharpe + Frequency */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SharpeRatioChart trades={trades} />
        <TradeFrequencyChart trades={trades} />
      </div>

      {/* Best/Worst Trades Leaderboard */}
      <BestWorstTrades trades={trades} />
    </div>
  );
}
