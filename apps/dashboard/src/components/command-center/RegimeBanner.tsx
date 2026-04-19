import { AlertTriangle, TrendingUp, TrendingDown, Activity } from 'lucide-react';

interface MacroSignal {
  name: string;
  value: number;
  interpretation: 'bullish' | 'bearish' | 'neutral';
}

interface RegimeBannerProps {
  regime: string;
  confidence: number;
  positionSizeMultiplier: number;
  summary: string;
  signals: MacroSignal[];
}

const regimeConfig: Record<string, {
  bg: string;
  border: string;
  text: string;
  icon: typeof TrendingUp;
  label: string;
}> = {
  risk_on: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', text: 'text-emerald-400', icon: TrendingUp, label: 'RISK ON' },
  risk_off: { bg: 'bg-red-500/10', border: 'border-red-500/30', text: 'text-red-400', icon: TrendingDown, label: 'RISK OFF' },
  transitioning: { bg: 'bg-amber-500/10', border: 'border-amber-500/30', text: 'text-amber-400', icon: Activity, label: 'TRANSITIONING' },
  crisis: { bg: 'bg-red-700/10', border: 'border-red-700/40', text: 'text-red-300', icon: AlertTriangle, label: 'CRISIS' },
};

const signalColor: Record<string, string> = {
  bullish: 'bg-emerald-500/20 text-emerald-400',
  bearish: 'bg-red-500/20 text-red-400',
  neutral: 'bg-slate-600/30 text-slate-400',
};

export function RegimeBanner({ regime, confidence, positionSizeMultiplier, summary, signals }: RegimeBannerProps) {
  const config = regimeConfig[regime] ?? regimeConfig.transitioning;
  const Icon = config.icon;

  return (
    <div className={`rounded-xl border ${config.border} ${config.bg} p-4`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className={`rounded-lg bg-black/20 p-2 ${config.text}`}>
            <Icon className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className={`text-xs font-bold uppercase tracking-widest ${config.text}`}>
                {config.label}
              </span>
              <span className="rounded-full bg-black/20 px-2 py-0.5 text-[10px] text-slate-300">
                {confidence}% confidence
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-300">{summary}</p>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-2xl font-bold text-white">{(positionSizeMultiplier * 100).toFixed(0)}%</div>
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Position Size</div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {signals.map((s) => (
          <span key={s.name} className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${signalColor[s.interpretation]}`}>
            {s.name}: {s.value.toFixed(1)}
          </span>
        ))}
      </div>
    </div>
  );
}
