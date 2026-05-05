import { useState, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Pause,
  Play,
  TrendingUp,
  AlertTriangle,
  Loader2,
  Activity,
  ExternalLink,
  Rocket,
  X,
  CheckCircle2,
  ShieldAlert,
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { apiClient } from '@/lib/api-client';

// ── Types ──────────────────────────────────────────────────────────────

type StrategyStatus = 'paper' | 'live' | 'paused';

interface StrategyStats30d {
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  expectancy: number | null;
  totalPnlUsd: number;
  sharpe: number | null;
  maxDdUsd: number;
  openPositions: number;
  lastDecisionTs: string | null;
}

interface StrategyOverlay {
  live: boolean;
  sizingScalar: number;
  status: StrategyStatus;
  promotedAt: string | null;
  pausedAt: string | null;
  pauseReason: string | null;
}

interface StrategyDescriptor {
  name: string;
  overlay: StrategyOverlay;
  effectiveStatus: StrategyStatus;
  banditWeight: number;
  stats: StrategyStats30d;
}

interface EquityPoint {
  ts: string;
  equity: number;
}

interface DecisionRow {
  id: string;
  ts: string;
  symbol: string | null;
  verdict: 'approve' | 'veto' | 'escalate' | null;
  confidence: number | null;
  resolution: 'executed' | 'skipped' | 'manual_override' | 'expired' | null;
  pnlUsd: number | null;
}

// ── Display helpers ────────────────────────────────────────────────────

const STRATEGY_LABELS: Record<string, string> = {
  pead: 'Post-Earnings Announcement Drift',
  regime_trend: 'Regime Trend',
  vol_rank_options: 'Volatility-Ranked Options',
  sector_rotation: 'Sector Rotation',
  funding_basis: 'Funding Basis',
  range_grid_stables: 'Stablecoin Range Grid',
};

const VERDICT_STYLES: Record<string, string> = {
  approve: 'bg-green-500/10 text-green-400 ring-green-500/20',
  veto: 'bg-red-500/10 text-red-400 ring-red-500/20',
  escalate: 'bg-amber-500/10 text-amber-400 ring-amber-500/20',
};

function formatNumber(n: number | null, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatPct(n: number | null, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(digits)}%`;
}

function formatTs(ts: string | null): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ── Status Pill ────────────────────────────────────────────────────────

function StatusPill({ status }: { status: StrategyStatus }) {
  const styles: Record<StrategyStatus, string> = {
    paper: 'bg-slate-500/10 text-slate-300 ring-slate-500/30',
    live: 'bg-green-500/15 text-green-400 ring-green-500/30',
    paused: 'bg-amber-500/15 text-amber-400 ring-amber-500/30',
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ring-1 ${styles[status]}`}
    >
      {status === 'paused' ? (
        <Pause className="h-3 w-3" aria-hidden />
      ) : status === 'live' ? (
        <Activity className="h-3 w-3" aria-hidden />
      ) : (
        <ShieldAlert className="h-3 w-3" aria-hidden />
      )}
      {status}
    </span>
  );
}

// ── Sparkline ──────────────────────────────────────────────────────────

function EquitySparkline({ points }: { points: EquityPoint[] }) {
  if (points.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-slate-700/50 text-sm text-slate-500">
        No realized P&amp;L in the last 90 days
      </div>
    );
  }

  return (
    <div className="h-48 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis
            dataKey="ts"
            stroke="#64748b"
            tick={{ fill: '#64748b', fontSize: 11 }}
            tickFormatter={(v: string) => new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            minTickGap={32}
          />
          <YAxis
            stroke="#64748b"
            tick={{ fill: '#64748b', fontSize: 11 }}
            tickFormatter={(v: number) => `$${v.toLocaleString()}`}
            domain={['auto', 'auto']}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#1e293b',
              border: '1px solid #334155',
              borderRadius: '8px',
              color: '#f1f5f9',
            }}
            labelFormatter={(v: string) => new Date(v).toLocaleString()}
            formatter={(v: number) => [`$${formatNumber(v)}`, 'Realized P&L']}
          />
          <Line type="monotone" dataKey="equity" stroke="#3b82f6" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Promote-to-Live Dialog ─────────────────────────────────────────────

interface PromoteDialogProps {
  strategyName: string;
  onClose: () => void;
  onConfirm: (sizingScalar: number) => void;
  isPending: boolean;
  error: Error | null;
}

function PromoteDialog({
  strategyName,
  onClose,
  onConfirm,
  isPending,
  error,
}: PromoteDialogProps) {
  const [reviewedReport, setReviewedReport] = useState(false);
  const [hasFourWeeks, setHasFourWeeks] = useState(false);
  const [acceptsRisk, setAcceptsRisk] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const SIZING_SCALAR = 0.25;

  const allChecked = reviewedReport && hasFourWeeks && acceptsRisk;
  const confirmValid = confirmText.trim() === 'PROMOTE';
  const canSubmit = allChecked && confirmValid && !isPending;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="promote-dialog-title"
    >
      <div className="w-full max-w-lg rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10 text-amber-400">
              <ShieldAlert className="h-5 w-5" aria-hidden />
            </div>
            <h2
              id="promote-dialog-title"
              className="text-lg font-semibold text-slate-100"
            >
              Promote to Live
            </h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            aria-label="Close dialog"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <p className="mt-4 text-sm leading-relaxed text-slate-300">
          Promote{' '}
          <code className="rounded bg-slate-800 px-1.5 py-0.5 text-amber-300">
            {strategyName}
          </code>{' '}
          to <span className="font-semibold text-green-400">LIVE</span>? This will route
          real-money signals to Alpaca live.
        </p>

        <div className="mt-3 rounded-lg bg-amber-500/5 p-3 ring-1 ring-amber-500/20">
          <p className="text-xs text-amber-300">
            Initial sizing scalar: <span className="font-bold">{(SIZING_SCALAR * 100).toFixed(0)}%</span>{' '}
            — strategy will start with 1/4 of its full vol budget.
          </p>
        </div>

        <fieldset className="mt-4 space-y-2.5">
          <legend className="sr-only">Promotion checklist</legend>
          <label className="flex cursor-pointer items-start gap-2.5 rounded-lg p-2 hover:bg-slate-800/40">
            <input
              type="checkbox"
              checked={reviewedReport}
              onChange={(e) => setReviewedReport(e.target.checked)}
              className="mt-0.5 h-4 w-4 cursor-pointer rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-2 focus:ring-blue-500/40"
            />
            <span className="text-xs leading-relaxed text-slate-300">
              I have reviewed the walk-forward report (Sharpe ≥ 0.7 across windows)
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2.5 rounded-lg p-2 hover:bg-slate-800/40">
            <input
              type="checkbox"
              checked={hasFourWeeks}
              onChange={(e) => setHasFourWeeks(e.target.checked)}
              className="mt-0.5 h-4 w-4 cursor-pointer rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-2 focus:ring-blue-500/40"
            />
            <span className="text-xs leading-relaxed text-slate-300">
              I have ≥4 weeks of post-build paper trades on this strategy
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2.5 rounded-lg p-2 hover:bg-slate-800/40">
            <input
              type="checkbox"
              checked={acceptsRisk}
              onChange={(e) => setAcceptsRisk(e.target.checked)}
              className="mt-0.5 h-4 w-4 cursor-pointer rounded border-slate-600 bg-slate-800 text-red-500 focus:ring-2 focus:ring-red-500/40"
            />
            <span className="text-xs leading-relaxed text-slate-300">
              I accept that errors here move <span className="font-semibold text-red-400">real money</span>
            </span>
          </label>
        </fieldset>

        <div className="mt-4">
          <label
            htmlFor="promote-confirm"
            className="block text-xs font-medium text-slate-400"
          >
            Type <code className="rounded bg-slate-800 px-1 py-0.5 font-mono text-amber-300">PROMOTE</code> to confirm
          </label>
          <input
            id="promote-confirm"
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            disabled={!allChecked}
            placeholder="PROMOTE"
            className="mt-1.5 w-full rounded-md border border-slate-600 bg-slate-800 px-3 py-2 font-mono text-sm text-slate-100 placeholder:text-slate-600 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/30 disabled:cursor-not-allowed disabled:opacity-50"
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        {error && (
          <div className="mt-3 flex items-start gap-2 rounded-lg bg-red-500/10 p-3 text-sm text-red-400 ring-1 ring-red-500/20">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{error.message || 'Promote failed'}</span>
          </div>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={isPending}
            className="rounded-md px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(SIZING_SCALAR)}
            disabled={!canSubmit}
            className="flex items-center gap-2 rounded-md bg-green-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-green-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-500"
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            <Rocket className="h-4 w-4" aria-hidden />
            Promote to Live
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Pause Dialog ───────────────────────────────────────────────────────

interface PauseDialogProps {
  strategyName: string;
  onClose: () => void;
  onConfirm: (hours: number, reason: string) => void;
  isPending: boolean;
  error: Error | null;
}

function PauseDialog({
  strategyName,
  onClose,
  onConfirm,
  isPending,
  error,
}: PauseDialogProps) {
  const [hours, setHours] = useState(24);
  const [reason, setReason] = useState('');

  const canSubmit = hours > 0 && reason.trim().length > 0 && !isPending;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pause-dialog-title"
    >
      <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <h2
            id="pause-dialog-title"
            className="flex items-center gap-2 text-lg font-semibold text-slate-100"
          >
            <Pause className="h-5 w-5 text-amber-400" aria-hidden />
            Pause Strategy
          </h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-800"
            aria-label="Close dialog"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <p className="mt-3 text-sm text-slate-400">
          Pause <span className="text-slate-200">{strategyName}</span> — bandit weight will
          drop to floor for the duration.
        </p>

        <div className="mt-4 space-y-3">
          <div>
            <label htmlFor="pause-hours" className="block text-xs font-medium text-slate-400">
              Duration (hours)
            </label>
            <input
              id="pause-hours"
              type="number"
              min={1}
              max={720}
              value={hours}
              onChange={(e) => setHours(Number(e.target.value) || 0)}
              className="mt-1 w-full rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />
          </div>
          <div>
            <label htmlFor="pause-reason" className="block text-xs font-medium text-slate-400">
              Reason
            </label>
            <textarea
              id="pause-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="e.g. unexpected drawdown, bad news, awaiting recompute"
              className="mt-1 w-full rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />
          </div>
        </div>

        {error && (
          <div className="mt-3 rounded-lg bg-red-500/10 p-3 text-sm text-red-400">
            {error.message || 'Pause failed'}
          </div>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={isPending}
            className="rounded-md px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(hours, reason.trim())}
            disabled={!canSubmit}
            className="flex items-center gap-2 rounded-md bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-500 disabled:cursor-not-allowed disabled:bg-slate-700"
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            Pause
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Recent Decisions Table ─────────────────────────────────────────────

function DecisionsTable({ rows }: { rows: DecisionRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-700/50 p-6 text-center text-sm text-slate-500">
        No decisions logged for this strategy yet.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-700/50">
      <table className="min-w-full divide-y divide-slate-700/50 text-sm">
        <thead className="bg-slate-800/40">
          <tr>
            <Th>Time</Th>
            <Th>Symbol</Th>
            <Th>Verdict</Th>
            <Th className="text-right">Conf.</Th>
            <Th className="text-right">P&amp;L</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/50">
          {rows.map((d) => {
            const verdictStyle = d.verdict ? VERDICT_STYLES[d.verdict] : 'bg-slate-700 text-slate-300';
            const pnlClass =
              d.pnlUsd == null ? 'text-slate-500'
              : d.pnlUsd >= 0 ? 'text-green-400'
              : 'text-red-400';
            return (
              <tr key={d.id} className="hover:bg-slate-800/30">
                <Td className="text-slate-300">{formatTs(d.ts)}</Td>
                <Td className="font-medium text-slate-200">{d.symbol ?? '—'}</Td>
                <Td>
                  {d.verdict ? (
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ring-1 ${verdictStyle}`}
                    >
                      {d.verdict}
                    </span>
                  ) : (
                    <span className="text-xs text-slate-500">—</span>
                  )}
                </Td>
                <Td className="text-right font-mono text-slate-300">
                  {d.confidence == null ? '—' : `${(d.confidence * 100).toFixed(0)}%`}
                </Td>
                <Td className={`text-right font-mono ${pnlClass}`}>
                  {d.pnlUsd == null ? '—' : `${d.pnlUsd >= 0 ? '+' : ''}$${formatNumber(d.pnlUsd)}`}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Th({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={`px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400 ${className}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-3 py-2 ${className}`}>{children}</td>;
}

// ── Main Page ──────────────────────────────────────────────────────────

export function StrategyPage() {
  const { strategyId } = useParams<{ strategyId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showPromote, setShowPromote] = useState(false);
  const [showPause, setShowPause] = useState(false);

  const name = strategyId ?? '';

  const detailQuery = useQuery({
    queryKey: ['v2-strategies', name],
    queryFn: () =>
      apiClient.get<{ data: StrategyDescriptor }>(`/v2-strategies/${name}`).then(
        (r) => r.data,
      ),
    enabled: name.length > 0,
    staleTime: 15_000,
  });

  const equityQuery = useQuery({
    queryKey: ['v2-strategies', name, 'equity-curve'],
    queryFn: () =>
      apiClient
        .get<{ data: { points: EquityPoint[] } }>(`/v2-strategies/${name}/equity-curve`)
        .then((r) => r.data.points),
    enabled: name.length > 0,
    staleTime: 30_000,
  });

  const decisionsQuery = useQuery({
    queryKey: ['v2-strategies', name, 'decisions'],
    queryFn: () =>
      apiClient
        .get<{ data: DecisionRow[] }>(`/v2-strategies/${name}/decisions`, { limit: 30 })
        .then((r) => r.data),
    enabled: name.length > 0,
    staleTime: 15_000,
  });

  const promoteMutation = useMutation({
    mutationFn: (sizingScalar: number) =>
      apiClient.post(`/v2-strategies/${name}/promote-to-live`, { sizingScalar }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['v2-strategies'] });
      setShowPromote(false);
    },
  });

  const pauseMutation = useMutation({
    mutationFn: ({ hours, reason }: { hours: number; reason: string }) =>
      apiClient.post(`/v2-strategies/${name}/pause`, { hours, reason }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['v2-strategies'] });
      void queryClient.invalidateQueries({ queryKey: ['kill-switches'] });
      setShowPause(false);
    },
  });

  const resumeMutation = useMutation({
    mutationFn: () => apiClient.post(`/v2-strategies/${name}/resume`, {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['v2-strategies'] });
      void queryClient.invalidateQueries({ queryKey: ['kill-switches'] });
    },
  });

  const descriptor = detailQuery.data;
  const equityPoints = equityQuery.data ?? [];
  const decisions = decisionsQuery.data ?? [];

  const reportLink = useMemo(
    () => `https://github.com/jstrange22-cell/tradeworks/tree/master/research/research/strategies/${name}/reports`,
    [name],
  );
  const paramsLink = useMemo(
    () => `https://github.com/jstrange22-cell/tradeworks/blob/master/research/research/strategies/${name}/params.yaml`,
    [name],
  );

  if (!name) {
    return (
      <div className="card text-sm text-slate-400">No strategy selected.</div>
    );
  }

  if (detailQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-blue-400" aria-label="Loading" />
      </div>
    );
  }

  if (detailQuery.error || !descriptor) {
    return (
      <div className="card border-red-500/30 bg-red-500/5">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 text-red-400" aria-hidden />
          <div>
            <h2 className="text-sm font-semibold text-red-300">Strategy not found</h2>
            <p className="mt-1 text-xs text-slate-400">
              {detailQuery.error instanceof Error
                ? detailQuery.error.message
                : `No strategy named "${name}" is registered.`}
            </p>
            <button
              onClick={() => navigate('/strategies')}
              className="mt-3 rounded-md bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
            >
              Back to strategies
            </button>
          </div>
        </div>
      </div>
    );
  }

  const isPaused = descriptor.effectiveStatus === 'paused';
  const isLive = descriptor.overlay.live;

  return (
    <div className="space-y-6">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <button
            onClick={() => navigate('/strategies')}
            className="mt-1 rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            aria-label="Back to strategies"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </button>
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="font-mono text-2xl font-bold text-slate-100">{descriptor.name}</h1>
              <StatusPill status={descriptor.effectiveStatus} />
              <span className="rounded-full bg-blue-500/10 px-2.5 py-1 text-xs font-semibold text-blue-300 ring-1 ring-blue-500/20">
                Bandit weight: {(descriptor.banditWeight * 100).toFixed(1)}%
              </span>
              {isLive && (
                <span className="rounded-full bg-green-500/10 px-2.5 py-1 text-xs font-semibold text-green-300 ring-1 ring-green-500/20">
                  Sizing: {(descriptor.overlay.sizingScalar * 100).toFixed(0)}%
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-slate-400">
              {STRATEGY_LABELS[descriptor.name] ?? 'V2 strategy'}
            </p>
            {descriptor.overlay.pausedAt && isPaused && (
              <p className="mt-1.5 text-xs text-amber-400">
                Paused {formatTs(descriptor.overlay.pausedAt)} — {descriptor.overlay.pauseReason ?? 'no reason given'}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isPaused ? (
            <button
              onClick={() => resumeMutation.mutate()}
              disabled={resumeMutation.isPending}
              className="flex items-center gap-1.5 rounded-md bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-500 disabled:opacity-50"
            >
              {resumeMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Play className="h-3.5 w-3.5" aria-hidden />
              )}
              Resume
            </button>
          ) : (
            <button
              onClick={() => setShowPause(true)}
              className="flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-500"
            >
              <Pause className="h-3.5 w-3.5" aria-hidden />
              Pause
            </button>
          )}
          <button
            onClick={() => setShowPromote(true)}
            disabled={isLive || isPaused}
            className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
            title={isLive ? 'Already live' : isPaused ? 'Cannot promote while paused' : undefined}
          >
            {isLive ? (
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <Rocket className="h-3.5 w-3.5" aria-hidden />
            )}
            {isLive ? 'Live' : 'Promote to Live'}
          </button>
        </div>
      </div>

      {/* ── Top Stats ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="30d Sharpe" value={formatNumber(descriptor.stats.sharpe)} />
        <StatCard label="Expectancy" value={descriptor.stats.expectancy == null ? '—' : `$${formatNumber(descriptor.stats.expectancy)}`} />
        <StatCard label="Win Rate" value={formatPct(descriptor.stats.winRate)} />
        <StatCard label="Total Trades" value={descriptor.stats.trades.toLocaleString()} />
        <StatCard
          label="Max DD (30d)"
          value={`-$${formatNumber(Math.abs(descriptor.stats.maxDdUsd))}`}
          tone="loss"
        />
        <StatCard label="Open" value={descriptor.stats.openPositions.toLocaleString()} />
      </div>

      {/* ── Equity Curve + Params ────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="card lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <div className="card-header flex items-center gap-2">
              <TrendingUp className="h-4 w-4" aria-hidden />
              Equity (90d realized P&amp;L)
            </div>
            {equityQuery.isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-500" />}
          </div>
          <EquitySparkline points={equityPoints} />
        </div>

        <div className="card">
          <div className="card-header flex items-center gap-2">
            <Activity className="h-4 w-4" aria-hidden />
            Configured params
          </div>
          <p className="mt-2 text-xs text-slate-400">
            Parameters live in the research repo at{' '}
            <code className="rounded bg-slate-800 px-1 py-0.5 text-slate-200">
              research/strategies/{descriptor.name}/params.yaml
            </code>
            .
          </p>
          <div className="mt-3 space-y-1.5">
            <a
              href={paramsLink}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between gap-2 rounded-md border border-slate-700/60 px-3 py-2 text-xs text-slate-300 hover:border-blue-500/40 hover:bg-blue-500/5"
            >
              <span>params.yaml</span>
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
            <a
              href={reportLink}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between gap-2 rounded-md border border-slate-700/60 px-3 py-2 text-xs text-slate-300 hover:border-blue-500/40 hover:bg-blue-500/5"
            >
              <span>Latest walk-forward report</span>
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
          </div>
          <div className="mt-4 rounded-md bg-slate-800/40 p-2.5 text-[11px] leading-relaxed text-slate-400">
            Last decision:{' '}
            <span className="text-slate-200">{formatTs(descriptor.stats.lastDecisionTs)}</span>
          </div>
        </div>
      </div>

      {/* ── Recent Decisions ─────────────────────────────────────── */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-300">
            Recent decisions ({decisions.length})
          </h2>
          <Link
            to="/trades"
            className="text-xs text-blue-400 hover:text-blue-300"
          >
            See all trades →
          </Link>
        </div>
        {decisionsQuery.isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-slate-500" aria-label="Loading decisions" />
          </div>
        ) : (
          <DecisionsTable rows={decisions} />
        )}
      </div>

      {/* ── Modals ───────────────────────────────────────────────── */}
      {showPromote && (
        <PromoteDialog
          strategyName={descriptor.name}
          onClose={() => setShowPromote(false)}
          onConfirm={(scalar) => promoteMutation.mutate(scalar)}
          isPending={promoteMutation.isPending}
          error={promoteMutation.error as Error | null}
        />
      )}
      {showPause && (
        <PauseDialog
          strategyName={descriptor.name}
          onClose={() => setShowPause(false)}
          onConfirm={(hours, reason) => pauseMutation.mutate({ hours, reason })}
          isPending={pauseMutation.isPending}
          error={pauseMutation.error as Error | null}
        />
      )}
    </div>
  );
}

// ── Stat Card ──────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'profit' | 'loss';
}) {
  const toneClass =
    tone === 'profit'
      ? 'text-green-400'
      : tone === 'loss'
        ? 'text-red-400'
        : 'text-slate-100';
  return (
    <div className="card">
      <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
        {label}
      </div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${toneClass}`}>{value}</div>
    </div>
  );
}
