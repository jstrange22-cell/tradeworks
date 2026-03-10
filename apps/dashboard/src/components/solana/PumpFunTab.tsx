import { Rocket, Play, Square, Sparkles, Activity, RefreshCw, Loader2 } from 'lucide-react';
import { StatCard, formatCompact } from '@/components/solana/shared';
import { usePumpFunLatest, usePumpFunStatus, usePumpFunToggle, useSniperExecute } from '@/hooks/useSolana';

export function PumpFunTab() {
  const pumpfunLatest = usePumpFunLatest(true);
  const pumpfunStatus = usePumpFunStatus(true);
  const pumpfunToggle = usePumpFunToggle();
  const sniperExecute = useSniperExecute();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Rocket className="h-5 w-5 text-pink-600 dark:text-pink-400" />
          <h2 className="text-sm font-semibold text-gray-800 dark:text-slate-200">pump.fun Monitor</h2>
          <span className={`rounded-full px-2 py-0.5 text-[10px] ${
            pumpfunStatus.data?.running
              ? 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400'
              : 'bg-gray-200 text-gray-500 dark:bg-slate-700 dark:text-slate-500'
          }`}>
            {pumpfunStatus.data?.running ? 'LIVE' : 'STOPPED'}
          </span>
        </div>
        <button
          onClick={() => pumpfunToggle.mutate(pumpfunStatus.data?.running ?? false)}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ${
            pumpfunStatus.data?.running ? 'bg-red-600 text-white' : 'bg-green-600 text-white'
          }`}
        >
          {pumpfunStatus.data?.running
            ? <><Square className="h-3 w-3" /> Stop</>
            : <><Play className="h-3 w-3" /> Start Monitor</>}
        </button>
      </div>

      {pumpfunStatus.data?.running && (
        <div className="grid grid-cols-3 gap-3">
          <StatCard
            label="Detected"
            value={String(pumpfunStatus.data.totalDetected)}
            sub="new tokens"
            icon={<Sparkles className="h-4 w-4 text-pink-600 dark:text-pink-400" />}
          />
          <StatCard
            label="Known Tokens"
            value={String(pumpfunStatus.data.recentLaunches?.length ?? 0)}
            sub="in buffer"
            icon={<Activity className="h-4 w-4 text-blue-600 dark:text-blue-400" />}
          />
          <StatCard
            label="Status"
            value="Polling"
            sub="every 5s"
            icon={<RefreshCw className="h-4 w-4 text-green-600 dark:text-green-400" />}
          />
        </div>
      )}

      <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-slate-700/50 dark:bg-slate-800/50">
        <h3 className="mb-3 text-sm font-semibold text-gray-800 dark:text-slate-200">Latest pump.fun Launches</h3>
        {pumpfunLatest.isLoading ? (
          <Loader2 className="mx-auto h-6 w-6 animate-spin text-pink-600 dark:text-pink-400" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-gray-200 text-gray-500 dark:border-slate-700/50 dark:text-slate-400">
                  <th className="pb-2 pr-3">Token</th>
                  <th className="pb-2 pr-3 text-right">Market Cap</th>
                  <th className="pb-2 pr-3 text-right">Bonding %</th>
                  <th className="pb-2 pr-3 text-right">Replies</th>
                  <th className="pb-2 pr-3">Status</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {(pumpfunLatest.data?.data ?? []).map((token) => (
                  <tr key={token.mint} className="border-b border-gray-100 hover:bg-gray-50 dark:border-slate-700/30 dark:hover:bg-slate-700/20">
                    <td className="py-2 pr-3">
                      <div className="font-medium text-gray-800 dark:text-slate-200">{token.symbol}</div>
                      <div className="text-[10px] text-gray-400 dark:text-slate-500">{token.name.slice(0, 25)}</div>
                    </td>
                    <td className="py-2 pr-3 text-right font-mono text-gray-700 dark:text-slate-300">
                      ${formatCompact(token.usdMarketCap)}
                    </td>
                    <td className="py-2 pr-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <div className="h-1.5 w-16 rounded-full bg-gray-200 dark:bg-slate-700">
                          <div
                            className="h-1.5 rounded-full bg-pink-500"
                            style={{ width: `${Math.min(100, token.bondingCurveProgress)}%` }}
                          />
                        </div>
                        <span className="font-mono text-gray-500 dark:text-slate-400">
                          {token.bondingCurveProgress.toFixed(0)}%
                        </span>
                      </div>
                    </td>
                    <td className="py-2 pr-3 text-right text-gray-500 dark:text-slate-400">{token.replyCount}</td>
                    <td className="py-2 pr-3">
                      {token.graduated
                        ? <span className="text-[10px] font-medium text-green-400">GRADUATED</span>
                        : token.kingOfTheHill
                          ? <span className="text-[10px] font-medium text-yellow-400">KOTH</span>
                          : <span className="text-[10px] text-gray-400 dark:text-slate-500">Bonding</span>}
                    </td>
                    <td className="py-2">
                      <button
                        onClick={() => sniperExecute.mutate({ mint: token.mint, symbol: token.symbol, name: token.name })}
                        className="rounded bg-pink-100 px-2 py-0.5 text-[10px] font-medium text-pink-600 hover:bg-pink-200 dark:bg-pink-600/20 dark:text-pink-400 dark:hover:bg-pink-600/30"
                      >
                        Snipe
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
