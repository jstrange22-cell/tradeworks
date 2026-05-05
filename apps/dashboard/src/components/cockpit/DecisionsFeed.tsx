/**
 * Last 20 TradeVisor agent decisions, newest first. Each row shows verdict,
 * confidence, ticker, action, and the tail of the model's reasoning.
 *
 * Source: /api/v1/tradevisor-agent/decisions?limit=20
 */
import { useMemo } from 'react';
import { Check, X, AlertTriangle } from 'lucide-react';
import { Card, CardBody, CardHeader, Skeleton } from './primitives';
import type { AgentVerdict, TradevisorDecision } from './types';

interface Props {
  data: TradevisorDecision[] | undefined;
  isLoading: boolean;
}

function timeAgo(iso: string): string {
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return '—';
  const diffMs = Date.now() - ts;
  const sec = Math.max(0, Math.round(diffMs / 1_000));
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.round(hr / 24);
  return `${day}d`;
}

function VerdictBadge({ verdict }: { verdict: AgentVerdict }) {
  if (verdict === 'approve') {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-300 ring-1 ring-emerald-500/30">
        <Check className="h-3 w-3" aria-hidden="true" />
        approve
      </span>
    );
  }
  if (verdict === 'veto') {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-rose-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-rose-300 ring-1 ring-rose-500/30">
        <X className="h-3 w-3" aria-hidden="true" />
        veto
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-amber-300 ring-1 ring-amber-500/30">
      <AlertTriangle className="h-3 w-3" aria-hidden="true" />
      escalate
    </span>
  );
}

function ActionTag({ action }: { action: 'BUY' | 'SELL' }) {
  return (
    <span
      className={`inline-flex rounded px-1 text-[10px] font-bold ${
        action === 'BUY'
          ? 'bg-emerald-500/15 text-emerald-300'
          : 'bg-rose-500/15 text-rose-300'
      }`}
    >
      {action}
    </span>
  );
}

export function DecisionsFeed({ data, isLoading }: Props) {
  const decisions = useMemo(() => (data ?? []).slice(0, 20), [data]);

  return (
    <Card className="h-full">
      <CardHeader
        title="APEX Decisions"
        subtitle={
          decisions.length > 0
            ? `Last ${decisions.length} signals`
            : 'No decisions yet'
        }
      />
      <CardBody className="p-0">
        {isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : decisions.length === 0 ? (
          <p className="p-4 text-xs text-slate-500">
            APEX hasn't gated any signals yet. Decisions will appear here as
            TradeVisor pings the gateway.
          </p>
        ) : (
          <ul className="max-h-[420px] divide-y divide-slate-700/40 overflow-y-auto">
            {decisions.map((d) => (
              <li
                key={d.id}
                className="flex items-start gap-3 px-4 py-2.5 text-xs hover:bg-slate-800/40"
              >
                <span className="w-9 flex-shrink-0 font-mono text-[10px] uppercase tabular-nums text-slate-500">
                  {timeAgo(d.createdAt)}
                </span>
                <span className="w-14 flex-shrink-0 font-semibold text-slate-200">
                  {d.symbol}
                </span>
                <ActionTag action={d.action} />
                <VerdictBadge verdict={d.verdict} />
                <span className="w-12 flex-shrink-0 tabular-nums text-slate-400">
                  {d.confidence.toFixed(2)}
                </span>
                <span className="flex-1 truncate text-slate-400" title={d.reasoning}>
                  {d.reasoning}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
