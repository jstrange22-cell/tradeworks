import { useState } from 'react';
import {
  Activity, Crosshair, DollarSign, Settings, Target, TrendingUp, Wallet, ChevronDown, ChevronRight,
} from 'lucide-react';
import { ConfigInput } from '@/components/solana/shared';
import { ExecutionsList } from '@/components/solana/ExecutionsList';
import {
  useSniperStatus, useSniperConfig, useSniperUpdateConfig, useSniperExecute,
} from '@/hooks/useSolana';
import type { ActivePosition, SnipeExecution } from '@/types/solana';

function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function calcWinRate(executions: SnipeExecution[]): string {
  if (executions.length === 0) return '--';
  const wins = executions.filter((e) => e.status === 'success').length;
  return `${Math.round((wins / executions.length) * 100)}%`;
}

export function ActiveTradesPanel() {
  const [configOpen, setConfigOpen] = useState(false);

  const sniperStatus = useSniperStatus(true);
  const sniperConfig = useSniperConfig(true);
  const sniperUpdateConfig = useSniperUpdateConfig();
  const sniperExecute = useSniperExecute();

  const status = sniperStatus.data;
  const config = sniperConfig.data?.data;
  const positions: ActivePosition[] = status?.openPositions ?? [];
  const executions: SnipeExecution[] = status?.recentExecutions ?? [];
  const budgetPct = status ? Math.min(100, (status.dailySpentSol / Math.max(0.001, status.dailyBudgetSol)) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* Section A: Open Positions */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-slate-700/50 dark:bg-slate-800/50">
        <div className="mb-3 flex items-center gap-2">
          <Activity className="h-4 w-4 text-purple-600 dark:text-purple-400" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-200">Open Positions</h3>
          <span className="ml-auto rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-slate-700 dark:text-slate-300">
            {positions.length}{config ? ` / ${config.maxOpenPositions}` : ''}
          </span>
        </div>

        {positions.length > 0 ? (
          <div className="space-y-2">
            {positions.map((pos) => {
              const isProfit = pos.pnlPercent >= 0;
              return (
                <div
                  key={pos.mint}
                  className={`flex items-center justify-between rounded-lg border p-3 text-xs ${
                    isProfit ? 'border-green-500/20 bg-green-500/5' : 'border-red-500/20 bg-red-500/5'
                  }`}
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-gray-900 dark:text-slate-100">{pos.name}</span>
                      <span className="shrink-0 rounded bg-gray-200 px-1.5 py-0.5 text-[9px] font-medium text-gray-600 dark:bg-slate-600 dark:text-slate-300">{pos.symbol}</span>
                      {pos.paperMode && (
                        <span className="shrink-0 rounded bg-amber-500/20 px-1 py-0.5 text-[9px] font-bold text-amber-400">SIM</span>
                      )}
                    </div>
                    {pos.description && (
                      <span className="max-w-[15rem] truncate text-[10px] text-gray-400 dark:text-slate-500" title={pos.description}>
                        {pos.description.length > 60 ? `${pos.description.slice(0, 60)}…` : pos.description}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-0.5">
                    <span className="font-mono text-gray-600 dark:text-slate-300">
                      ${pos.buyPrice.toFixed(8)} → ${pos.currentPrice.toFixed(8)}
                    </span>
                    <span className="text-[10px] text-gray-400 dark:text-slate-500">
                      {pos.amountTokens.toLocaleString()} tokens · {timeAgo(pos.boughtAt)}
                    </span>
                    {pos.valueUsd != null && pos.valueUsd > 0 && (
                      <span className={`text-[10px] font-medium ${isProfit ? 'text-green-500' : 'text-red-500'}`}>
                        ${pos.valueUsd.toFixed(4)} value
                        {pos.unrealizedPnlUsd != null && (
                          <> · {pos.unrealizedPnlUsd >= 0 ? '+' : ''}{pos.unrealizedPnlUsd.toFixed(4)} USD</>
                        )}
                      </span>
                    )}
                    {pos.trigger && (
                      <span className="text-[10px] text-gray-400">trigger: {pos.trigger}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-sm font-bold ${isProfit ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                      {isProfit ? '+' : ''}{pos.pnlPercent.toFixed(1)}%
                    </span>
                    <button
                      onClick={() => sniperExecute.mutate({ mint: pos.mint, symbol: pos.symbol, name: pos.name })}
                      disabled={sniperExecute.isPending}
                      className="rounded-md bg-red-600 px-2.5 py-1 text-[10px] font-medium text-white transition hover:bg-red-700 disabled:opacity-50"
                    >
                      Sell
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="py-6 text-center text-sm text-gray-400 dark:text-slate-500">
            No open positions — sniper will buy when qualifying tokens are detected
          </div>
        )}
      </div>

      {/* Section B: Quick Stats */}
      <div className="grid grid-cols-5 gap-3">
        <div className="rounded-xl border border-gray-200 bg-white p-3 dark:border-slate-700/50 dark:bg-slate-800/50">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10px] text-gray-500 dark:text-slate-400">Daily Spent</span>
            <Wallet className="h-3.5 w-3.5 text-red-400" />
          </div>
          <div className="text-sm font-bold text-gray-900 dark:text-slate-100">
            {(status?.dailySpentSol ?? 0).toFixed(4)} SOL
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-slate-700">
            <div
              className="h-full rounded-full bg-red-500 transition-all"
              style={{ width: `${budgetPct}%` }}
            />
          </div>
          <div className="mt-0.5 text-[10px] text-gray-400 dark:text-slate-500">
            of {status?.dailyBudgetSol ?? 0} budget
          </div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-3 dark:border-slate-700/50 dark:bg-slate-800/50">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10px] text-gray-500 dark:text-slate-400">Open</span>
            <Target className="h-3.5 w-3.5 text-blue-400" />
          </div>
          <div className="text-sm font-bold text-gray-900 dark:text-slate-100">{positions.length}</div>
          <div className="text-[10px] text-gray-400 dark:text-slate-500">
            max {config?.maxOpenPositions ?? '--'}
          </div>
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
            <TrendingUp className="h-3.5 w-3.5 text-green-400" />
          </div>
          <div className="text-sm font-bold text-gray-900 dark:text-slate-100">{calcWinRate(executions)}</div>
          <div className="text-[10px] text-gray-400 dark:text-slate-500">
            {executions.filter((e) => e.status === 'success').length} / {executions.length} recent
          </div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-3 dark:border-slate-700/50 dark:bg-slate-800/50">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10px] text-gray-500 dark:text-slate-400">Total Invested</span>
            <DollarSign className="h-3.5 w-3.5 text-yellow-400" />
          </div>
          <div className="text-sm font-bold text-gray-900 dark:text-slate-100">
            {positions.reduce((sum, pos) => sum + (pos.buyCostSol ?? (pos.costUsd ? pos.costUsd / 130 : 0)), 0).toFixed(4)} SOL
          </div>
          <div className="text-[10px] text-gray-400 dark:text-slate-500">
            ${positions.reduce((sum, pos) => sum + (pos.costUsd ?? 0), 0).toFixed(2)} USD
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
              <ConfigInput label="Daily Budget (SOL)" value={config?.dailyBudgetSol} onChange={(v) => sniperUpdateConfig.mutate({ dailyBudgetSol: parseFloat(v) })} />
              <ConfigInput label="Take Profit %" value={config?.takeProfitPercent} onChange={(v) => sniperUpdateConfig.mutate({ takeProfitPercent: parseFloat(v) })} />
              <ConfigInput label="Stop Loss %" value={config?.stopLossPercent} onChange={(v) => sniperUpdateConfig.mutate({ stopLossPercent: parseFloat(v) })} />
              <ConfigInput label="Slippage (bps)" value={config?.slippageBps} onChange={(v) => sniperUpdateConfig.mutate({ slippageBps: parseInt(v) })} />
              <ConfigInput label="Priority Fee (μ-lam)" value={config?.priorityFee} onChange={(v) => sniperUpdateConfig.mutate({ priorityFee: parseInt(v) })} />
              <ConfigInput label="Max Market Cap $" value={config?.maxMarketCapUsd} onChange={(v) => sniperUpdateConfig.mutate({ maxMarketCapUsd: parseFloat(v) })} />
              <ConfigInput label="Max Positions" value={config?.maxOpenPositions} onChange={(v) => sniperUpdateConfig.mutate({ maxOpenPositions: parseInt(v) })} />
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
