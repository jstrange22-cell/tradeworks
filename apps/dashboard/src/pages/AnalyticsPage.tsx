import { BarChart3 } from 'lucide-react';
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

export function AnalyticsPage() {
  const { data: tradesData, isLoading } = useQuery<TradesResponse>({
    queryKey: ['trades-analytics'],
    queryFn: () => apiClient.get<TradesResponse>('/trades?limit=200'),
    refetchInterval: 60_000,
  });

  const trades = tradesData?.data ?? [];

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

      {/* Summary Stats */}
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
