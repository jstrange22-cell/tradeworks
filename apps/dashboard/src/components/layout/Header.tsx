import { usePortfolio } from '@/hooks/usePortfolio';
import { useUIStore } from '@/stores/ui-store';
import { Menu, Zap, ZapOff, Wifi, WifiOff, Sun, Moon } from 'lucide-react';

export function Header() {
  const { equity, dailyPnl, dailyPnlPercent, paperTrading, circuitBreaker } =
    usePortfolio();
  const { setSidebarOpen, theme, toggleTheme } = useUIStore();
  const isConnected = true; // Will be driven by WebSocket state

  const pnlColor = dailyPnl >= 0 ? 'text-green-400' : 'text-red-400';
  const pnlBg = dailyPnl >= 0 ? 'bg-green-500/10' : 'bg-red-500/10';

  return (
    <header className="flex h-14 items-center justify-between border-b border-slate-700/50 bg-slate-900/80 px-4 backdrop-blur-sm md:px-6">
      {/* Left: Hamburger (mobile) + label */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setSidebarOpen(true)}
          className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200 md:hidden"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <span className="hidden text-sm text-slate-500 md:block">TradeWorks Engine</span>
      </div>

      {/* Center: P&L */}
      <div className="flex items-center gap-4 md:gap-6">
        <div className="text-center">
          <div className="text-xs text-slate-500">Equity</div>
          <div className="text-base font-bold text-slate-100 md:text-lg">
            {equity > 0
              ? `$${equity.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
              : <span className="text-slate-500">--</span>
            }
          </div>
        </div>

        {equity > 0 && (
          <div className={`hidden rounded-lg px-3 py-1.5 sm:block ${pnlBg}`}>
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
      <div className="flex items-center gap-2 md:gap-3">
        {/* Circuit Breaker */}
        <div
          className={`flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium md:px-2.5 ${
            circuitBreaker
              ? 'bg-red-500/10 text-red-400 ring-1 ring-red-500/20'
              : 'bg-green-500/10 text-green-400 ring-1 ring-green-500/20'
          }`}
          title={circuitBreaker ? 'Circuit breaker TRIGGERED' : 'Circuit breaker OK'}
        >
          {circuitBreaker ? <ZapOff className="h-3.5 w-3.5" /> : <Zap className="h-3.5 w-3.5" />}
          <span className="hidden sm:inline">{circuitBreaker ? 'HALTED' : 'ACTIVE'}</span>
        </div>

        {/* Paper/Live badge */}
        <div
          className={`hidden rounded-full px-2.5 py-1 text-xs font-medium sm:block ${
            paperTrading
              ? 'bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/20'
              : 'bg-blue-500/10 text-blue-400 ring-1 ring-blue-500/20'
          }`}
        >
          {paperTrading ? 'PAPER' : 'LIVE'}
        </div>

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>

        {/* Connection status */}
        <div
          className={`flex items-center gap-1 text-xs ${
            isConnected ? 'text-green-400' : 'text-red-400'
          }`}
          title={isConnected ? 'Connected' : 'Disconnected'}
        >
          {isConnected ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
          <span className="h-2 w-2 rounded-full bg-current" />
        </div>
      </div>
    </header>
  );
}
