import { useQuery } from '@tanstack/react-query';
import {
  Activity, Brain, DollarSign, Eye, Layers,
  Pause, RefreshCw, TrendingUp, TrendingDown,
  Target, Shield, Zap, Clock,
} from 'lucide-react';
import { apiClient } from '@/lib/api-client';

// ── Types ──────────────────────────────────────────────────────────────

interface ArbStatus {
  running: boolean;
  mode: string;
  scanCycles: number;
  lastScanAt: string | null;
  lastScanDurationMs: number;
  detectorsActive: number;
  opportunitiesFound: number;
  tradesExecuted: number;
  uptime: number;
  config: {
    scanIntervalMs: number;
    maxPerTradeUsd: number;
    startingCapital: number;
    thresholds: Record<string, number>;
  };
}

interface ArbPortfolio {
  startingCapital: number;
  cashUsd: number;
  positionsValue: number;
  totalValue: number;
  totalPnlUsd: number;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  openPositions: Array<{
    id: string;
    opportunity: {
      arbType: string;
      ticker_a: string;
      title_a: string;
      confidence: number;
      description: string;
    };
    entryTime: string;
    entryValue: number;
    pnl: number;
    status: string;
  }>;
  recentTrades: Array<{
    id: string;
    opportunity: {
      arbType: string;
      ticker_a: string;
      description: string;
    };
    exitTime: string;
    pnl: number;
    exitReason: string;
  }>;
}

interface ArbLearner {
  stats: Array<{
    arbType: string;
    totalTrades: number;
    wins: number;
    losses: number;
    winRate: number;
    totalPnl: number;
    avgPnl: number;
  }>;
  totalTrades: number;
  totalPnl: number;
  overallWinRate: number;
}

interface ScanResult {
  data: {
    opportunities: number;
    decisions: Array<{
      action: string;
      arbType: string;
      ticker: string;
      confidence: number;
      reasoning: string;
    }>;
    rawOpportunities: Array<{
      arbType: string;
      ticker_a: string;
      title_a: string;
      grossProfitPerContract: number;
      netProfitPerContract: number;
      confidence: number;
      urgency: string;
      description: string;
    }>;
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────

const ARB_TYPE_LABELS: Record<string, string> = {
  type1_single_rebalance: 'T1: Rebalance',
  type2_dutch_book: 'T2: Dutch Book',
  type3_cross_platform: 'T3: Cross-Platform',
  type4_combinatorial: 'T4: Combinatorial',
  type4_combinatorial_mutex: 'T4: Mutex',
  type5_settlement: 'T5: Settlement',
  type6_latency: 'T6: Latency',
  type7_options_implied: 'T7: Options',
};

const ARB_TYPE_COLORS: Record<string, string> = {
  type1_single_rebalance: 'bg-green-500/20 text-green-400',
  type2_dutch_book: 'bg-blue-500/20 text-blue-400',
  type3_cross_platform: 'bg-purple-500/20 text-purple-400',
  type4_combinatorial: 'bg-orange-500/20 text-orange-400',
  type4_combinatorial_mutex: 'bg-orange-500/20 text-orange-400',
  type5_settlement: 'bg-red-500/20 text-red-400',
  type6_latency: 'bg-yellow-500/20 text-yellow-400',
  type7_options_implied: 'bg-cyan-500/20 text-cyan-400',
};

function formatUptime(ms: number): string {
  const hours = Math.floor(ms / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

// ── Component ──────────────────────────────────────────────────────────

export function ArbIntelPage() {
  const { data: status } = useQuery<ArbStatus>({
    queryKey: ['arb-status'],
    queryFn: async () => {
      const res = await apiClient.get<{ data: ArbStatus }>('/arb-intel/status');
      return (res as { data: ArbStatus }).data ?? res as unknown as ArbStatus;
    },
    refetchInterval: 10_000,
  });

  const { data: portfolio } = useQuery<ArbPortfolio>({
    queryKey: ['arb-portfolio'],
    queryFn: async () => {
      const res = await apiClient.get<{ data: ArbPortfolio }>('/arb-intel/portfolio');
      return (res as { data: ArbPortfolio }).data ?? res as unknown as ArbPortfolio;
    },
    refetchInterval: 10_000,
  });

  const { data: learner } = useQuery<ArbLearner>({
    queryKey: ['arb-learner'],
    queryFn: async () => {
      const res = await apiClient.get<{ data: ArbLearner }>('/arb-intel/learner');
      return (res as { data: ArbLearner }).data ?? res as unknown as ArbLearner;
    },
    refetchInterval: 30_000,
  });

  const { data: scanData, refetch: forceScan, isFetching: scanning } = useQuery<ScanResult>({
    queryKey: ['arb-scan'],
    queryFn: () => apiClient.get<ScanResult>('/arb-intel/scan'),
    enabled: false,
  });

  const pnl = portfolio?.totalPnlUsd ?? 0;
  const pnlColor = pnl >= 0 ? 'text-green-400' : 'text-red-400';

  return (
    <div className="space-y-4 p-3 md:space-y-6 md:p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Brain className="h-6 w-6 text-purple-400" />
          <div>
            <h1 className="text-lg font-bold text-slate-100">Arb Intelligence</h1>
            <p className="text-xs text-slate-500">7-Detector Arbitrage Engine</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {status?.running ? (
            <span className="flex items-center gap-1.5 text-xs bg-green-500/20 text-green-400 px-3 py-1.5 rounded-full">
              <span className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />
              Paper Mode Active
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-xs bg-slate-700 text-slate-400 px-3 py-1.5 rounded-full">
              <Pause className="h-3 w-3" />
              Stopped
            </span>
          )}
          <button
            onClick={() => forceScan()}
            disabled={scanning}
            className="flex items-center gap-1.5 text-xs bg-purple-600 hover:bg-purple-500 text-white px-3 py-1.5 rounded-lg transition disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${scanning ? 'animate-spin' : ''}`} />
            Force Scan
          </button>
        </div>
      </div>

      {/* Paper Trading Banner */}
      <div className="rounded-xl border border-purple-500/30 bg-purple-500/10 p-3 flex items-center gap-3">
        <Shield className="h-5 w-5 text-purple-400 shrink-0" />
        <div>
          <p className="text-xs font-medium text-purple-300">Paper Trading — $5,000 Virtual Capital</p>
          <p className="text-[10px] text-purple-400/70">7 detectors scanning Kalshi + Polymarket every 30s. Brain validates fees before every trade.</p>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5 md:gap-3">
        <StatCard label="Portfolio" value={`$${(portfolio?.totalValue ?? 5000).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} color="text-slate-100" icon={<DollarSign className="h-4 w-4" />} />
        <StatCard label="P&L" value={`${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`} color={pnlColor} icon={pnl >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />} />
        <StatCard label="Trades" value={String(portfolio?.trades ?? 0)} subtitle={`${portfolio?.wins ?? 0}W / ${portfolio?.losses ?? 0}L`} color="text-blue-400" icon={<Target className="h-4 w-4" />} />
        <StatCard label="Scan Cycles" value={String(status?.scanCycles ?? 0)} subtitle={`${status?.lastScanDurationMs ?? 0}ms avg`} color="text-slate-200" icon={<Activity className="h-4 w-4" />} />
        <StatCard label="Opps Found" value={String(status?.opportunitiesFound ?? 0)} subtitle={formatUptime(status?.uptime ?? 0)} color="text-purple-400" icon={<Eye className="h-4 w-4" />} />
      </div>

      {/* 7 Detector Status */}
      <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 overflow-hidden">
        <div className="border-b border-slate-700/30 px-4 py-2.5 flex items-center gap-2">
          <Layers className="h-4 w-4 text-purple-400" />
          <h2 className="text-xs font-semibold text-slate-300">7 Arb Detectors</h2>
        </div>
        <div className="grid grid-cols-2 gap-px bg-slate-700/30 md:grid-cols-4">
          {Object.entries(ARB_TYPE_LABELS).filter(([k]) => !k.includes('mutex')).map(([type, label]) => {
            const typeStats = learner?.stats?.find(s => s.arbType === type);
            return (
              <div key={type} className="bg-slate-800/80 p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${ARB_TYPE_COLORS[type] ?? 'bg-slate-600 text-slate-300'}`}>{label}</span>
                  <span className="h-2 w-2 rounded-full bg-green-400" />
                </div>
                <div className="text-[10px] text-slate-500 mt-1">
                  {typeStats ? `${typeStats.totalTrades} trades, ${typeStats.winRate}% win` : 'No trades yet'}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Open Positions */}
      {(portfolio?.openPositions?.length ?? 0) > 0 && (
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 overflow-hidden">
          <div className="border-b border-slate-700/30 px-4 py-2.5">
            <h2 className="text-xs font-semibold text-slate-300">Open Positions</h2>
          </div>
          <div className="divide-y divide-slate-700/30">
            {portfolio?.openPositions.map(pos => (
              <div key={pos.id} className="flex items-center justify-between px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${ARB_TYPE_COLORS[pos.opportunity.arbType] ?? 'bg-slate-600 text-slate-300'}`}>
                    {ARB_TYPE_LABELS[pos.opportunity.arbType] ?? pos.opportunity.arbType}
                  </span>
                  <span className="text-xs text-slate-200">{pos.opportunity.ticker_a}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] text-slate-500">${pos.entryValue.toFixed(2)}</span>
                  <span className={`text-xs font-mono font-medium ${pos.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {pos.pnl >= 0 ? '+' : ''}${pos.pnl.toFixed(2)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Latest Scan Results */}
      {scanData?.data?.rawOpportunities && scanData.data.rawOpportunities.length > 0 && (
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 overflow-hidden">
          <div className="border-b border-slate-700/30 px-4 py-2.5 flex items-center gap-2">
            <Zap className="h-4 w-4 text-yellow-400" />
            <h2 className="text-xs font-semibold text-slate-300">Latest Scan ({scanData.data.opportunities} opportunities)</h2>
          </div>
          <div className="divide-y divide-slate-700/30 max-h-80 overflow-y-auto">
            {scanData.data.rawOpportunities.slice(0, 10).map((opp, i) => (
              <div key={i} className="px-4 py-2.5">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${ARB_TYPE_COLORS[opp.arbType] ?? 'bg-slate-600 text-slate-300'}`}>
                      {ARB_TYPE_LABELS[opp.arbType] ?? opp.arbType}
                    </span>
                    <span className={`text-[10px] px-1 rounded ${opp.urgency === 'critical' ? 'bg-red-500/20 text-red-400' : opp.urgency === 'high' ? 'bg-orange-500/20 text-orange-400' : 'bg-slate-600 text-slate-400'}`}>
                      {opp.urgency}
                    </span>
                  </div>
                  <span className="text-xs text-slate-400 font-mono">{(opp.confidence * 100).toFixed(0)}% conf</span>
                </div>
                <p className="text-[11px] text-slate-300 leading-tight">{opp.description}</p>
                <div className="flex gap-4 mt-1 text-[10px] text-slate-500">
                  <span>Gross: ${opp.grossProfitPerContract.toFixed(3)}/contract</span>
                  <span>Net: ${opp.netProfitPerContract.toFixed(3)}/contract</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Brain Decisions */}
      {scanData?.data?.decisions && scanData.data.decisions.length > 0 && (
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 overflow-hidden">
          <div className="border-b border-slate-700/30 px-4 py-2.5 flex items-center gap-2">
            <Brain className="h-4 w-4 text-purple-400" />
            <h2 className="text-xs font-semibold text-slate-300">Brain Decisions</h2>
          </div>
          <div className="divide-y divide-slate-700/30">
            {scanData.data.decisions.map((d, i) => (
              <div key={i} className="px-4 py-2.5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                    d.action === 'execute' ? 'bg-green-500/20 text-green-400' :
                    d.action === 'investigate' ? 'bg-yellow-500/20 text-yellow-400' :
                    'bg-slate-600 text-slate-400'
                  }`}>
                    {d.action.toUpperCase()}
                  </span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${ARB_TYPE_COLORS[d.arbType] ?? 'bg-slate-600 text-slate-300'}`}>
                    {ARB_TYPE_LABELS[d.arbType] ?? d.arbType}
                  </span>
                </div>
                <span className="text-[10px] text-slate-500 max-w-[50%] truncate">{d.reasoning}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Closed Trades */}
      {(portfolio?.recentTrades?.length ?? 0) > 0 && (
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 overflow-hidden">
          <div className="border-b border-slate-700/30 px-4 py-2.5 flex items-center gap-2">
            <Clock className="h-4 w-4 text-slate-400" />
            <h2 className="text-xs font-semibold text-slate-300">Recent Trades</h2>
          </div>
          <div className="divide-y divide-slate-700/30">
            {portfolio?.recentTrades.map(t => (
              <div key={t.id} className="flex items-center justify-between px-4 py-2">
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${ARB_TYPE_COLORS[t.opportunity.arbType] ?? 'bg-slate-600 text-slate-300'}`}>
                    {ARB_TYPE_LABELS[t.opportunity.arbType] ?? t.opportunity.arbType}
                  </span>
                  <span className="text-xs text-slate-300">{t.opportunity.ticker_a}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] text-slate-500">{t.exitReason}</span>
                  <span className={`text-xs font-mono font-medium ${t.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Config Thresholds */}
      <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-4">
        <h3 className="text-xs font-semibold text-slate-400 mb-3">Detector Thresholds</h3>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {status?.config?.thresholds && Object.entries(status.config.thresholds).map(([key, val]) => (
            <div key={key} className="flex items-center justify-between bg-slate-900/50 rounded px-2 py-1.5">
              <span className="text-[10px] text-slate-500">{key.replace(/([A-Z])/g, ' $1').replace('Min', '').trim()}</span>
              <span className="text-[10px] font-mono text-slate-300">{val}{key.includes('Pct') ? '%' : '\u00A2'}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────

function StatCard({ label, value, subtitle, color, icon }: {
  label: string; value: string; subtitle?: string; color: string; icon: React.ReactNode;
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
