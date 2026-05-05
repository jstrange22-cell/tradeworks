import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Layers,
  Loader2,
  RefreshCw,
  Pause,
  Activity,
  ShieldAlert,
  AlertTriangle,
  ChevronRight,
  TrendingUp,
} from 'lucide-react';
import { apiClient } from '@/lib/api-client';

// ── Types (mirror gateway shape) ───────────────────────────────────────

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

// ── Display helpers ────────────────────────────────────────────────────

function formatNumber(n: number | null, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatTs(ts: string | null): string {
  if (!ts) return '—';
  const d = new Date(ts);
  const ageMs = Date.now() - d.getTime();
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function StatusPill({ status }: { status: StrategyStatus }) {
  const styles: Record<StrategyStatus, string> = {
    paper: 'bg-slate-500/10 text-slate-300 ring-slate-500/30',
    live: 'bg-green-500/15 text-green-400 ring-green-500/30',
    paused: 'bg-amber-500/15 text-amber-400 ring-amber-500/30',
  };
  const Icon = status === 'paused' ? Pause : status === 'live' ? Activity : ShieldAlert;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ${styles[status]}`}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {status}
    </span>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────

export function StrategiesIndexPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const listQuery = useQuery({
    queryKey: ['v2-strategies'],
    queryFn: () =>
      apiClient
        .get<{ data: StrategyDescriptor[] }>('/v2-strategies')
        .then((r) => r.data),
    staleTime: 15_000,
  });

  const recomputeMutation = useMutation({
    mutationFn: () => apiClient.post('/bandit/recompute', {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['v2-strategies'] });
      void queryClient.invalidateQueries({ queryKey: ['bandit'] });
    },
  });

  const strategies = listQuery.data ?? [];

  return (
    <div className="space-y-6">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Layers className="h-6 w-6 text-blue-400" aria-hidden />
          <div>
            <h1 className="text-2xl font-bold text-slate-100">Strategies</h1>
            <p className="text-sm text-slate-400">
              Bandit-managed v2 strategy lab — paper, live, paused.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => recomputeMutation.mutate()}
            disabled={recomputeMutation.isPending}
            className="flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800/50 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-700 disabled:opacity-50"
          >
            {recomputeMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            )}
            Recompute bandit
          </button>
        </div>
      </div>

      {/* ── Recompute feedback ─────────────────────────────────────── */}
      {recomputeMutation.isError && (
        <div className="card border-red-500/30 bg-red-500/5 text-sm text-red-300">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              Recompute failed:{' '}
              {recomputeMutation.error instanceof Error
                ? recomputeMutation.error.message
                : 'Unknown error'}
            </span>
          </div>
        </div>
      )}
      {recomputeMutation.isSuccess && (
        <div className="card border-green-500/30 bg-green-500/5 text-sm text-green-300">
          Bandit recompute kicked off — weights will refresh in a moment.
        </div>
      )}

      {/* ── List ───────────────────────────────────────────────────── */}
      {listQuery.isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-blue-400" aria-label="Loading strategies" />
        </div>
      ) : listQuery.error ? (
        <div className="card border-red-500/30 bg-red-500/5">
          <div className="flex items-start gap-3 text-sm text-red-300">
            <AlertTriangle className="mt-0.5 h-4 w-4" aria-hidden />
            <span>
              {listQuery.error instanceof Error
                ? listQuery.error.message
                : 'Failed to load strategies'}
            </span>
          </div>
        </div>
      ) : strategies.length === 0 ? (
        <div className="card text-sm text-slate-400">No strategies registered.</div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-700/50">
          <table className="min-w-full divide-y divide-slate-700/50 text-sm">
            <thead className="bg-slate-800/40">
              <tr>
                <Th>Strategy</Th>
                <Th>Status</Th>
                <Th className="text-right">Weight</Th>
                <Th className="text-right">30d Sharpe</Th>
                <Th className="text-right">30d Expectancy</Th>
                <Th className="text-right">Open</Th>
                <Th>Last Decision</Th>
                <Th className="w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50 bg-slate-900/40">
              {strategies.map((s) => (
                <tr
                  key={s.name}
                  onClick={() => navigate(`/strategies/${s.name}`)}
                  className="cursor-pointer transition-colors hover:bg-slate-800/40"
                >
                  <Td>
                    <div className="font-mono font-semibold text-slate-100">{s.name}</div>
                  </Td>
                  <Td>
                    <StatusPill status={s.effectiveStatus} />
                  </Td>
                  <Td className="text-right font-mono text-slate-200">
                    {(s.banditWeight * 100).toFixed(1)}%
                  </Td>
                  <Td className="text-right font-mono text-slate-200">
                    {formatNumber(s.stats.sharpe)}
                  </Td>
                  <Td className="text-right">
                    {s.stats.expectancy == null ? (
                      <span className="font-mono text-slate-500">—</span>
                    ) : (
                      <span
                        className={`flex items-center justify-end gap-1 font-mono ${
                          s.stats.expectancy >= 0 ? 'text-green-400' : 'text-red-400'
                        }`}
                      >
                        {s.stats.expectancy >= 0 && (
                          <TrendingUp className="h-3 w-3" aria-hidden />
                        )}
                        {s.stats.expectancy >= 0 ? '+' : ''}${formatNumber(s.stats.expectancy)}
                      </span>
                    )}
                  </Td>
                  <Td className="text-right font-mono text-slate-200">
                    {s.stats.openPositions}
                  </Td>
                  <Td className="text-slate-400">{formatTs(s.stats.lastDecisionTs)}</Td>
                  <Td>
                    <ChevronRight className="h-4 w-4 text-slate-500" aria-hidden />
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Th({
  children,
  className = '',
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={`px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400 ${className}`}
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
  return <td className={`px-3 py-2.5 ${className}`}>{children}</td>;
}
