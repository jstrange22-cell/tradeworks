import { useMemo } from 'react';
import { DollarSign, Percent, TrendingUp, Activity } from 'lucide-react';
import type { TradeData } from '@/types/analytics';

interface AnalyticsSummaryProps {
  trades: TradeData[];
}

interface SummaryStats {
  totalPnl: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  totalTrades: number;
  expectancy: number;
  maxDrawdown: number;
}

function computeStats(trades: TradeData[]): SummaryStats {
  if (trades.length === 0) {
    return { totalPnl: 0, winRate: 0, avgWin: 0, avgLoss: 0, profitFactor: 0, totalTrades: 0, expectancy: 0, maxDrawdown: 0 };
  }

  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl < 0);
  const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);
  const grossProfit = wins.reduce((sum, t) => sum + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0));

  // Max drawdown from cumulative P&L
  let peak = 0;
  let maxDD = 0;
  let cumulative = 0;
  const sorted = [...trades].sort((a, b) => a.executedAt.localeCompare(b.executedAt));
  for (const trade of sorted) {
    cumulative += trade.pnl;
    if (cumulative > peak) peak = cumulative;
    const dd = peak - cumulative;
    if (dd > maxDD) maxDD = dd;
  }

  return {
    totalPnl,
    winRate: trades.length > 0 ? (wins.length / trades.length) * 100 : 0,
    avgWin: wins.length > 0 ? grossProfit / wins.length : 0,
    avgLoss: losses.length > 0 ? grossLoss / losses.length : 0,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    totalTrades: trades.length,
    expectancy: trades.length > 0 ? totalPnl / trades.length : 0,
    maxDrawdown: maxDD,
  };
}

interface StatCardProps {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  valueColor?: string;
}

function StatCard({ label, value, icon: Icon, valueColor = 'text-slate-100' }: StatCardProps) {
  return (
    <div className="rounded-lg bg-slate-800/50 p-3">
      <div className="flex items-center gap-1.5 text-xs text-slate-500">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className={`mt-1 text-lg font-bold ${valueColor}`}>{value}</div>
    </div>
  );
}

export function AnalyticsSummary({ trades }: AnalyticsSummaryProps) {
  const stats = useMemo(() => computeStats(trades), [trades]);

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <StatCard
        label="Total P&L"
        value={`${stats.totalPnl >= 0 ? '+' : ''}$${stats.totalPnl.toFixed(2)}`}
        icon={DollarSign}
        valueColor={stats.totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}
      />
      <StatCard
        label="Win Rate"
        value={`${stats.winRate.toFixed(1)}%`}
        icon={Percent}
        valueColor={stats.winRate >= 50 ? 'text-green-400' : 'text-red-400'}
      />
      <StatCard
        label="Profit Factor"
        value={stats.profitFactor === Infinity ? '--' : stats.profitFactor.toFixed(2)}
        icon={TrendingUp}
        valueColor={stats.profitFactor >= 1 ? 'text-green-400' : 'text-red-400'}
      />
      <StatCard
        label="Max Drawdown"
        value={`-$${stats.maxDrawdown.toFixed(2)}`}
        icon={Activity}
        valueColor="text-red-400"
      />
      <StatCard
        label="Avg Win"
        value={`+$${stats.avgWin.toFixed(2)}`}
        icon={TrendingUp}
        valueColor="text-green-400"
      />
      <StatCard
        label="Avg Loss"
        value={`-$${stats.avgLoss.toFixed(2)}`}
        icon={Activity}
        valueColor="text-red-400"
      />
      <StatCard
        label="Expectancy"
        value={`${stats.expectancy >= 0 ? '+' : ''}$${stats.expectancy.toFixed(2)}`}
        icon={DollarSign}
        valueColor={stats.expectancy >= 0 ? 'text-green-400' : 'text-red-400'}
      />
      <StatCard
        label="Total Trades"
        value={String(stats.totalTrades)}
        icon={Activity}
      />
    </div>
  );
}
