import { useQuery } from '@tanstack/react-query';
import {
  TrendingUp, TrendingDown, Target,
  BarChart3, Zap, Clock,
} from 'lucide-react';
import { apiClient } from '@/lib/api-client';

// ── Types ──────────────────────────────────────────────────────────────

interface PnLSummary {
  totalPnlSol: number;
  unrealizedPnl: number;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  openPositions: number;
}

interface TemplateStats {
  templateId: string;
  templateName: string;
  totalTrades: number;
  wins: number;
  losses: number;
  totalPnlSol: number;
  winRate: number;
  openPositions: number;
  dailySpentSol: number;
  dailyBudgetSol: number;
  running: boolean;
}

interface RecentExecution {
  id: string;
  mint: string;
  symbol: string;
  name: string;
  action: 'buy' | 'sell';
  amountSol: number;
  status: 'pending' | 'success' | 'failed';
  trigger: string;
  templateName: string;
  timestamp: string;
}

interface PnLResponse {
  summary: PnLSummary;
  templates: TemplateStats[];
  recentExecutions: RecentExecution[];
}

// ── Component ──────────────────────────────────────────────────────────

export function SniperPnL() {
  const { data, isLoading } = useQuery<PnLResponse>({
    queryKey: ['sniper-pnl'],
    queryFn: () => apiClient.get<PnLResponse>('/solana/sniper/pnl'),
    refetchInterval: 10_000,
  });

  const summary = data?.summary;
  const templates = data?.templates ?? [];
  const executions = data?.recentExecutions ?? [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500" />
      </div>
    );
  }

  const totalPnl = summary?.totalPnlSol ?? 0;
  const pnlColor = totalPnl >= 0 ? 'text-green-400' : 'text-red-400';
  const PnlIcon = totalPnl >= 0 ? TrendingUp : TrendingDown;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <BarChart3 className="h-5 w-5 text-blue-400" />
        <h2 className="text-sm font-semibold text-slate-200">Sniper Performance</h2>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Total P&L"
          value={`${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(4)} SOL`}
          color={pnlColor}
          icon={<PnlIcon className="h-4 w-4" />}
        />
        <StatCard
          label="Win Rate"
          value={`${(summary?.winRate ?? 0).toFixed(1)}%`}
          subtitle={`${summary?.wins ?? 0}W / ${summary?.losses ?? 0}L`}
          color="text-blue-400"
          icon={<Target className="h-4 w-4" />}
        />
        <StatCard
          label="Total Trades"
          value={String(summary?.totalTrades ?? 0)}
          subtitle={`${summary?.openPositions ?? 0} open`}
          color="text-slate-200"
          icon={<Zap className="h-4 w-4" />}
        />
        <StatCard
          label="Unrealized"
          value={`${(summary?.unrealizedPnl ?? 0) >= 0 ? '+' : ''}${(summary?.unrealizedPnl ?? 0).toFixed(4)}`}
          color={(summary?.unrealizedPnl ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}
          icon={<Clock className="h-4 w-4" />}
        />
      </div>

      {/* Per-Template Breakdown */}
      {templates.length > 1 && (
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 overflow-hidden">
          <div className="border-b border-slate-700/30 px-4 py-2.5">
            <h3 className="text-xs font-semibold text-slate-400">Template Breakdown</h3>
          </div>
          <div className="divide-y divide-slate-700/30">
            {templates.map(tpl => (
              <div key={tpl.templateId} className="flex items-center justify-between px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${tpl.running ? 'bg-green-400' : 'bg-slate-600'}`} />
                  <span className="text-xs font-medium text-slate-200">{tpl.templateName}</span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-[10px] text-slate-500">{tpl.totalTrades} trades</span>
                  <span className="text-[10px] text-slate-500">{tpl.winRate.toFixed(0)}% win</span>
                  <span className={`text-xs font-mono font-medium ${
                    tpl.totalPnlSol >= 0 ? 'text-green-400' : 'text-red-400'
                  }`}>
                    {tpl.totalPnlSol >= 0 ? '+' : ''}{tpl.totalPnlSol.toFixed(4)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Executions */}
      <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 overflow-hidden">
        <div className="border-b border-slate-700/30 px-4 py-2.5">
          <h3 className="text-xs font-semibold text-slate-400">Recent Trades</h3>
        </div>
        {executions.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-slate-500">
            No trades yet — sniper is waiting for matching tokens
          </div>
        ) : (
          <div className="divide-y divide-slate-700/30 max-h-64 overflow-y-auto">
            {executions.map(exec => (
              <div key={exec.id} className="flex items-center justify-between px-4 py-2">
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                    exec.action === 'buy'
                      ? 'bg-green-500/20 text-green-400'
                      : 'bg-red-500/20 text-red-400'
                  }`}>
                    {exec.action.toUpperCase()}
                  </span>
                  <span className="text-xs font-medium text-slate-200">{exec.symbol}</span>
                  <span className="text-[10px] text-slate-500">{exec.name}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] text-slate-500">
                    {exec.amountSol.toFixed(3)} SOL
                  </span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                    exec.status === 'success'
                      ? 'bg-green-500/20 text-green-400'
                      : exec.status === 'failed'
                        ? 'bg-red-500/20 text-red-400'
                        : 'bg-yellow-500/20 text-yellow-400'
                  }`}>
                    {exec.status}
                  </span>
                  <span className="text-[10px] text-slate-600">
                    {new Date(exec.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────

function StatCard({
  label, value, subtitle, color, icon,
}: {
  label: string;
  value: string;
  subtitle?: string;
  color: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-slate-500">{label}</span>
        <span className={color}>{icon}</span>
      </div>
      <p className={`text-sm font-bold font-mono ${color}`}>{value}</p>
      {subtitle && <p className="text-[10px] text-slate-500 mt-0.5">{subtitle}</p>}
    </div>
  );
}
