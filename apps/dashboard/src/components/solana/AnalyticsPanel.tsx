import { TrendingUp, TrendingDown, Trophy, Target, DollarSign, AlertTriangle } from 'lucide-react';

interface Stats {
  totalTrades: number;
  wins: number;
  losses: number;
  totalPnlSol: number;
  totalPnlUsd: number;
  winRate: number;
  dailyRealizedLossSol: number;
}

interface AnalyticsPanelProps {
  stats: Stats | undefined;
  consecutiveLosses: number;
  circuitBreakerPaused: boolean;
  circuitBreakerResumesAt: string | null | undefined;
  solPrice: number;
}

export function AnalyticsPanel({
  stats,
  consecutiveLosses,
  circuitBreakerPaused,
  circuitBreakerResumesAt,
  solPrice,
}: AnalyticsPanelProps) {
  const s = stats;
  const winRate = s?.winRate ?? 0;
  const totalPnlSol = s?.totalPnlSol ?? 0;
  const totalPnlUsd = s?.totalPnlUsd ?? 0;
  const wins = s?.wins ?? 0;
  const losses = s?.losses ?? 0;
  const totalTrades = s?.totalTrades ?? 0;
  const dailyLoss = s?.dailyRealizedLossSol ?? 0;

  const pnlPositive = totalPnlSol >= 0;

  const winRateColor =
    winRate >= 50 ? 'text-emerald-600 dark:text-emerald-400'
    : winRate >= 35 ? 'text-amber-500 dark:text-amber-400'
    : 'text-red-500 dark:text-red-400';

  const resumesIn = circuitBreakerResumesAt
    ? Math.max(0, Math.ceil((new Date(circuitBreakerResumesAt).getTime() - Date.now()) / 1000))
    : 0;

  return (
    <div className="space-y-3">
      {/* Circuit breaker alert */}
      {circuitBreakerPaused && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
          <div>
            <p className="text-sm font-semibold text-amber-600 dark:text-amber-400">
              Circuit Breaker Active — Buys Paused
            </p>
            <p className="text-[10px] text-amber-500/80">
              {consecutiveLosses} consecutive losses · resumes in {resumesIn}s
            </p>
          </div>
        </div>
      )}

      {/* Main stats grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">

        {/* Win Rate */}
        <div className="rounded-xl border border-gray-200 bg-white p-3 dark:border-slate-700/50 dark:bg-slate-800/50">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[10px] text-gray-500 dark:text-slate-400">Win Rate</span>
            <Trophy className="h-3.5 w-3.5 text-amber-400" />
          </div>
          <div className={`text-xl font-extrabold tabular-nums ${winRateColor}`}>
            {winRate}%
          </div>
          <div className="text-[10px] text-gray-400 dark:text-slate-500">
            {wins}W / {losses}L · {totalTrades} trades
          </div>
        </div>

        {/* Total P&L */}
        <div className={`rounded-xl border p-3 ${
          pnlPositive
            ? 'border-emerald-500/25 bg-emerald-500/5'
            : 'border-red-500/25 bg-red-500/5'
        }`}>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[10px] text-gray-500 dark:text-slate-400">Total P&amp;L</span>
            {pnlPositive
              ? <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
              : <TrendingDown className="h-3.5 w-3.5 text-red-400" />}
          </div>
          <div className={`text-xl font-extrabold tabular-nums ${pnlPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
            {pnlPositive ? '+' : ''}{totalPnlSol.toFixed(4)}
          </div>
          <div className={`text-[10px] ${pnlPositive ? 'text-emerald-500/70 dark:text-emerald-400/70' : 'text-red-500/70 dark:text-red-400/70'}`}>
            {pnlPositive ? '+' : ''}${totalPnlUsd.toFixed(2)} USD
          </div>
        </div>

        {/* Avg per trade */}
        <div className="rounded-xl border border-gray-200 bg-white p-3 dark:border-slate-700/50 dark:bg-slate-800/50">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[10px] text-gray-500 dark:text-slate-400">Avg per Trade</span>
            <Target className="h-3.5 w-3.5 text-purple-400" />
          </div>
          <div className={`text-xl font-extrabold tabular-nums ${
            totalTrades > 0 && totalPnlSol / totalTrades >= 0
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-red-500 dark:text-red-400'
          }`}>
            {totalTrades > 0
              ? `${(totalPnlSol / totalTrades) >= 0 ? '+' : ''}${(totalPnlSol / totalTrades).toFixed(5)}`
              : '—'}
          </div>
          <div className="text-[10px] text-gray-400 dark:text-slate-500">SOL per closed trade</div>
        </div>

        {/* Daily realized loss */}
        <div className="rounded-xl border border-gray-200 bg-white p-3 dark:border-slate-700/50 dark:bg-slate-800/50">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[10px] text-gray-500 dark:text-slate-400">Daily Loss</span>
            <DollarSign className="h-3.5 w-3.5 text-red-400" />
          </div>
          <div className={`text-xl font-extrabold tabular-nums ${
            dailyLoss > 0 ? 'text-red-500 dark:text-red-400' : 'text-gray-700 dark:text-slate-300'
          }`}>
            {dailyLoss > 0 ? '-' : ''}{dailyLoss.toFixed(4)}
          </div>
          <div className="text-[10px] text-gray-400 dark:text-slate-500">
            SOL · ≈${(dailyLoss * solPrice).toFixed(2)}
          </div>
        </div>
      </div>
    </div>
  );
}
