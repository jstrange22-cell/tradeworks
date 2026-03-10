import { Brain, Rocket } from 'lucide-react';

interface MoonshotAlertsCardProps {
  alerts: Array<{ mint: string; symbol: string; name: string; score: number; rugRisk: string }>;
}

export function MoonshotAlertsCard({ alerts }: MoonshotAlertsCardProps) {
  return (
    <div className="card">
      <div className="card-header flex items-center gap-2">
        <Brain className="h-4 w-4 text-yellow-400" />
        Moonshot Alerts
      </div>
      {alerts.length === 0 ? (
        <p className="py-4 text-center text-xs text-slate-500">No high-score tokens detected</p>
      ) : (
        <div className="space-y-2">
          {alerts.map((alert) => (
            <div key={alert.mint} className="flex items-center justify-between rounded-lg bg-slate-800/50 px-3 py-2">
              <div>
                <span className="font-medium text-slate-200">{alert.symbol}</span>
                <span className="ml-2 text-xs text-slate-500">{alert.name}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                  alert.rugRisk === 'low' ? 'bg-green-500/10 text-green-400' :
                  alert.rugRisk === 'medium' ? 'bg-amber-500/10 text-amber-400' :
                  'bg-red-500/10 text-red-400'
                }`}>
                  {alert.rugRisk}
                </span>
                <span className={`text-sm font-bold ${
                  alert.score >= 70 ? 'text-green-400' :
                  alert.score >= 50 ? 'text-amber-400' : 'text-slate-400'
                }`}>
                  {alert.score}/100
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface PumpfunLaunchesCardProps {
  launches: Array<{ mint: string; symbol: string; name: string; usdMarketCap: number; bondingCurveProgress: number }>;
}

export function PumpfunLaunchesCard({ launches }: PumpfunLaunchesCardProps) {
  return (
    <div className="card">
      <div className="card-header flex items-center gap-2">
        <Rocket className="h-4 w-4 text-pink-400" />
        Recent pump.fun Launches
      </div>
      {launches.length === 0 ? (
        <p className="py-4 text-center text-xs text-slate-500">Start the pump.fun monitor to detect launches</p>
      ) : (
        <div className="space-y-2">
          {launches.map((token) => (
            <div key={token.mint} className="flex items-center justify-between rounded-lg bg-slate-800/50 px-3 py-2">
              <div>
                <span className="font-medium text-slate-200">{token.symbol}</span>
                <span className="ml-2 text-xs text-slate-500 truncate max-w-[120px] inline-block align-bottom">{token.name}</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-16">
                  <div className="h-1.5 rounded-full bg-slate-700">
                    <div
                      className="h-1.5 rounded-full bg-gradient-to-r from-pink-500 to-purple-500"
                      style={{ width: `${Math.min(token.bondingCurveProgress, 100)}%` }}
                    />
                  </div>
                </div>
                <span className="text-xs text-slate-400 w-16 text-right">
                  ${token.usdMarketCap >= 1000 ? `${(token.usdMarketCap / 1000).toFixed(0)}k` : token.usdMarketCap.toFixed(0)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
