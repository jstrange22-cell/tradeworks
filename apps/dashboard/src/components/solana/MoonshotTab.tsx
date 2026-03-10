import { Brain, RefreshCw, Loader2, AlertTriangle, Award } from 'lucide-react';
import { formatCompact } from '@/components/solana/shared';
import { useMoonshotLeaderboard, useMoonshotAlerts, useMoonshotScan, useSniperExecute } from '@/hooks/useSolana';

export function MoonshotTab() {
  const moonshotLeaderboard = useMoonshotLeaderboard(true);
  const moonshotAlerts = useMoonshotAlerts(true);
  const moonshotScan = useMoonshotScan();
  const sniperExecute = useSniperExecute();

  const alerts = moonshotAlerts.data?.data ?? [];
  const leaderboard = moonshotLeaderboard.data?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="h-5 w-5 text-violet-400" />
          <h2 className="text-sm font-semibold text-slate-200">Moonshot Scoring AI</h2>
        </div>
        <button
          onClick={() => moonshotScan.mutate()}
          disabled={moonshotScan.isPending}
          className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50"
        >
          {moonshotScan.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Scan Trending
        </button>
      </div>

      {/* Alerts */}
      {alerts.length > 0 && (
        <div className="rounded-xl border border-violet-500/30 bg-violet-500/5 p-4">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-violet-300">
            <AlertTriangle className="h-4 w-4" /> High Score Alerts
          </h3>
          <div className="flex flex-wrap gap-2">
            {alerts.slice(0, 5).map((alert) => (
              <div key={alert.mint} className="rounded-lg border border-violet-500/20 bg-slate-800 px-3 py-1.5 text-xs">
                <span className="font-bold text-violet-400">{alert.score}</span>
                <span className="mx-1 text-slate-300">{alert.symbol}</span>
                <span className={`text-[10px] ${
                  alert.recommendation === 'strong_buy' ? 'text-green-400'
                    : alert.recommendation === 'buy' ? 'text-blue-400'
                    : 'text-slate-500'
                }`}>
                  {alert.recommendation.replace('_', ' ').toUpperCase()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Leaderboard */}
      <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-200">
          <Award className="h-4 w-4 text-yellow-400" /> Leaderboard
        </h3>
        {moonshotScan.isPending ? <Loader2 className="mx-auto h-6 w-6 animate-spin text-violet-400" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-700/50 text-slate-400">
                  <th className="pb-2 pr-3">Score</th>
                  <th className="pb-2 pr-3">Token</th>
                  <th className="pb-2 pr-3 text-right">Price</th>
                  <th className="pb-2 pr-3 text-right">MCap</th>
                  <th className="pb-2 pr-3 text-right">24h %</th>
                  <th className="pb-2 pr-3">Rug Risk</th>
                  <th className="pb-2 pr-3">Signal</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((item) => (
                  <tr key={item.mint} className="border-b border-slate-700/30 hover:bg-slate-700/20">
                    <td className="py-2 pr-3">
                      <span className={`font-bold text-lg ${
                        item.score >= 70 ? 'text-green-400'
                          : item.score >= 50 ? 'text-yellow-400'
                          : item.score >= 30 ? 'text-orange-400'
                          : 'text-red-400'
                      }`}>{item.score}</span>
                    </td>
                    <td className="py-2 pr-3">
                      <div className="font-medium text-slate-200">{item.symbol}</div>
                      <div className="text-[10px] text-slate-500">{item.name.slice(0, 20)}</div>
                    </td>
                    <td className="py-2 pr-3 text-right font-mono text-slate-200">
                      ${item.priceUsd < 0.01 ? item.priceUsd.toExponential(2) : item.priceUsd.toFixed(4)}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono text-slate-300">${formatCompact(item.marketCap)}</td>
                    <td className={`py-2 pr-3 text-right font-mono ${item.priceChange24h >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {item.priceChange24h >= 0 ? '+' : ''}{item.priceChange24h.toFixed(1)}%
                    </td>
                    <td className="py-2 pr-3">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                        item.rugRisk === 'low' ? 'bg-green-500/20 text-green-400'
                          : item.rugRisk === 'medium' ? 'bg-yellow-500/20 text-yellow-400'
                          : item.rugRisk === 'high' ? 'bg-orange-500/20 text-orange-400'
                          : 'bg-red-500/20 text-red-400'
                      }`}>{item.rugRisk.toUpperCase()}</span>
                    </td>
                    <td className="py-2 pr-3">
                      <span className={`text-[10px] font-medium ${
                        item.recommendation === 'strong_buy' ? 'text-green-400'
                          : item.recommendation === 'buy' ? 'text-blue-400'
                          : item.recommendation === 'hold' ? 'text-slate-400'
                          : 'text-red-400'
                      }`}>{item.recommendation.replace('_', ' ').toUpperCase()}</span>
                    </td>
                    <td className="py-2">
                      <button
                        onClick={() => sniperExecute.mutate({ mint: item.mint, symbol: item.symbol, name: item.name })}
                        className="rounded bg-violet-600/20 px-2 py-0.5 text-[10px] font-medium text-violet-400 hover:bg-violet-600/30"
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
