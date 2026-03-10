import { Maximize2, Minimize2 } from 'lucide-react';

const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'] as const;

export const INDICATORS = [
  { id: 'sma20', label: 'SMA 20', color: '#f59e0b', type: 'overlay' },
  { id: 'sma50', label: 'SMA 50', color: '#8b5cf6', type: 'overlay' },
  { id: 'ema12', label: 'EMA 12', color: '#06b6d4', type: 'overlay' },
  { id: 'ema26', label: 'EMA 26', color: '#ec4899', type: 'overlay' },
  { id: 'boll', label: 'BB', color: '#64748b', type: 'overlay' },
  { id: 'supertrend', label: 'SuperTrend', color: '#22d3ee', type: 'overlay' },
  { id: 'vwap', label: 'VWAP', color: '#f472b6', type: 'overlay' },
  { id: 'keltner', label: 'Keltner', color: '#2dd4bf', type: 'overlay' },
  { id: 'rsi', label: 'RSI', color: '#a855f7', type: 'panel' },
  { id: 'macd', label: 'MACD', color: '#3b82f6', type: 'panel' },
  { id: 'stochastic', label: 'Stoch', color: '#facc15', type: 'panel' },
  { id: 'cci', label: 'CCI', color: '#fb923c', type: 'panel' },
  { id: 'obv', label: 'OBV', color: '#a3e635', type: 'panel' },
  { id: 'volumeProfile', label: 'Vol Profile', color: '#8b5cf6', type: 'overlay' },
] as const;

export type IndicatorId = typeof INDICATORS[number]['id'];

interface IndicatorToolbarProps {
  timeframe: string;
  onTimeframeChange: (tf: string) => void;
  activeIndicators: Set<IndicatorId>;
  onToggleIndicator: (id: IndicatorId) => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
}

export function IndicatorToolbar({
  timeframe,
  onTimeframeChange,
  activeIndicators,
  onToggleIndicator,
  isFullscreen,
  onToggleFullscreen,
}: IndicatorToolbarProps) {
  return (
    <div className="flex items-center justify-between border-b border-slate-800 px-3 py-1.5">
      {/* Timeframe Pills */}
      <div className="flex items-center gap-0.5 rounded-md bg-slate-800/50 p-0.5">
        {TIMEFRAMES.map((tf) => (
          <button
            key={tf}
            onClick={() => onTimeframeChange(tf)}
            className={`rounded px-2.5 py-1 text-[11px] font-semibold transition-all ${
              timeframe === tf
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-500 hover:text-slate-200'
            }`}
          >
            {tf}
          </button>
        ))}
      </div>

      {/* Indicator Chips */}
      <div className="flex flex-wrap items-center gap-1">
        {INDICATORS.map((ind) => {
          const isActive = activeIndicators.has(ind.id);
          return (
            <button
              key={ind.id}
              onClick={() => onToggleIndicator(ind.id)}
              className={`rounded px-2 py-0.5 text-[10px] font-semibold transition-all ${
                isActive
                  ? 'text-white'
                  : 'text-slate-600 hover:text-slate-400'
              }`}
              style={isActive ? { backgroundColor: ind.color + '20', color: ind.color } : undefined}
            >
              {ind.label}
            </button>
          );
        })}
      </div>

      {/* Fullscreen Toggle */}
      <button
        onClick={onToggleFullscreen}
        className="rounded p-1 text-slate-500 transition-colors hover:text-slate-200"
        title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
      >
        {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
      </button>
    </div>
  );
}
