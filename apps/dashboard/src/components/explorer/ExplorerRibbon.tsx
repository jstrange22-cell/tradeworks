/**
 * Aggregate ribbon — quick stats for the currently filtered set.
 *
 * Shows: total count, win rate (over closed trades), avg expectancy,
 * avg R-multiple, plus a verdict mix (approve/veto/escalate). Updates
 * live as filters change.
 */
import { Activity, DollarSign, Percent, Sparkles } from 'lucide-react';
import type { AggregateBucketStats } from '@/types/explorer';

interface ExplorerRibbonProps {
  totals: AggregateBucketStats | null;
  isLoading: boolean;
  available: boolean;
}

export function ExplorerRibbon({ totals, isLoading, available }: ExplorerRibbonProps) {
  const n = totals?.n ?? 0;
  const closed = totals?.closed ?? 0;
  const winRate = totals?.winRate ?? 0;
  const avgPnl = totals?.avgPnlUsd ?? 0;
  const avgR = totals?.avgRMultiple ?? 0;
  const totalPnl = totals?.totalPnlUsd ?? 0;
  const approves = totals?.approves ?? 0;
  const vetoes = totals?.vetoes ?? 0;
  const escalations = totals?.escalations ?? 0;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <Stat
        icon={<Activity className="h-4 w-4 text-blue-400" />}
        label="Decisions"
        primary={isLoading ? '—' : n.toLocaleString()}
        secondary={available ? `${closed.toLocaleString()} closed` : 'memory offline'}
      />
      <Stat
        icon={<Percent className="h-4 w-4 text-green-400" />}
        label="Win Rate"
        primary={closed === 0 ? '—' : `${(winRate * 100).toFixed(1)}%`}
        secondary={`${closed} closed`}
      />
      <Stat
        icon={<DollarSign className="h-4 w-4 text-amber-400" />}
        label="Avg P&L"
        primary={
          closed === 0
            ? '—'
            : `${avgPnl >= 0 ? '+' : ''}$${avgPnl.toFixed(2)}`
        }
        primaryTone={avgPnl > 0 ? 'text-green-400' : avgPnl < 0 ? 'text-red-400' : undefined}
        secondary="per closed trade"
      />
      <Stat
        icon={<Sparkles className="h-4 w-4 text-violet-400" />}
        label="Avg R"
        primary={
          closed === 0 ? '—' : `${avgR >= 0 ? '+' : ''}${avgR.toFixed(2)}R`
        }
        primaryTone={avgR > 0 ? 'text-green-400' : avgR < 0 ? 'text-red-400' : undefined}
        secondary="r-multiple"
      />
      <Stat
        icon={<DollarSign className="h-4 w-4 text-emerald-400" />}
        label="Total P&L"
        primary={
          closed === 0
            ? '—'
            : `${totalPnl >= 0 ? '+' : ''}$${totalPnl.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
        }
        primaryTone={totalPnl > 0 ? 'text-green-400' : totalPnl < 0 ? 'text-red-400' : undefined}
        secondary="cumulative"
      />
      <div className="card flex flex-col justify-center gap-1.5 px-4 py-3">
        <div className="text-[11px] uppercase tracking-wider text-slate-500">Verdict mix</div>
        <div className="flex items-center gap-2 text-xs font-medium">
          <span className="text-green-400">{approves}</span>
          <span className="text-slate-600">/</span>
          <span className="text-red-400">{vetoes}</span>
          <span className="text-slate-600">/</span>
          <span className="text-amber-400">{escalations}</span>
        </div>
        <div className="text-[10px] text-slate-500">approve / veto / escalate</div>
      </div>
    </div>
  );
}

interface StatProps {
  icon: React.ReactNode;
  label: string;
  primary: string;
  primaryTone?: string;
  secondary: string;
}

function Stat({ icon, label, primary, primaryTone, secondary }: StatProps) {
  return (
    <div className="card flex flex-col gap-1.5 px-4 py-3">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-slate-500">
        {icon}
        {label}
      </div>
      <div className={`text-lg font-bold tracking-tight ${primaryTone ?? 'text-slate-100'}`}>
        {primary}
      </div>
      <div className="text-[10px] text-slate-500">{secondary}</div>
    </div>
  );
}
