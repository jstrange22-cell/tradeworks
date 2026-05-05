/**
 * Decision detail page — drill-down for a single APEX reasoning event.
 *
 * Layout:
 *   header → signal card → context card → reasoning card → RAG card →
 *   active heuristics card → executions card → outcome card → notes
 *
 * Cards self-collapse so the page stays scannable with large JSON blobs.
 */
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Brain,
  CheckCircle2,
  Clock,
  DollarSign,
  ExternalLink,
  FileText,
  Layers,
  ListChecks,
  ShieldAlert,
  Sparkles,
  Target,
  TrendingUp,
} from 'lucide-react';
import { useExplorerDetail } from '@/hooks/useExplorer';
import { DetailCard } from '@/components/explorer/DetailCard';
import { JsonView } from '@/components/explorer/JsonView';
import { RagRetrievalsCard } from '@/components/explorer/RagRetrievalsCard';
import { AnnotationThread } from '@/components/explorer/AnnotationThread';
import type {
  ExplorerActiveHeuristic,
  ExplorerDecisionDetail,
  ExplorerExecution,
  ExplorerOutcome,
  Verdict,
} from '@/types/explorer';

export function DecisionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, isLoading, isError, error } = useExplorerDetail(id);

  if (!id) {
    return (
      <div className="card text-sm text-red-400">
        Missing decision id in URL.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-64 animate-pulse rounded bg-slate-800/60" />
        <div className="card">
          <div className="space-y-3">
            <div className="h-6 w-40 animate-pulse rounded bg-slate-800/60" />
            <div className="h-32 animate-pulse rounded bg-slate-800/60" />
          </div>
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="btn-ghost gap-1.5 text-xs"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </button>
        <div className="card border-red-500/30 bg-red-500/5">
          <div className="text-sm text-red-400">
            {error instanceof Error ? error.message : 'Failed to load decision'}
          </div>
        </div>
      </div>
    );
  }

  const { decision, executions, outcome, ragRetrievals, activeHeuristics } = data.data;

  return (
    <div className="space-y-4">
      <Header decision={decision} onBack={() => navigate(-1)} />

      <DetailCard
        icon={<FileText className="h-4 w-4 text-blue-400" />}
        title="Signal"
        subtitle="The full signal envelope APEX received"
      >
        <JsonView value={decision.signal} emptyText="No signal payload recorded" />
      </DetailCard>

      <ContextCard context={decision.context} />

      <ReasoningCard decision={decision} />

      <RagRetrievalsCard retrievals={ragRetrievals} />

      <HeuristicsCard heuristics={activeHeuristics} />

      <ExecutionsCard executions={executions} />

      <OutcomeCard outcome={outcome} />

      <AnnotationThread decisionId={decision.id} />
    </div>
  );
}

// ── Header ────────────────────────────────────────────────────────────

function Header({
  decision,
  onBack,
}: {
  decision: ExplorerDecisionDetail;
  onBack: () => void;
}) {
  return (
    <header className="space-y-2">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onBack} className="btn-ghost gap-1.5 text-xs">
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </button>
        <Link to="/explorer" className="text-xs text-slate-500 hover:text-slate-300">
          Explorer
        </Link>
        <span className="text-slate-700">/</span>
        <span className="text-xs text-slate-300">{decision.id.slice(0, 8)}…</span>
      </div>
      <div className="card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Brain className="h-5 w-5 text-blue-400" />
              <h1 className="text-xl font-bold text-slate-100">
                {decision.symbol ?? 'Unknown'}
              </h1>
              {decision.action && (
                <span className="rounded bg-blue-500/15 px-2 py-0.5 text-xs font-medium text-blue-300">
                  {decision.action.toUpperCase()}
                </span>
              )}
              <VerdictBadge verdict={decision.verdict} />
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
              <span>
                Strategy: <span className="text-slate-300">{decision.strategy}</span>
              </span>
              <span>·</span>
              <span>
                Regime:{' '}
                <span className="text-slate-300">{decision.regime ?? 'n/a'}</span>
              </span>
              <span>·</span>
              <span>
                Sector:{' '}
                <span className="text-slate-300">{decision.sector ?? 'n/a'}</span>
              </span>
              {decision.scoutRank !== null && (
                <>
                  <span>·</span>
                  <span>
                    Scout rank:{' '}
                    <span className="text-slate-300">#{decision.scoutRank}</span>
                  </span>
                </>
              )}
              <span>·</span>
              <span>
                {new Date(decision.createdAt).toLocaleString([], {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 text-right text-[11px] sm:grid-cols-4">
            <Pill icon={<Target className="h-3 w-3" />} label="Confidence" value={fmtPct(decision.confidence)} />
            <Pill icon={<DollarSign className="h-3 w-3" />} label="Size" value={fmtUsd(decision.adjustedSizeUsd)} />
            <Pill icon={<ShieldAlert className="h-3 w-3" />} label="Stop" value={fmtPctPct(decision.adjustedStopPct)} />
            <Pill icon={<Clock className="h-3 w-3" />} label="Latency" value={decision.reasoningLatencyMs ? `${decision.reasoningLatencyMs}ms` : '—'} />
          </div>
        </div>
        {decision.modelUsed && (
          <div className="mt-3 border-t border-slate-200 pt-2 text-[11px] text-slate-500 dark:border-slate-700/50">
            Model: <span className="text-slate-300">{decision.modelUsed}</span>
            {decision.resolution && (
              <>
                <span className="mx-2">·</span>
                Resolution: <span className="text-slate-300">{decision.resolution}</span>
              </>
            )}
          </div>
        )}
      </div>
    </header>
  );
}

function VerdictBadge({ verdict }: { verdict: Verdict | null }) {
  if (verdict === 'approve')
    return (
      <span className="rounded bg-green-500/15 px-2 py-0.5 text-xs font-medium text-green-400">
        APPROVE
      </span>
    );
  if (verdict === 'veto')
    return (
      <span className="rounded bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-400">
        VETO
      </span>
    );
  if (verdict === 'escalate')
    return (
      <span className="rounded bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-400">
        ESCALATE
      </span>
    );
  return (
    <span className="rounded bg-slate-500/15 px-2 py-0.5 text-xs font-medium text-slate-400">
      PENDING
    </span>
  );
}

interface PillProps {
  icon: React.ReactNode;
  label: string;
  value: string;
}
function Pill({ icon, label, value }: PillProps) {
  return (
    <div className="rounded-md border border-slate-200/70 bg-slate-50/40 px-2.5 py-1.5 text-left dark:border-slate-700/50 dark:bg-slate-800/40">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-slate-500">
        {icon}
        {label}
      </div>
      <div className="text-sm font-semibold text-slate-200">{value}</div>
    </div>
  );
}

// ── Context card with scout/macro/news/portfolio sub-panes ────────────

function ContextCard({ context }: { context: unknown }) {
  const ctx =
    context && typeof context === 'object' ? (context as Record<string, unknown>) : null;
  const macro = ctx?.['macro'];
  const scout = ctx?.['scout'];
  const portfolio = ctx?.['portfolio'];
  const news = ctx?.['news'];
  const chartState = ctx?.['chartState'] ?? ctx?.['chart'];

  return (
    <DetailCard
      icon={<Layers className="h-4 w-4 text-emerald-400" />}
      title="Context"
      subtitle="Portfolio + macro + scout + news at decision time"
    >
      <div className="space-y-3">
        <SubSection title="Macro" value={macro} />
        <SubSection title="Scout" value={scout} />
        <SubSection title="Portfolio" value={portfolio} />
        <SubSection title="News" value={news} />
        {chartState !== undefined && <SubSection title="Chart state" value={chartState} />}
        {ctx === null && (
          <div className="text-sm italic text-slate-500">No context recorded.</div>
        )}
      </div>
    </DetailCard>
  );
}

function SubSection({ title, value }: { title: string; value: unknown }) {
  if (value === undefined) return null;
  return (
    <div>
      <div className="mb-1 text-[11px] uppercase tracking-wider text-slate-500">{title}</div>
      <JsonView value={value} maxHeightClass="max-h-56" emptyText={`No ${title.toLowerCase()}`} />
    </div>
  );
}

// ── Reasoning card (with optional ensemble per-model breakdown) ───────

function ReasoningCard({ decision }: { decision: ExplorerDecisionDetail }) {
  const ctx =
    decision.context && typeof decision.context === 'object'
      ? (decision.context as Record<string, unknown>)
      : null;
  const ensemble = ctx?.['ensemble'];
  const perModel =
    ensemble && typeof ensemble === 'object' && 'models' in ensemble
      ? ((ensemble as { models?: unknown }).models as unknown[] | undefined)
      : undefined;

  return (
    <DetailCard
      icon={<Sparkles className="h-4 w-4 text-violet-400" />}
      title="APEX reasoning"
      subtitle={decision.modelUsed ?? 'reasoning narrative'}
    >
      {decision.reasoning ? (
        <div className="whitespace-pre-wrap rounded-md border border-slate-200/60 bg-slate-50/40 p-3 text-sm leading-relaxed text-slate-300 dark:border-slate-700/50 dark:bg-slate-800/30">
          {decision.reasoning}
        </div>
      ) : (
        <div className="text-sm italic text-slate-500">No reasoning text recorded.</div>
      )}

      {perModel && perModel.length > 0 && (
        <div className="mt-3 space-y-2">
          <div className="text-[11px] uppercase tracking-wider text-slate-500">
            Ensemble per-model verdicts
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {perModel.map((m, i) => (
              <PerModelCell key={i} cell={m} />
            ))}
          </div>
        </div>
      )}
    </DetailCard>
  );
}

function PerModelCell({ cell }: { cell: unknown }) {
  const o =
    cell && typeof cell === 'object' ? (cell as Record<string, unknown>) : {};
  const model = typeof o['model'] === 'string' ? (o['model'] as string) : 'unknown';
  const verdict = typeof o['verdict'] === 'string' ? (o['verdict'] as string) : null;
  const ok = o['ok'] !== false;
  const error = typeof o['error'] === 'string' ? (o['error'] as string) : null;
  const latency =
    typeof o['latencyMs'] === 'number' ? (o['latencyMs'] as number) : null;

  return (
    <div className="rounded-md border border-slate-200/60 bg-slate-50/40 px-3 py-2 text-xs dark:border-slate-700/50 dark:bg-slate-800/30">
      <div className="flex items-center justify-between">
        <span className="font-medium text-slate-200">{model}</span>
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
            verdict === 'approve'
              ? 'bg-green-500/15 text-green-400'
              : verdict === 'veto'
                ? 'bg-red-500/15 text-red-400'
                : verdict === 'escalate'
                  ? 'bg-amber-500/15 text-amber-400'
                  : 'bg-slate-500/15 text-slate-400'
          }`}
        >
          {verdict ?? (ok ? 'no-parse' : 'error')}
        </span>
      </div>
      <div className="mt-1 text-[10px] text-slate-500">
        {latency !== null && <span>{latency}ms</span>}
        {error && <span className="ml-2 text-red-400">err: {error.slice(0, 60)}</span>}
      </div>
    </div>
  );
}

// ── Heuristics card ───────────────────────────────────────────────────

function HeuristicsCard({ heuristics }: { heuristics: ExplorerActiveHeuristic[] }) {
  return (
    <DetailCard
      icon={<ListChecks className="h-4 w-4 text-cyan-400" />}
      title="Active heuristics"
      subtitle={
        heuristics.length > 0
          ? `${heuristics.length} learned rules currently injected into the prompt`
          : 'No active heuristics'
      }
      defaultOpen={false}
    >
      {heuristics.length === 0 ? (
        <div className="text-sm italic text-slate-500">
          The post-mortem loop has not yet promoted any rules to active.
        </div>
      ) : (
        <ul className="space-y-2">
          {heuristics.map((h) => (
            <li
              key={h.id}
              className="rounded-md border border-slate-200/60 bg-slate-50/40 px-3 py-2 dark:border-slate-700/50 dark:bg-slate-800/30"
            >
              <div className="mb-1 flex items-center gap-2 text-[10px] text-slate-500">
                <span className="font-mono">{h.id}</span>
                {h.impact && (
                  <span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-violet-300">
                    {h.impact}
                  </span>
                )}
              </div>
              <div className="text-xs text-slate-300">{h.lesson}</div>
            </li>
          ))}
        </ul>
      )}
    </DetailCard>
  );
}

// ── Executions card ───────────────────────────────────────────────────

function ExecutionsCard({ executions }: { executions: ExplorerExecution[] }) {
  return (
    <DetailCard
      icon={<TrendingUp className="h-4 w-4 text-blue-400" />}
      title="Executions"
      subtitle={
        executions.length === 0
          ? 'No broker fills tied to this decision'
          : `${executions.length} broker fill${executions.length === 1 ? '' : 's'}`
      }
    >
      {executions.length === 0 ? (
        <div className="text-sm italic text-slate-500">
          The decision was vetoed, expired, or the order was rejected before any fills landed.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[10px] uppercase tracking-wider text-slate-500 dark:border-slate-700/50">
                <th className="pb-2 pr-3">Time</th>
                <th className="pb-2 pr-3">Class</th>
                <th className="pb-2 pr-3">Symbol</th>
                <th className="pb-2 pr-3">Side</th>
                <th className="pb-2 pr-3 text-right">Qty</th>
                <th className="pb-2 pr-3 text-right">Fill</th>
                <th className="pb-2 pr-3">Status</th>
                <th className="pb-2">Broker</th>
              </tr>
            </thead>
            <tbody>
              {executions.map((e) => (
                <tr
                  key={e.id}
                  className="border-b border-slate-200/60 last:border-b-0 dark:border-slate-700/40"
                >
                  <td className="py-2 pr-3 text-slate-400">
                    {new Date(e.createdAt).toLocaleTimeString()}
                  </td>
                  <td className="py-2 pr-3 text-slate-300">{e.assetClass}</td>
                  <td className="py-2 pr-3 font-medium text-slate-100">{e.symbol}</td>
                  <td className="py-2 pr-3">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                        e.side === 'buy' || e.side === 'cover'
                          ? 'bg-green-500/15 text-green-400'
                          : 'bg-red-500/15 text-red-400'
                      }`}
                    >
                      {e.side.toUpperCase()}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-right text-slate-300">{e.quantity}</td>
                  <td className="py-2 pr-3 text-right text-slate-300">
                    {e.fillPrice === null ? '—' : `$${e.fillPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
                  </td>
                  <td className="py-2 pr-3 text-slate-400">{e.fillStatus}</td>
                  <td className="py-2 text-slate-500">{e.broker}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </DetailCard>
  );
}

// ── Outcome card ──────────────────────────────────────────────────────

function OutcomeCard({ outcome }: { outcome: ExplorerOutcome | null }) {
  if (!outcome) {
    return (
      <DetailCard
        icon={<Clock className="h-4 w-4 text-slate-400" />}
        title="Outcome"
        subtitle="Position not yet closed"
      >
        <div className="text-sm italic text-slate-500">
          No realised outcome on file. The trade is open or was never filled.
        </div>
      </DetailCard>
    );
  }

  const pnlTone =
    outcome.realizedPnlUsd > 0
      ? 'text-green-400'
      : outcome.realizedPnlUsd < 0
        ? 'text-red-400'
        : 'text-slate-400';

  return (
    <DetailCard
      icon={<CheckCircle2 className="h-4 w-4 text-green-400" />}
      title="Outcome"
      subtitle={`Closed ${new Date(outcome.closedAt).toLocaleString()}`}
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Pill
          icon={<DollarSign className="h-3 w-3" />}
          label="Realised P&L"
          value={`${outcome.realizedPnlUsd >= 0 ? '+' : ''}$${outcome.realizedPnlUsd.toFixed(2)}`}
        />
        <Pill
          icon={<Sparkles className="h-3 w-3" />}
          label="R-Multiple"
          value={outcome.rMultiple === null ? '—' : `${outcome.rMultiple >= 0 ? '+' : ''}${outcome.rMultiple.toFixed(2)}R`}
        />
        <Pill
          icon={<Clock className="h-3 w-3" />}
          label="Holding"
          value={outcome.holdingMinutes === null ? '—' : `${outcome.holdingMinutes} min`}
        />
        <Pill
          icon={<ExternalLink className="h-3 w-3" />}
          label="Exit"
          value={outcome.exitReason ?? '—'}
        />
      </div>
      <div className={`mt-3 text-2xl font-bold ${pnlTone}`}>
        {outcome.realizedPnlUsd >= 0 ? '+' : ''}$
        {outcome.realizedPnlUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
        <span>
          Stop hit:{' '}
          <span className="text-slate-300">{boolLabel(outcome.wasStopHit)}</span>
        </span>
        <span>·</span>
        <span>
          Target hit:{' '}
          <span className="text-slate-300">{boolLabel(outcome.wasTargetHit)}</span>
        </span>
      </div>
      {outcome.notes && (
        <div className="mt-3 rounded-md border border-slate-200/60 bg-slate-50/40 p-3 text-xs text-slate-400 dark:border-slate-700/50 dark:bg-slate-800/30">
          {outcome.notes}
        </div>
      )}
    </DetailCard>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────

function fmtPct(v: number | null): string {
  if (v === null || v === undefined) return '—';
  return `${(v * 100).toFixed(1)}%`;
}
function fmtPctPct(v: number | null): string {
  if (v === null || v === undefined) return '—';
  return `${(v * 100).toFixed(2)}%`;
}
function fmtUsd(v: number | null): string {
  if (v === null || v === undefined) return '—';
  return `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}
function boolLabel(v: boolean | null): string {
  if (v === null || v === undefined) return '—';
  return v ? 'yes' : 'no';
}
