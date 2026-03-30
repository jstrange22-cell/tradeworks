import { TrendingUp, TrendingDown, Target, DollarSign, AlertTriangle } from 'lucide-react';
import type { TradeData } from '@/types/analytics';

interface EVMetricsPanelProps {
  trades: TradeData[];
}

interface EVMetrics {
  totalTrades: number;
  winRate: number;
  lossRate: number;
  avgWin: number;
  avgLoss: number;
  payoffRatio: number;
  expectedValue: number;
  breakevenWinRate: number;
  kellyPct: number;
  profitFactor: number;
}

function computeEVMetrics(trades: TradeData[]): EVMetrics | null {
  const closed = trades.filter(t => t.pnl !== 0 && t.pnl != null);
  if (closed.length === 0) return null;

  const wins = closed.filter(t => t.pnl > 0);
  const losses = closed.filter(t => t.pnl < 0);

  if (wins.length === 0 || losses.length === 0) return null;

  const winRate = wins.length / closed.length;
  const lossRate = losses.length / closed.length;
  const avgWin = wins.reduce((s, t) => s + t.pnl, 0) / wins.length;
  const avgLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0) / losses.length);
  const payoffRatio = avgWin / avgLoss;
  const expectedValue = winRate * avgWin - lossRate * avgLoss;
  const breakevenWinRate = 1 / (1 + payoffRatio);
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : 0;
  // Kelly criterion: f = (winRate × payoffRatio - lossRate) / payoffRatio
  const kellyPct = Math.max(0, ((winRate * payoffRatio - lossRate) / payoffRatio) * 100);

  return { totalTrades: closed.length, winRate, lossRate, avgWin, avgLoss, payoffRatio, expectedValue, breakevenWinRate, kellyPct, profitFactor };
}

function fmt(n: number, decimals = 2): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function EVMetricsPanel({ trades }: EVMetricsPanelProps) {
  const m = computeEVMetrics(trades);

  if (!m) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
        <h3 className="text-sm font-semibold text-slate-300 mb-1">Expected Value Analysis</h3>
        <p className="text-xs text-slate-500">No closed trades with P&L data yet.</p>
      </div>
    );
  }

  const evPositive = m.expectedValue > 0;
  const winRateAboveBreakeven = m.winRate >= m.breakevenWinRate;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-200">Expected Value Analysis</h3>
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${evPositive ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'}`}>
          {evPositive ? 'POSITIVE EV' : 'NEGATIVE EV'}
        </span>
      </div>

      {/* EV explainer */}
      <div className={`rounded-lg border p-3 ${evPositive ? 'border-green-500/20 bg-green-500/5' : 'border-red-500/20 bg-red-500/5'}`}>
        <div className="flex items-start gap-2">
          {evPositive ? <TrendingUp className="h-4 w-4 text-green-400 shrink-0 mt-0.5" /> : <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />}
          <div>
            <p className={`text-sm font-bold ${evPositive ? 'text-green-400' : 'text-red-400'}`}>
              ${fmt(m.expectedValue)} per trade
            </p>
            <p className="text-xs text-slate-400 mt-0.5">
              {evPositive
                ? `Every trade you take expects to return $${fmt(m.expectedValue)} on average`
                : `Every trade you take expects to lose $${fmt(Math.abs(m.expectedValue))} on average — this is why you're losing despite a high win rate`}
            </p>
          </div>
        </div>
      </div>

      {/* Core metrics grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard
          label="Win Rate"
          value={`${(m.winRate * 100).toFixed(1)}%`}
          sub={`Need ${(m.breakevenWinRate * 100).toFixed(1)}% to break even`}
          positive={winRateAboveBreakeven}
          icon={<Target className="h-3.5 w-3.5" />}
        />
        <MetricCard
          label="Payoff Ratio"
          value={`${fmt(m.payoffRatio)}:1`}
          sub={`Avg win $${fmt(m.avgWin)} / Avg loss $${fmt(m.avgLoss)}`}
          positive={m.payoffRatio >= 1}
          icon={<DollarSign className="h-3.5 w-3.5" />}
        />
        <MetricCard
          label="Profit Factor"
          value={fmt(m.profitFactor)}
          sub={m.profitFactor >= 1.5 ? 'Good (>1.5)' : m.profitFactor >= 1 ? 'Marginal' : 'Losing'}
          positive={m.profitFactor >= 1.5}
          icon={<TrendingUp className="h-3.5 w-3.5" />}
        />
        <MetricCard
          label="Kelly %"
          value={`${fmt(m.kellyPct, 1)}%`}
          sub={m.kellyPct === 0 ? 'Sit out — negative edge' : `Max position size per trade`}
          positive={m.kellyPct > 0}
          icon={<TrendingDown className="h-3.5 w-3.5" />}
        />
      </div>

      {/* Win rate vs breakeven bar */}
      <div className="space-y-1.5">
        <div className="flex justify-between text-xs text-slate-400">
          <span>Win Rate vs Breakeven</span>
          <span className={winRateAboveBreakeven ? 'text-green-400' : 'text-red-400'}>
            {winRateAboveBreakeven ? `+${((m.winRate - m.breakevenWinRate) * 100).toFixed(1)}% above breakeven` : `${((m.breakevenWinRate - m.winRate) * 100).toFixed(1)}% below breakeven`}
          </span>
        </div>
        <div className="relative h-2 rounded-full bg-slate-800">
          {/* Breakeven marker */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-yellow-400 z-10"
            style={{ left: `${m.breakevenWinRate * 100}%` }}
          />
          {/* Win rate fill */}
          <div
            className={`h-full rounded-full transition-all ${winRateAboveBreakeven ? 'bg-green-500' : 'bg-red-500'}`}
            style={{ width: `${Math.min(100, m.winRate * 100)}%` }}
          />
        </div>
        <div className="flex justify-between text-[10px] text-slate-600">
          <span>0%</span>
          <span className="text-yellow-500">Breakeven {(m.breakevenWinRate * 100).toFixed(0)}%</span>
          <span>100%</span>
        </div>
      </div>

      {/* EV formula breakdown */}
      <div className="rounded-lg bg-slate-800/50 p-3 font-mono text-xs text-slate-400">
        <span className="text-slate-500">EV = </span>
        <span className="text-green-400">({(m.winRate * 100).toFixed(0)}% × ${fmt(m.avgWin)})</span>
        <span className="text-slate-500"> − </span>
        <span className="text-red-400">({(m.lossRate * 100).toFixed(0)}% × ${fmt(m.avgLoss)})</span>
        <span className="text-slate-500"> = </span>
        <span className={evPositive ? 'text-green-400 font-bold' : 'text-red-400 font-bold'}>
          ${fmt(m.expectedValue)}
        </span>
      </div>
    </div>
  );
}

interface MetricCardProps {
  label: string;
  value: string;
  sub: string;
  positive: boolean;
  icon: React.ReactNode;
}

function MetricCard({ label, value, sub, positive, icon }: MetricCardProps) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-800/30 p-3">
      <div className="flex items-center gap-1.5 text-slate-400 mb-1">
        {icon}
        <span className="text-[10px] font-medium uppercase tracking-wide">{label}</span>
      </div>
      <div className={`text-lg font-bold ${positive ? 'text-green-400' : 'text-red-400'}`}>{value}</div>
      <div className="text-[10px] text-slate-500 mt-0.5 leading-tight">{sub}</div>
    </div>
  );
}
