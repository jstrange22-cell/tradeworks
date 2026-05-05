/**
 * Compact regime indicator — small colored pill that shows the current market
 * regime tag plus its confidence. The full rationale is in the title attribute
 * so hovering reveals "why this regime".
 */
import { Activity, AlertTriangle, Sparkles, TrendingUp } from 'lucide-react';
import { Skeleton } from './primitives';
import type { MarketRegime, RegimeTag } from './types';

interface Props {
  regime: MarketRegime | undefined;
  isLoading: boolean;
}

const REGIME_STYLE: Record<RegimeTag, { ring: string; bg: string; text: string; dot: string; label: string }> = {
  calm: {
    ring: 'ring-emerald-500/40',
    bg: 'bg-emerald-500/10',
    text: 'text-emerald-300',
    dot: 'bg-emerald-400',
    label: 'Calm',
  },
  trending: {
    ring: 'ring-sky-500/40',
    bg: 'bg-sky-500/10',
    text: 'text-sky-300',
    dot: 'bg-sky-400',
    label: 'Trending',
  },
  volatile: {
    ring: 'ring-amber-500/40',
    bg: 'bg-amber-500/10',
    text: 'text-amber-300',
    dot: 'bg-amber-400',
    label: 'Volatile',
  },
  crisis: {
    ring: 'ring-rose-500/40',
    bg: 'bg-rose-500/10',
    text: 'text-rose-300',
    dot: 'bg-rose-400',
    label: 'Crisis',
  },
};

function RegimeIcon({ tag }: { tag: RegimeTag }) {
  switch (tag) {
    case 'trending':
      return <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />;
    case 'volatile':
      return <Activity className="h-3.5 w-3.5" aria-hidden="true" />;
    case 'crisis':
      return <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />;
    case 'calm':
    default:
      return <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />;
  }
}

export function RegimePill({ regime, isLoading }: Props) {
  if (isLoading || !regime) {
    return <Skeleton className="h-7 w-32" />;
  }

  const style = REGIME_STYLE[regime.tag];
  const confidencePct = (regime.confidence * 100).toFixed(0);

  return (
    <span
      title={regime.rationale}
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ring-1 ${style.bg} ${style.text} ${style.ring}`}
    >
      <span
        aria-hidden="true"
        className={`h-2 w-2 rounded-full ${style.dot} animate-pulse`}
      />
      <RegimeIcon tag={regime.tag} />
      <span>Regime: {style.label}</span>
      <span className="text-slate-400/80">·</span>
      <span className="tabular-nums text-slate-300">{confidencePct}%</span>
    </span>
  );
}
