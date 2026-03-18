import { useState, useEffect } from 'react';
import {
  Activity, Crosshair, Settings, Target, TrendingUp, Wallet, ChevronDown, ChevronRight, Clock, Coins, Zap, WifiOff,
} from 'lucide-react';
import { ConfigInput } from '@/components/solana/shared';
import { ExecutionsList } from '@/components/solana/ExecutionsList';
import {
  useSniperStatus, useSniperConfig, useSniperUpdateConfig, useSniperExecute,
} from '@/hooks/useSolana';
import type { ActivePosition, SnipeExecution } from '@/types/solana';

function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d`;
}

function formatPrice(price: number): string {
  if (price === 0) return '$0.00';
  if (price >= 1) return `$${price.toFixed(4)}`;
  if (price >= 0.01) return `$${price.toFixed(6)}`;
  // Show significant figures for very small prices
  const str = price.toExponential(3);
  return `$${str}`;
}

function calcWinRate(executions: SnipeExecution[]): string {
  if (executions.length === 0) return '--';
  const wins = executions.filter((e) => e.status === 'success').length;
  return `${Math.round((wins / executions.length) * 100)}%`;
}

function PositionRow({ pos, onSell, isPending }: { pos: ActivePosition; onSell: () => void; isPending: boolean }) {
  const isProfit = pos.pnlPercent > 0;
  const isLoss = pos.pnlPercent < 0;
  const pnlColor = isProfit
    ? 'text-emerald-500 dark:text-emerald-400'
    : isLoss
    ? 'text-red-500 dark:text-red-400'
    : 'text-gray-400 dark:text-slate-500';
  const borderColor = isProfit
    ? 'border-emerald-500/25 bg-emerald-500/5'
    : isLoss
    ? 'border-red-500/25 bg-red-500/5'
    : 'border-gray-200/60 bg-white dark:border-slate-700/40 dark:bg-slate-800/30';

  return (
    <div className={`grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-lg border px-3 py-2.5 ${borderColor}`}>

      {/* LEFT — Token identity */}
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-semibold text-gray-900 dark:text-slate-100">{pos.name}</span>
          <span className="shrink-0 rounded bg-slate-200 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-600 dark:bg-slate-600 dark:text-slate-300">
            {pos.symbol}
          </span>
          {pos.paperMode && (
            <span className="shrink-0 rounded bg-amber-500/20 px-1 py-0.5 text-[9px] font-bold text-amber-400">SIM</span>
          )}
        </div>
        {pos.description && (
          <p className="mt-0.5 truncate text-[10px] text-gray-400 dark:text-slate-500" title={pos.description}>
            {pos.description}
          </p>
        )}
      </div>

      {/* CENTER — Trade metrics (the main info block) */}
      <div className="flex items-center gap-5 text-[11px]">

        {/* Entry → Current */}
        <div className="flex flex-col items-center gap-0.5">
          <span className="text-[9px] font-medium uppercase tracking-wider text-gray-400 dark:text-slate-500">Entry</span>
          <span className="font-mono font-medium text-gray-600 dark:text-slate-300">{formatPrice(pos.buyPrice)}</span>
        </div>
        <span className="text-gray-300 dark:text-slate-600">→</span>
        <div className="flex flex-col items-center gap-0.5">
          <span className="text-[9px] font-medium uppercase tracking-wider text-gray-400 dark:text-slate-500">Now</span>
          <span className={`font-mono font-semibold ${pnlColor}`}>{formatPrice(pos.currentPrice)}</span>
        </div>

        {/* Divider */}
        <div className="h-8 w-px bg-gray-200 dark:bg-slate-700" />

        {/* Tokens held */}
        <div className="flex flex-col items-center gap-0.5">
          <span className="text-[9px] font-medium uppercase tracking-wider text-gray-400 dark:text-slate-500">
            <Coins className="inline h-2.5 w-2.5 mb-0.5" /> Tokens
          </span>
          <span className="font-mono text-gray-700 dark:text-slate-300">
            {pos.amountTokens >= 1_000_000
              ? `${(pos.amountTokens / 1_000_000).toFixed(1)}M`
              : pos.amountTokens >= 1_000
              ? `${(pos.amountTokens / 1_000).toFixed(1)}K`
              : pos.amountTokens.toFixed(0)}
          </span>
        </div>

        {/* Divider */}
        <div className="h-8 w-px bg-gray-200 dark:bg-slate-700" />

        {/* Age */}
        <div className="flex flex-col items-center gap-0.5">
          <span className="text-[9px] font-medium uppercase tracking-wider text-gray-400 dark:text-slate-500">
            <Clock className="inline h-2.5 w-2.5 mb-0.5" /> Age
          </span>
          <span className="font-mono text-gray-600 dark:text-slate-400">{timeAgo(pos.boughtAt)}</span>
        </div>

        {/* USD value if available */}
        {pos.valueUsd != null && pos.valueUsd > 0 && (
          <>
            <div className="h-8 w-px bg-gray-200 dark:bg-slate-700" />
            <div className="flex flex-col items-center gap-0.5">
              <span className="text-[9px] font-medium uppercase tracking-wider text-gray-400 dark:text-slate-500">Value</span>
              <span className={`font-mono font-medium ${pnlColor}`}>${pos.valueUsd.toFixed(3)}</span>
            </div>
          </>
        )}
      </div>

      {/* RIGHT — PnL + Sell */}
      <div className="flex items-center gap-2.5">
        <div className="flex flex-col items-end">
          <span className={`text-base font-extrabold tabular-nums leading-tight ${pnlColor}`}>
            {pos.pnlPercent > 0 ? '+' : ''}{pos.pnlPercent.toFixed(1)}%
          </span>
          {pos.unrealizedPnlUsd != null && (
            <span className={`text-[9px] font-medium ${pnlColor}`}>
              {pos.unrealizedPnlUsd >= 0 ? '+' : ''}${pos.unrealizedPnlUsd.toFixed(3)}
            </span>
          )}
        </div>
        <button
          onClick={onSell}
          disabled={isPending}
          className="rounded-md bg-red-600 px-3 py-1.5 text-[10px] font-semibold text-white transition hover:bg-red-700 active:scale-95 disabled:opacity-50"
        >
          SELL
        </button>
      </div>
    </div>
  );
}

function useTickEvery5s() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 5000);
    return () => clearInterval(id);
  }, []);
}

function lastTradeAgo(executions: SnipeExecution[]): string {
  if (executions.length === 0) return 'no trades yet';
  const latest = [...executions].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  )[0];
  const seconds = Math.floor((Date.now() - new Date(latest.timestamp).getTime()) / 1000);
  if (seconds < 60) return `last trade ${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `last trade ${minutes}m ago`;
  return `last trade ${Math.floor(minutes / 60)}h ago`;
}

export function ActiveTradesPanel() {
  const [configOpen, setConfigOpen] = useState(false);
  useTickEvery5s();

  const sniperStatus = useSniperStatus(true);
  const sniperConfig = useSniperConfig(true);
  const sniperUpdateConfig = useSniperUpdateConfig();
  const sniperExecute = useSniperExecute();

  const status = sniperStatus.data;
  const config = sniperConfig.data?.data;
  const positions: ActivePosition[] = status?.openPositions ?? [];
  const executions: SnipeExecution[] = status?.recentExecutions ?? [];

  // Deduplicate by mint in case of status endpoint duplicates
  const uniquePositions = positions.filter((p, i, arr) => arr.findIndex(x => x.mint === p.mint) === i);

  const isRunning = status?.running ?? false;
  const isLoading = sniperStatus.isLoading;

  return (
    <div className="space-y-4">

      {/* ── Live Status Banner ── */}
      <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${
        isRunning
          ? 'border-emerald-500/30 bg-emerald-500/8 dark:bg-emerald-500/8'
          : 'border-red-500/30 bg-red-500/8 dark:bg-red-500/8'
      }`}>
        {isRunning ? (
          <>
            <span className="relative flex h-3 w-3 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
            </span>
            <Zap className="h-4 w-4 text-emerald-500 dark:text-emerald-400" />
            <div className="min-w-0">
              <p className="text-sm font-bold text-emerald-700 dark:text-emerald-300">Bot is LIVE</p>
              <p className="text-[10px] text-emerald-600/70 dark:text-emerald-400/70">
                Scanning pump.fun 24/7 · {lastTradeAgo(executions)}
              </p>
            </div>
          </>
        ) : (
          <>
            <WifiOff className="h-4 w-4 text-red-500" />
            <div>
              <p className="text-sm font-bold text-red-600 dark:text-red-400">Bot is STOPPED</p>
              <p className="text-[10px] text-red-500/70">Click Start to resume trading</p>
            </div>
          </>
        )}
        <div className="ml-auto flex items-center gap-4 text-right">
          <div>
            <p className="text-[10px] text-gray-400 dark:text-slate-500">Wallet SOL</p>
            <p className="text-sm font-bold text-gray-900 dark:text-slate-100">
              {isLoading ? '…' : (status?.walletSolBalance ?? 0).toFixed(4)}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-gray-400 dark:text-slate-500">Today</p>
            <p className="text-sm font-bold text-gray-900 dark:text-slate-100">
              {(status?.dailySpentSol ?? 0).toFixed(3)} SOL
            </p>
          </div>
          <div>
            <p className="text-[10px] text-gray-400 dark:text-slate-500">All-time</p>
            <p className="text-sm font-bold text-gray-900 dark:text-slate-100">
              {status?.totalExecutions ?? 0} trades
            </p>
          </div>
        </div>
      </div>

      {/* Section A: Open Positions */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-slate-700/50 dark:bg-slate-800/50">
        <div className="mb-3 flex items-center gap-2">
          <Activity className="h-4 w-4 text-purple-600 dark:text-purple-400" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-200">Open Positions</h3>
          <span className="ml-auto rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-slate-700 dark:text-slate-300">
            {uniquePositions.length}{config ? ` / ${config.maxOpenPositions}` : ''}
          </span>
        </div>

        {uniquePositions.length > 0 ? (
          <div className="space-y-2">
            {uniquePositions.map((pos) => (
              <PositionRow
                key={pos.mint}
                pos={pos}
                isPending={sniperExecute.isPending}
                onSell={() => sniperExecute.mutate({ mint: pos.mint, symbol: pos.symbol, name: pos.name })}
              />
            ))}
          </div>
        ) : (
          <div className="py-8 text-center">
            <Target className="mx-auto mb-2 h-6 w-6 text-gray-300 dark:text-slate-600" />
            <p className="text-sm text-gray-400 dark:text-slate-500">No open positions</p>
            <p className="text-[10px] text-gray-300 dark:text-slate-600">Sniper will buy when qualifying tokens are detected</p>
          </div>
        )}
      </div>

      {/* Section B: Quick Stats */}
      <div className="grid grid-cols-4 gap-3">
        <div className="rounded-xl border border-gray-200 bg-white p-3 dark:border-slate-700/50 dark:bg-slate-800/50">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10px] text-gray-500 dark:text-slate-400">Spent Today</span>
            <Wallet className="h-3.5 w-3.5 text-blue-400" />
          </div>
          <div className="text-sm font-bold text-gray-900 dark:text-slate-100">
            {(status?.dailySpentSol ?? 0).toFixed(4)} SOL
          </div>
          <div className="text-[10px] text-gray-400 dark:text-slate-500">
            ≈ ${((status?.dailySpentSol ?? 0) * 94.78).toFixed(2)} USD
          </div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-3 dark:border-slate-700/50 dark:bg-slate-800/50">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10px] text-gray-500 dark:text-slate-400">Open / Max</span>
            <Target className="h-3.5 w-3.5 text-purple-400" />
          </div>
          <div className="text-sm font-bold text-gray-900 dark:text-slate-100">
            {uniquePositions.length} <span className="font-normal text-gray-400">/ {config?.maxOpenPositions ?? '--'}</span>
          </div>
          <div className="text-[10px] text-gray-400 dark:text-slate-500">positions</div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-3 dark:border-slate-700/50 dark:bg-slate-800/50">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10px] text-gray-500 dark:text-slate-400">Total Snipes</span>
            <Crosshair className="h-3.5 w-3.5 text-orange-400" />
          </div>
          <div className="text-sm font-bold text-gray-900 dark:text-slate-100">{status?.totalExecutions ?? 0}</div>
          <div className="text-[10px] text-gray-400 dark:text-slate-500">all time</div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-3 dark:border-slate-700/50 dark:bg-slate-800/50">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10px] text-gray-500 dark:text-slate-400">Win Rate</span>
            <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
          </div>
          <div className="text-sm font-bold text-gray-900 dark:text-slate-100">{calcWinRate(executions)}</div>
          <div className="text-[10px] text-gray-400 dark:text-slate-500">
            {executions.filter((e) => e.status === 'success').length}W / {executions.filter(e => e.status === 'failed').length}L recent
          </div>
        </div>
      </div>

      {/* Section C: Collapsible Config */}
      <div className="rounded-xl border border-gray-200 bg-white dark:border-slate-700/50 dark:bg-slate-800/50">
        <button
          onClick={() => setConfigOpen((prev) => !prev)}
          className="flex w-full items-center gap-2 p-4 text-sm font-semibold text-gray-900 dark:text-slate-200"
        >
          <Settings className="h-4 w-4 text-gray-500 dark:text-slate-400" />
          Quick Config
          {configOpen
            ? <ChevronDown className="ml-auto h-4 w-4 text-gray-400 dark:text-slate-500" />
            : <ChevronRight className="ml-auto h-4 w-4 text-gray-400 dark:text-slate-500" />}
        </button>
        {configOpen && (
          <div className="border-t border-gray-200 p-4 dark:border-slate-700/50">
            <div className="grid grid-cols-2 gap-3 text-xs lg:grid-cols-4">
              <ConfigInput label="Buy Amount (SOL)" value={config?.buyAmountSol} onChange={(v) => sniperUpdateConfig.mutate({ buyAmountSol: parseFloat(v) })} />
              <ConfigInput label="Take Profit %" value={config?.takeProfitPercent} onChange={(v) => sniperUpdateConfig.mutate({ takeProfitPercent: parseFloat(v) })} />
              <ConfigInput label="Stop Loss %" value={config?.stopLossPercent} onChange={(v) => sniperUpdateConfig.mutate({ stopLossPercent: parseFloat(v) })} />
              <ConfigInput label="Slippage (bps)" value={config?.slippageBps} onChange={(v) => sniperUpdateConfig.mutate({ slippageBps: parseInt(v) })} />
              <ConfigInput label="Priority Fee (μ-lam)" value={config?.priorityFee} onChange={(v) => sniperUpdateConfig.mutate({ priorityFee: parseInt(v) })} />
              <ConfigInput label="Max Market Cap $" value={config?.maxMarketCapUsd} onChange={(v) => sniperUpdateConfig.mutate({ maxMarketCapUsd: parseFloat(v) })} />
              <ConfigInput label="Max Positions" value={config?.maxOpenPositions} onChange={(v) => sniperUpdateConfig.mutate({ maxOpenPositions: parseInt(v) })} />
              <ConfigInput label="Stale Exit (ms)" value={config?.stalePriceTimeoutMs} onChange={(v) => sniperUpdateConfig.mutate({ stalePriceTimeoutMs: parseInt(v) })} />
            </div>
            <div className="mt-3 flex gap-4 text-xs">
              <label className="flex items-center gap-2 text-gray-500 dark:text-slate-400">
                <input type="checkbox" checked={config?.autoBuyPumpFun ?? false} onChange={(event) => sniperUpdateConfig.mutate({ autoBuyPumpFun: event.target.checked })} className="rounded border-gray-300 bg-white dark:border-slate-600 dark:bg-slate-700" />
                Auto-snipe pump.fun
              </label>
              <label className="flex items-center gap-2 text-gray-500 dark:text-slate-400">
                <input type="checkbox" checked={config?.autoBuyTrending ?? false} onChange={(event) => sniperUpdateConfig.mutate({ autoBuyTrending: event.target.checked })} className="rounded border-gray-300 bg-white dark:border-slate-600 dark:bg-slate-700" />
                Auto-snipe trending
              </label>
            </div>
          </div>
        )}
      </div>

      {/* Section D: Recent Executions */}
      <ExecutionsList executions={executions} />
    </div>
  );
}
