import { usePortfolioStore } from '@/stores/portfolio-store';
import { Activity, Zap, ZapOff, Wifi, WifiOff } from 'lucide-react';

export function Header() {
  const { equity, dailyPnl, dailyPnlPercent, paperTrading, circuitBreaker } =
    usePortfolioStore();
  const isConnected = true; // Will be driven by WebSocket state

  const pnlColor = dailyPnl >= 0 ? 'text-green-400' : 'text-red-400';
  const pnlBg = dailyPnl >= 0 ? 'bg-green-500/10' : 'bg-red-500/10';

  return (
    <header className="flex h-14 items-center justify-between border-b border-slate-700/50 bg-slate-900/80 px-6 backdrop-blur-sm">
      {/* Left: Logo on mobile */}
      <div className="flex items-center gap-4">
        <Activity className="h-5 w-5 text-blue-500" />
        <span className="text-sm text-slate-500">TradeWorks Engine</span>
      </div>

      {/* Center: P&L */}
      <div className="flex items-center gap-6">
        <div className="text-center">
          <div className="text-xs text-slate-500">Total Equity</div>
          <div className="text-lg font-bold text-slate-100">
            {equity > 0
              ? `$${equity.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
              : <span className="text-slate-500">No data</span>
            }
          </div>
        </div>

        {equity > 0 && (
          <div
            className={`rounded-lg px-3 py-1.5 ${pnlBg}`}
          >
            <div className="text-xs text-slate-500">Daily P&L</div>
            <div className={`text-sm font-semibold ${pnlColor}`}>
              {dailyPnl >= 0 ? '+' : ''}
              ${Math.abs(dailyPnl).toLocaleString('en-US', { minimumFractionDigits: 2 })}
              <span className="ml-1 text-xs">
                ({dailyPnlPercent >= 0 ? '+' : ''}
                {dailyPnlPercent.toFixed(2)}%)
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Right: Status indicators */}
      <div className="flex items-center gap-3">
        {/* Circuit Breaker */}
        <div
          className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
            circuitBreaker
              ? 'bg-red-500/10 text-red-400 ring-1 ring-red-500/20'
              : 'bg-green-500/10 text-green-400 ring-1 ring-green-500/20'
          }`}
          title={
            circuitBreaker ? 'Circuit breaker TRIGGERED' : 'Circuit breaker OK'
          }
        >
          {circuitBreaker ? (
            <ZapOff className="h-3.5 w-3.5" />
          ) : (
            <Zap className="h-3.5 w-3.5" />
          )}
          <span>{circuitBreaker ? 'HALTED' : 'ACTIVE'}</span>
        </div>

        {/* Paper/Live badge */}
        <div
          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
            paperTrading
              ? 'bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/20'
              : 'bg-blue-500/10 text-blue-400 ring-1 ring-blue-500/20'
          }`}
        >
          {paperTrading ? 'PAPER' : 'LIVE'}
        </div>

        {/* Connection status */}
        <div
          className={`flex items-center gap-1 text-xs ${
            isConnected ? 'text-green-400' : 'text-red-400'
          }`}
          title={isConnected ? 'Connected' : 'Disconnected'}
        >
          {isConnected ? (
            <Wifi className="h-3.5 w-3.5" />
          ) : (
            <WifiOff className="h-3.5 w-3.5" />
          )}
          <span className="h-2 w-2 rounded-full bg-current" />
        </div>
      </div>
    </header>
  );
}
