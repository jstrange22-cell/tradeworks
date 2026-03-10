import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Briefcase,
  Target,
} from 'lucide-react';
import type { PortfolioPosition } from '@/stores/portfolio-store';

interface PortfolioSummaryProps {
  equity: number;
  initialCapital: number;
  dailyPnl: number;
  dailyPnlPercent: number;
  openPositions: PortfolioPosition[];
  winRate: number;
  totalTrades: number;
}

export function PortfolioSummary({
  equity,
  initialCapital,
  dailyPnl,
  dailyPnlPercent,
  openPositions,
  winRate,
  totalTrades,
}: PortfolioSummaryProps) {
  const totalReturn = initialCapital > 0 ? ((equity - initialCapital) / initialCapital) * 100 : 0;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {/* Total Equity */}
      <div className="card">
        <div className="card-header flex items-center gap-2">
          <DollarSign className="h-4 w-4" />
          Total Equity
        </div>
        <div className="stat-value-lg text-slate-100">
          ${equity.toLocaleString('en-US', { minimumFractionDigits: 2 })}
        </div>
        <div
          className={`mt-1 text-sm font-medium ${
            totalReturn >= 0 ? 'text-green-400' : 'text-red-400'
          }`}
        >
          {totalReturn >= 0 ? '+' : ''}
          {totalReturn.toFixed(2)}% all time
        </div>
      </div>

      {/* Daily P&L */}
      <div className="card">
        <div className="card-header flex items-center gap-2">
          {dailyPnl >= 0 ? (
            <TrendingUp className="h-4 w-4 text-green-400" />
          ) : (
            <TrendingDown className="h-4 w-4 text-red-400" />
          )}
          Daily P&L
        </div>
        <div
          className={`stat-value ${
            dailyPnl >= 0 ? 'text-green-400' : 'text-red-400'
          }`}
        >
          {dailyPnl >= 0 ? '+' : ''}$
          {Math.abs(dailyPnl).toLocaleString('en-US', {
            minimumFractionDigits: 2,
          })}
        </div>
        <div
          className={`mt-1 text-sm ${
            dailyPnlPercent >= 0 ? 'text-green-400/70' : 'text-red-400/70'
          }`}
        >
          {dailyPnlPercent >= 0 ? '+' : ''}
          {dailyPnlPercent.toFixed(2)}%
        </div>
      </div>

      {/* Open Positions */}
      <div className="card">
        <div className="card-header flex items-center gap-2">
          <Briefcase className="h-4 w-4" />
          Open Positions
        </div>
        <div className="stat-value text-slate-100">{openPositions.length}</div>
        <div className="mt-1 text-sm text-slate-500">
          across {new Set(openPositions.map((p) => p.market)).size} markets
        </div>
      </div>

      {/* Win Rate */}
      <div className="card">
        <div className="card-header flex items-center gap-2">
          <Target className="h-4 w-4" />
          Win Rate
        </div>
        <div className="stat-value text-slate-100">{winRate.toFixed(1)}%</div>
        <div className="mt-1 text-sm text-slate-500">
          {totalTrades} total trades
        </div>
      </div>
    </div>
  );
}
