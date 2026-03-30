import { X } from 'lucide-react';
import { type AISignalResult } from '@/lib/ai-signal-engine';

interface AISignalPanelProps {
  signal: AISignalResult | null;
  isLoading: boolean;
  onClose?: () => void;
}

function LayerBar({ label, score }: { label: string; score: number }) {
  const pct = Math.round(((score + 1) / 2) * 100);
  const color = score > 0.2 ? '#22c55e' : score < -0.2 ? '#ef4444' : '#94a3b8';
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 text-[10px] text-slate-400">{label}</span>
      <div className="flex-1 rounded-full bg-slate-700 h-1.5 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <span className="w-8 text-right text-[10px]" style={{ color }}>
        {score > 0 ? '+' : ''}{score.toFixed(2)}
      </span>
    </div>
  );
}

function PriceRow({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="text-[9px] font-medium uppercase tracking-wider" style={{ color }}>{label}</span>
      <span className="text-[11px] font-mono font-semibold text-slate-200">
        {value.toLocaleString(undefined, { maximumFractionDigits: 2 })}
      </span>
    </div>
  );
}

export function AISignalPanel({ signal, isLoading, onClose }: AISignalPanelProps) {
  if (isLoading) {
    return (
      <div className="w-64 rounded-xl border border-slate-700/50 bg-slate-900/95 p-3 shadow-2xl backdrop-blur">
        <div className="flex items-center justify-between gap-2 text-slate-400">
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 animate-spin rounded-full border-2 border-slate-600 border-t-blue-400" />
            <span className="text-xs">Computing signal…</span>
          </div>
          {onClose && (
            <button onClick={onClose} className="rounded p-0.5 text-slate-600 hover:text-white transition" title="Close">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!signal) return null;

  const { direction, confidence, entryPrice, stopLoss, tp1, tp2, tp3, reasoning, layerScores, htfBias, score } = signal;

  const accentColor = direction === 'buy' ? '#22c55e' : direction === 'sell' ? '#ef4444' : '#94a3b8';
  const dirLabel = direction === 'buy' ? '▲ BUY' : direction === 'sell' ? '▼ SELL' : '— HOLD';
  const isPulsing = confidence > 70 && direction !== 'neutral';

  const htfColor = htfBias === 'bullish' ? '#22c55e' : htfBias === 'bearish' ? '#ef4444' : '#94a3b8';
  const htfArrow = htfBias === 'bullish' ? '↑' : htfBias === 'bearish' ? '↓' : '→';

  return (
    <div
      className="w-64 rounded-xl bg-slate-900/95 shadow-2xl backdrop-blur overflow-hidden"
      style={{ border: `1px solid ${accentColor}40` }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2"
        style={{ borderBottom: `1px solid ${accentColor}30`, background: `${accentColor}10` }}
      >
        <div className="flex items-center gap-2">
          {isPulsing && (
            <span
              className="relative flex h-2.5 w-2.5"
            >
              <span
                className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
                style={{ backgroundColor: accentColor }}
              />
              <span
                className="relative inline-flex rounded-full h-2.5 w-2.5"
                style={{ backgroundColor: accentColor }}
              />
            </span>
          )}
          <span className="text-[11px] font-bold tracking-widest uppercase text-slate-300">AI Signal</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div
            className="rounded-full px-2.5 py-0.5 text-[11px] font-bold"
            style={{ color: accentColor, background: `${accentColor}20` }}
          >
            {dirLabel}
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="rounded p-0.5 text-slate-500 hover:text-white transition pointer-events-auto"
              title="Close"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="p-3 space-y-3">
        {/* Confidence bar */}
        <div>
          <div className="flex justify-between mb-1">
            <span className="text-[10px] text-slate-500">Confidence</span>
            <span className="text-[11px] font-bold" style={{ color: accentColor }}>{confidence}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-slate-700 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{ width: `${confidence}%`, backgroundColor: accentColor }}
            />
          </div>
        </div>

        {/* HTF Bias */}
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-slate-500">HTF Bias</span>
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase"
            style={{ color: htfColor, background: `${htfColor}20` }}
          >
            {htfBias.toUpperCase()} {htfArrow}
          </span>
        </div>

        {/* Price levels */}
        <div className="grid grid-cols-5 gap-1 rounded-lg bg-slate-800/60 p-2">
          <PriceRow label="Entry" value={entryPrice} color="#94a3b8" />
          <PriceRow label="Stop" value={stopLoss} color="#ef4444" />
          <PriceRow label="TP1" value={tp1} color="#22c55e" />
          <PriceRow label="TP2" value={tp2} color="#4ade80" />
          <PriceRow label="TP3" value={tp3} color="#86efac" />
        </div>

        {/* Layer breakdown */}
        <div className="space-y-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Layer Scores</span>
          <LayerBar label="Trend 35%" score={layerScores.trend} />
          <LayerBar label="Momentum 30%" score={layerScores.momentum} />
          <LayerBar label="Structure 25%" score={layerScores.structure} />
          <LayerBar label="Volume 10%" score={layerScores.volume} />
        </div>

        {/* Reasoning */}
        {reasoning.length > 0 && (
          <div className="space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Signals</span>
            {reasoning.slice(0, 3).map((r, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <span className="text-[10px]" style={{ color: accentColor }}>•</span>
                <span className="text-[10px] text-slate-300">{r}</span>
              </div>
            ))}
          </div>
        )}

        {/* Score pill */}
        <div className="flex justify-end">
          <span className="text-[9px] text-slate-600 font-mono">
            score: {score > 0 ? '+' : ''}{score.toFixed(3)}
          </span>
        </div>
      </div>
    </div>
  );
}
