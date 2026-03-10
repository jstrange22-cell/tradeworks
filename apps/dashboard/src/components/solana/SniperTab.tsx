import {
  Crosshair, Play, Square, Settings, Wallet, Target, TrendingUp,
} from 'lucide-react';
import { StatCard, ConfigInput } from '@/components/solana/shared';
import {
  useSniperConfig, useSniperStatus, useSniperToggle, useSniperUpdateConfig,
} from '@/hooks/useSolana';

export function SniperTab() {
  const sniperConfig = useSniperConfig(true);
  const sniperStatus = useSniperStatus(true);
  const sniperToggle = useSniperToggle();
  const sniperUpdateConfig = useSniperUpdateConfig();

  const config = sniperConfig.data?.data;
  const status = sniperStatus.data;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Crosshair className="h-5 w-5 text-red-400" />
          <h2 className="text-sm font-semibold text-slate-200">Sniping Engine</h2>
          <span className={`text-[10px] px-2 py-0.5 rounded-full ${status?.running ? 'bg-green-500/20 text-green-400' : 'bg-slate-700 text-slate-500'}`}>
            {status?.running ? 'ACTIVE' : 'STOPPED'}
          </span>
        </div>
        <button
          onClick={() => sniperToggle.mutate(status?.running ?? false)}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ${status?.running ? 'bg-red-600 text-white' : 'bg-green-600 text-white'}`}
        >
          {status?.running ? <><Square className="h-3 w-3" /> Stop</> : <><Play className="h-3 w-3" /> Start Sniper</>}
        </button>
      </div>

      {/* Sniper Stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Daily Spent" value={`${(status?.dailySpentSol ?? 0).toFixed(4)} SOL`} sub={`of ${status?.dailyBudgetSol ?? 0} budget`} icon={<Wallet className="h-4 w-4 text-red-400" />} />
        <StatCard label="Open Positions" value={String((status?.openPositions ?? []).length)} sub={`max ${config?.maxOpenPositions ?? 5}`} icon={<Target className="h-4 w-4 text-blue-400" />} />
        <StatCard label="Buy Amount" value={`${config?.buyAmountSol ?? 0.05} SOL`} sub="per snipe" icon={<Crosshair className="h-4 w-4 text-orange-400" />} />
        <StatCard label="Take Profit" value={`+${config?.takeProfitPercent ?? 100}%`} sub={`SL: ${config?.stopLossPercent ?? -50}%`} icon={<TrendingUp className="h-4 w-4 text-green-400" />} />
      </div>

      {/* Config */}
      <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-200">
          <Settings className="h-4 w-4" /> Configuration
        </h3>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 text-xs">
          <ConfigInput label="Buy Amount (SOL)" value={config?.buyAmountSol} onChange={(v) => sniperUpdateConfig.mutate({ buyAmountSol: parseFloat(v) })} />
          <ConfigInput label="Daily Budget (SOL)" value={config?.dailyBudgetSol} onChange={(v) => sniperUpdateConfig.mutate({ dailyBudgetSol: parseFloat(v) })} />
          <ConfigInput label="Take Profit %" value={config?.takeProfitPercent} onChange={(v) => sniperUpdateConfig.mutate({ takeProfitPercent: parseFloat(v) })} />
          <ConfigInput label="Stop Loss %" value={config?.stopLossPercent} onChange={(v) => sniperUpdateConfig.mutate({ stopLossPercent: parseFloat(v) })} />
          <ConfigInput label="Slippage (bps)" value={config?.slippageBps} onChange={(v) => sniperUpdateConfig.mutate({ slippageBps: parseInt(v) })} />
          <ConfigInput label="Priority Fee (u-lam)" value={config?.priorityFee} onChange={(v) => sniperUpdateConfig.mutate({ priorityFee: parseInt(v) })} />
          <ConfigInput label="Max Market Cap $" value={config?.maxMarketCapUsd} onChange={(v) => sniperUpdateConfig.mutate({ maxMarketCapUsd: parseFloat(v) })} />
          <ConfigInput label="Max Positions" value={config?.maxOpenPositions} onChange={(v) => sniperUpdateConfig.mutate({ maxOpenPositions: parseInt(v) })} />
        </div>
        <div className="mt-3 flex gap-4 text-xs">
          <label className="flex items-center gap-2 text-slate-400">
            <input type="checkbox" checked={config?.autoBuyPumpFun ?? false} onChange={(event) => sniperUpdateConfig.mutate({ autoBuyPumpFun: event.target.checked })} className="rounded bg-slate-700" />
            Auto-snipe pump.fun
          </label>
          <label className="flex items-center gap-2 text-slate-400">
            <input type="checkbox" checked={config?.autoBuyTrending ?? false} onChange={(event) => sniperUpdateConfig.mutate({ autoBuyTrending: event.target.checked })} className="rounded bg-slate-700" />
            Auto-snipe trending
          </label>
        </div>
      </div>

      {/* Recent Executions */}
      <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-4">
        <h3 className="mb-3 text-sm font-semibold text-slate-200">Recent Executions</h3>
        <div className="space-y-1.5">
          {(status?.recentExecutions ?? []).map((execution) => (
            <div
              key={execution.id}
              className={`flex items-center justify-between rounded-lg border p-2 text-xs ${
                execution.status === 'success' ? 'border-green-500/20 bg-green-500/5'
                  : execution.status === 'failed' ? 'border-red-500/20 bg-red-500/5'
                  : 'border-slate-700/30 bg-slate-900/20'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className={`font-bold ${execution.action === 'buy' ? 'text-green-400' : 'text-red-400'}`}>
                  {execution.action.toUpperCase()}
                </span>
                <span className="text-slate-200">{execution.symbol}</span>
                <span className="text-slate-500">({execution.trigger})</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-slate-400">{execution.amountSol.toFixed(4)} SOL</span>
                <span className={
                  execution.status === 'success' ? 'text-green-400'
                    : execution.status === 'failed' ? 'text-red-400'
                    : 'text-yellow-400'
                }>
                  {execution.status}
                </span>
              </div>
            </div>
          ))}
          {(status?.recentExecutions ?? []).length === 0 && (
            <div className="text-center text-slate-500 py-4">No executions yet</div>
          )}
        </div>
      </div>
    </div>
  );
}
