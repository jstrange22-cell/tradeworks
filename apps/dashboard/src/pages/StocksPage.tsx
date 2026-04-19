import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import {
  TrendingUp, TrendingDown, BarChart3, Activity, Shield,
  Zap, Target, DollarSign, Layers, RefreshCw, Clock,
  PieChart, ArrowUpDown,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────

interface StockStatus {
  running: boolean;
  mode: string;
  scanCycles: number;
  lastScanAt: string | null;
  lastScanDurationMs: number;
  enginesActive: number;
  opportunitiesFound: number;
  tradesExecuted: number;
  regime: string;
}

interface StockPortfolio {
  startingCapital: number;
  cashUsd: number;
  positionsValue: number;
  totalValue: number;
  totalPnlUsd: number;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  openPositions: Array<{
    opportunity: {
      engine: string;
      domain: string;
      ticker: string;
      action: string;
      reasoning: string;
      confidence: number;
    };
    size: number;
    pnl: number;
    pnlPct: number;
    status: string;
    openedAt: string;
  }>;
  recentTrades: Array<{
    opportunity: { engine: string; ticker: string; reasoning: string };
    size: number;
    pnl: number;
    status: string;
    closedAt: string;
    closeReason: string;
  }>;
  byEngine: Record<string, { trades: number; pnl: number; winRate: number }>;
}

// ── TradeVisor Paper Ledger (separate from the orchestrator's engine portfolio) ──

interface EquityPositionRow {
  id: string;
  symbol: string;
  shares: number;
  entryPrice: number;
  currentPrice: number;
  entryAt: string;
  signalSource: string;
  signalScore: number;
}

interface OptionPositionRow {
  id: string;
  symbol: string;
  occSymbol: string;
  type: 'call' | 'put';
  strike: number;
  expiry: string;
  contracts: number;
  entryMid: number;
  currentMid: number;
  entryIV?: number;
  entryAt: string;
  signalSource: string;
  signalScore: number;
}

interface TradevisorLedger {
  paperCashUsd: number;
  equityPositions: EquityPositionRow[];
  optionPositions: OptionPositionRow[];
  equityCount: number;
  optionCount: number;
  maxEquityPositions: number;
  maxOptionPositions: number;
  equityValueUsd: number;
  optionValueUsd: number;
  totalValueUsd: number;
  stats: { totalTrades: number; wins: number; losses: number };
}

// ── Helpers ──────────────────────────────────────────────────────────────

const ENGINE_LABELS: Record<string, { name: string; color: string; bg: string }> = {
  E1: { name: 'Mean Reversion', color: 'text-blue-400', bg: 'bg-blue-500/20' },
  E2: { name: 'Momentum', color: 'text-cyan-400', bg: 'bg-cyan-500/20' },
  E3: { name: 'Pairs Arb', color: 'text-purple-400', bg: 'bg-purple-500/20' },
  E4: { name: 'Swing', color: 'text-green-400', bg: 'bg-green-500/20' },
  O1: { name: 'Iron Condor', color: 'text-amber-400', bg: 'bg-amber-500/20' },
  O2: { name: 'Wheel', color: 'text-orange-400', bg: 'bg-orange-500/20' },
  O3: { name: '0DTE', color: 'text-red-400', bg: 'bg-red-500/20' },
  O4: { name: 'Vol Arb', color: 'text-pink-400', bg: 'bg-pink-500/20' },
  M1: { name: 'Bond Rotation', color: 'text-teal-400', bg: 'bg-teal-500/20' },
  M2: { name: 'Metals', color: 'text-yellow-400', bg: 'bg-yellow-500/20' },
  M3: { name: 'Risk Parity', color: 'text-slate-300', bg: 'bg-slate-500/20' },
  M4: { name: 'Sector Rot', color: 'text-indigo-400', bg: 'bg-indigo-500/20' },
  X1: { name: 'Pred Bridge', color: 'text-emerald-400', bg: 'bg-emerald-500/20' },
  X2: { name: 'News Alpha', color: 'text-rose-400', bg: 'bg-rose-500/20' },
};

const REGIME_COLORS: Record<string, string> = {
  risk_on: 'text-emerald-400',
  neutral: 'text-blue-400',
  risk_off: 'text-amber-400',
  crisis: 'text-red-400',
};

type Tab = 'overview' | 'positions' | 'engines' | 'activity';

// ── Component ──────────────────────────────────────────────────────────

export function StocksPage() {
  const [activeTab, setActiveTab] = useState<Tab>('overview');

  const { data: statusData } = useQuery({
    queryKey: ['stocks-status'],
    queryFn: () => apiClient.get<{ data: StockStatus }>('/stocks-intel/status'),
    refetchInterval: 10_000,
  });
  const s = (statusData as { data: StockStatus } | undefined)?.data;

  const { data: portfolioData } = useQuery({
    queryKey: ['stocks-portfolio'],
    queryFn: () => apiClient.get<{ data: StockPortfolio }>('/stocks-intel/portfolio'),
    refetchInterval: 10_000,
  });
  const p = (portfolioData as { data: StockPortfolio } | undefined)?.data;

  const { data: ledgerData } = useQuery({
    queryKey: ['stocks-tradevisor-ledger'],
    queryFn: () => apiClient.get<{ data: TradevisorLedger }>('/stocks/portfolio'),
    refetchInterval: 15_000,
  });
  const tv = (ledgerData as { data: TradevisorLedger } | undefined)?.data;

  const { data: scanData, refetch: forceScan, isFetching: scanning } = useQuery({
    queryKey: ['stocks-scan'],
    queryFn: () => apiClient.get<{ data: { opportunities: number; topOpps: Array<{ engine: string; ticker: string; action: string; confidence: number; reasoning: string; domain: string }> } }>('/stocks-intel/scan'),
    enabled: false,
  });
  const scan = (scanData as { data: { opportunities: number; topOpps: Array<{ engine: string; ticker: string; action: string; confidence: number; reasoning: string; domain: string }> } } | undefined)?.data;

  const pnl = p?.totalPnlUsd ?? 0;
  const pnlColor = pnl >= 0 ? 'text-emerald-400' : 'text-red-400';

  const TABS: Array<{ key: Tab; label: string; icon: React.ReactNode }> = [
    { key: 'overview', label: 'Overview', icon: <BarChart3 className="h-3.5 w-3.5" /> },
    { key: 'positions', label: 'Positions', icon: <Layers className="h-3.5 w-3.5" /> },
    { key: 'engines', label: 'Engines', icon: <Zap className="h-3.5 w-3.5" /> },
    { key: 'activity', label: 'Activity', icon: <Activity className="h-3.5 w-3.5" /> },
  ];

  return (
    <div className="space-y-4 p-3 md:space-y-6 md:p-6">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <BarChart3 className="h-6 w-6 md:h-7 md:w-7 text-indigo-400" />
          <div>
            <h1 className="text-lg md:text-2xl font-bold text-slate-100">Stock Intelligence</h1>
            <p className="text-[10px] md:text-xs text-slate-500">14 Engines — Equities, Options, Macro, Cross-Asset</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-semibold capitalize px-2 py-1 rounded ${REGIME_COLORS[s?.regime ?? ''] ?? 'text-slate-400'} bg-slate-800`}>
            {s?.regime?.replace('_', ' ') ?? 'unknown'}
          </span>
          <button
            onClick={() => forceScan()}
            disabled={scanning}
            className="flex items-center gap-1.5 text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-lg transition disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${scanning ? 'animate-spin' : ''}`} />
            Scan
          </button>
        </div>
      </div>

      {/* Paper Trading Banner with Balance Breakdown */}
      <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-3">
        <div className="flex items-center gap-3">
          <Shield className="h-5 w-5 text-indigo-400 shrink-0" />
          <div className="flex-1">
            <p className="text-xs font-medium text-indigo-300">Paper Trading — Stocks & Options via Alpaca</p>
            <p className="text-[10px] text-indigo-400/70">14 engines · {s?.regime ?? 'unknown'} regime</p>
          </div>
          <div className={`text-base font-bold md:text-lg ${pnlColor}`}>{pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}</div>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg bg-slate-900/40 p-2">
            <div className="text-sm font-bold text-white">${(p?.totalValue ?? 10000).toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
            <div className="text-[9px] text-slate-500">Total Balance</div>
          </div>
          <div className="rounded-lg bg-slate-900/40 p-2">
            <div className="text-sm font-bold text-amber-400">${(p?.positionsValue ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
            <div className="text-[9px] text-slate-500">At Risk ({p?.openPositions?.length ?? 0} positions)</div>
          </div>
          <div className="rounded-lg bg-slate-900/40 p-2">
            <div className="text-sm font-bold text-emerald-400">${(p?.cashUsd ?? 10000).toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
            <div className="text-[9px] text-slate-500">Available</div>
          </div>
        </div>
      </div>

      {/* TradeVisor Paper Ledger — separate equity & options caps (N/10 each) */}
      {tv && (
        <div className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-3">
          <div className="flex items-center gap-2 mb-2">
            <Target className="h-4 w-4 text-sky-400" />
            <span className="text-xs font-semibold text-sky-300">TradeVisor Paper Ledger</span>
            <span className="ml-auto text-[10px] text-slate-500">
              Cash ${tv.paperCashUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })} · Total ${tv.totalValueUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {/* Equity capacity */}
            <div className="rounded-lg bg-slate-900/40 p-3">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-semibold text-slate-200">Equities</span>
                <span className="text-[10px] text-slate-400">
                  {tv.equityCount}/{tv.maxEquityPositions}
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-slate-700 overflow-hidden">
                <div
                  className="h-full bg-sky-500 transition-all"
                  style={{ width: `${(tv.equityCount / Math.max(tv.maxEquityPositions, 1)) * 100}%` }}
                />
              </div>
              <div className="mt-1.5 text-[10px] text-slate-500">
                Value ${tv.equityValueUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </div>
              {tv.equityPositions.length > 0 && (
                <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                  {tv.equityPositions.slice(0, 6).map(pos => {
                    const pnlUsd = (pos.currentPrice - pos.entryPrice) * pos.shares;
                    const pnlPct = ((pos.currentPrice - pos.entryPrice) / pos.entryPrice) * 100;
                    return (
                      <div key={pos.id} className="flex items-center justify-between rounded bg-slate-800/60 px-2 py-1 text-[10px]">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="font-semibold text-white truncate">{pos.symbol}</span>
                          <span className="text-slate-500">×{pos.shares.toFixed(pos.shares < 1 ? 3 : 0)}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-slate-400">${pos.currentPrice.toFixed(2)}</span>
                          <span className={`font-mono ${pnlUsd >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {pnlUsd >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            {/* Options capacity */}
            <div className="rounded-lg bg-slate-900/40 p-3">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-semibold text-slate-200">Options</span>
                <span className="text-[10px] text-slate-400">
                  {tv.optionCount}/{tv.maxOptionPositions}
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-slate-700 overflow-hidden">
                <div
                  className="h-full bg-amber-500 transition-all"
                  style={{ width: `${(tv.optionCount / Math.max(tv.maxOptionPositions, 1)) * 100}%` }}
                />
              </div>
              <div className="mt-1.5 text-[10px] text-slate-500">
                Value ${tv.optionValueUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </div>
              {tv.optionPositions.length > 0 && (
                <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                  {tv.optionPositions.slice(0, 6).map(pos => {
                    const pnlUsd = (pos.currentMid - pos.entryMid) * pos.contracts * 100;
                    const pnlPct = ((pos.currentMid - pos.entryMid) / pos.entryMid) * 100;
                    return (
                      <div key={pos.id} className="flex items-center justify-between rounded bg-slate-800/60 px-2 py-1 text-[10px]">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="font-semibold text-white truncate">{pos.symbol}</span>
                          <span className={`px-1 rounded text-[9px] ${pos.type === 'call' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                            {pos.type.toUpperCase()}
                          </span>
                          <span className="text-slate-500">${pos.strike} · {pos.expiry}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-slate-400">×{pos.contracts}</span>
                          <span className={`font-mono ${pnlUsd >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {pnlUsd >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Live Activity Panel */}
      <div className={`rounded-xl border px-3 py-3 ${
        s?.running ? 'border-emerald-500/30 bg-emerald-500/8' : 'border-slate-600/30 bg-slate-800/50'
      }`}>
        <div className="flex items-center gap-3 mb-2">
          {s?.running ? (
            <>
              <span className="relative flex h-3 w-3 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
              </span>
              <span className="text-sm font-bold text-emerald-400">Stocks Bot is LIVE</span>
              <span className="text-[10px] text-emerald-400/60">{s.scanCycles} cycles · {s.tradesExecuted} trades</span>
            </>
          ) : (
            <>
              <span className="h-3 w-3 rounded-full bg-slate-600" />
              <span className="text-sm font-bold text-slate-400">Not Running</span>
            </>
          )}
          <span className="ml-auto text-xs text-slate-500">{p?.openPositions?.length ?? 0} open positions</span>
        </div>
        {p && p.openPositions.length > 0 && (
          <div className="space-y-1 max-h-40 overflow-y-auto overflow-x-auto">
            {p.openPositions.slice(0, 8).map((pos, i) => {
              const eng = ENGINE_LABELS[pos.opportunity.engine] ?? { name: pos.opportunity.engine, color: 'text-slate-300', bg: 'bg-slate-600' };
              return (
                <div key={i} className="flex items-center justify-between rounded-lg bg-slate-900/40 px-2 py-1.5 md:px-3 gap-2 min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className={`text-[9px] px-1 py-0.5 rounded font-bold shrink-0 ${eng.bg} ${eng.color}`}>{eng.name}</span>
                    <span className="text-xs font-semibold text-white shrink-0">{pos.opportunity.ticker}</span>
                    <span className="text-[10px] text-slate-500 hidden sm:inline">{pos.opportunity.domain}</span>
                  </div>
                  <div className="flex items-center gap-2 md:gap-3 shrink-0">
                    <span className="text-xs text-slate-400">${pos.size.toFixed(0)}</span>
                    <span className={`text-xs font-mono ${pos.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {pos.pnl >= 0 ? '+' : ''}${pos.pnl.toFixed(2)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5 md:gap-3">
        <StatCard label="Portfolio" value={`$${(p?.totalValue ?? 10000).toLocaleString(undefined, { maximumFractionDigits: 0 })}`} color="text-slate-100" icon={<DollarSign className="h-4 w-4" />} />
        <StatCard label="P&L" value={`${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`} color={pnlColor} icon={pnl >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />} />
        <StatCard label="Trades" value={String(p?.totalTrades ?? 0)} subtitle={`${p?.wins ?? 0}W / ${p?.losses ?? 0}L`} color="text-blue-400" icon={<Target className="h-4 w-4" />} />
        <StatCard label="Engines" value={String(s?.enginesActive ?? 14)} subtitle={`${s?.scanCycles ?? 0} cycles`} color="text-indigo-400" icon={<Zap className="h-4 w-4" />} />
        <StatCard label="Regime" value={(s?.regime ?? 'unknown').replace('_', ' ')} color={REGIME_COLORS[s?.regime ?? ''] ?? 'text-slate-400'} icon={<Shield className="h-4 w-4" />} />
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 rounded-lg bg-slate-800/50 p-1 overflow-x-auto">
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition whitespace-nowrap ${
              activeTab === tab.key ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <div className="space-y-4">
          {/* Engine Performance Grid */}
          <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 overflow-hidden">
            <div className="border-b border-slate-700/30 px-4 py-2.5 flex items-center gap-2">
              <PieChart className="h-4 w-4 text-indigo-400" />
              <h2 className="text-xs font-semibold text-slate-300">Engine Performance</h2>
            </div>
            <div className="grid grid-cols-2 gap-px bg-slate-700/30 md:grid-cols-4 lg:grid-cols-7">
              {Object.entries(ENGINE_LABELS).map(([key, eng]) => {
                const stats = p?.byEngine?.[key];
                return (
                  <div key={key} className="bg-slate-800/80 p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${eng.bg} ${eng.color}`}>{key}</span>
                      <span className="h-2 w-2 rounded-full bg-green-400" />
                    </div>
                    <div className="text-[10px] text-slate-400">{eng.name}</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">
                      {stats ? `${stats.trades}t · $${stats.pnl.toFixed(2)}` : 'No trades'}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Force Scan Results */}
          {scan && scan.topOpps && scan.topOpps.length > 0 && (
            <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 overflow-hidden">
              <div className="border-b border-slate-700/30 px-4 py-2.5 flex items-center gap-2">
                <ArrowUpDown className="h-4 w-4 text-yellow-400" />
                <h2 className="text-xs font-semibold text-slate-300">Latest Scan ({scan.opportunities} opportunities)</h2>
              </div>
              <div className="divide-y divide-slate-700/30 max-h-60 overflow-y-auto">
                {scan.topOpps.slice(0, 10).map((opp, i) => {
                  const eng = ENGINE_LABELS[opp.engine] ?? { name: opp.engine, color: 'text-slate-300', bg: 'bg-slate-600' };
                  return (
                    <div key={i} className="px-3 py-2.5 md:px-4">
                      <div className="flex flex-wrap items-center justify-between gap-1 mb-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${eng.bg} ${eng.color}`}>{opp.engine}</span>
                          <span className="text-xs font-semibold text-white">{opp.ticker}</span>
                          <span className={`text-[10px] px-1 rounded ${opp.action === 'buy' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                            {opp.action.toUpperCase()}
                          </span>
                        </div>
                        <span className="text-xs text-slate-400">{opp.confidence}% conf</span>
                      </div>
                      <p className="text-[11px] text-slate-400 leading-tight">{opp.reasoning.slice(0, 120)}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Positions Tab */}
      {activeTab === 'positions' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 overflow-hidden">
            <div className="border-b border-slate-700/30 px-3 py-2.5 md:px-4">
              <h2 className="text-xs font-semibold text-slate-300">Open Positions ({p?.openPositions?.length ?? 0})</h2>
            </div>
            {p && p.openPositions.length > 0 ? (
              <div className="divide-y divide-slate-700/30 overflow-x-auto">
                {p.openPositions.map((pos, i) => {
                  const eng = ENGINE_LABELS[pos.opportunity.engine] ?? { name: pos.opportunity.engine, color: 'text-slate-300', bg: 'bg-slate-600' };
                  return (
                    <div key={i} className="px-3 py-3 md:px-4 min-w-0">
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between mb-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${eng.bg} ${eng.color}`}>{eng.name}</span>
                          <span className="text-sm font-semibold text-white">{pos.opportunity.ticker}</span>
                          <span className="text-[10px] text-slate-500">{pos.opportunity.domain}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-slate-400">${pos.size.toFixed(0)}</span>
                          <span className={`text-sm font-mono font-bold ${pos.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {pos.pnl >= 0 ? '+' : ''}${pos.pnl.toFixed(2)}
                          </span>
                        </div>
                      </div>
                      <p className="text-[10px] text-slate-500">{pos.opportunity.reasoning.slice(0, 100)}</p>
                      <div className="flex flex-wrap gap-3 mt-1 text-[9px] text-slate-600">
                        <span>Conf: {pos.opportunity.confidence}%</span>
                        <span>Opened: {new Date(pos.openedAt).toLocaleString()}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="p-8 text-center text-slate-500 text-xs">No open positions — engines will trade on next scan</div>
            )}
          </div>
        </div>
      )}

      {/* Engines Tab */}
      {activeTab === 'engines' && (
        <div className="grid gap-3 md:grid-cols-2">
          {Object.entries(ENGINE_LABELS).map(([key, eng]) => {
            const stats = p?.byEngine?.[key];
            const domain = key.startsWith('E') ? 'Equity' : key.startsWith('O') ? 'Options' : key.startsWith('M') ? 'Macro' : 'Cross-Asset';
            return (
              <div key={key} className={`rounded-xl border p-3 ${eng.bg.replace('/20', '/10')} border-slate-700/50`}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-bold ${eng.color}`}>{key}</span>
                    <span className="text-xs font-semibold text-slate-200">{eng.name}</span>
                  </div>
                  <span className="text-[10px] text-slate-500">{domain}</span>
                </div>
                <div className="flex items-center gap-4 text-[10px] text-slate-400">
                  <span>{stats?.trades ?? 0} trades</span>
                  <span className={`font-mono ${(stats?.pnl ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    ${(stats?.pnl ?? 0).toFixed(2)}
                  </span>
                  <span className="h-2 w-2 rounded-full bg-green-400" title="Active" />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Activity Tab */}
      {activeTab === 'activity' && (
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 overflow-hidden">
          <div className="border-b border-slate-700/30 px-4 py-2.5 flex items-center gap-2">
            <Clock className="h-4 w-4 text-slate-400" />
            <h2 className="text-xs font-semibold text-slate-300">Recent Trades</h2>
          </div>
          {p && p.recentTrades.length > 0 ? (
            <div className="divide-y divide-slate-700/30 max-h-96 overflow-y-auto">
              {p.recentTrades.map((t, i) => {
                const eng = ENGINE_LABELS[t.opportunity.engine] ?? { name: t.opportunity.engine, color: 'text-slate-300', bg: 'bg-slate-600' };
                return (
                  <div key={i} className="flex items-center justify-between px-3 py-2 md:px-4 gap-2 min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className={`text-[9px] px-1 py-0.5 rounded font-bold shrink-0 ${
                        t.status === 'closed_win' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                      }`}>{t.status === 'closed_win' ? 'WIN' : 'LOSS'}</span>
                      <span className={`text-[10px] ${eng.color} hidden sm:inline`}>{eng.name}</span>
                      <span className="text-xs text-white">{t.opportunity.ticker}</span>
                    </div>
                    <div className="flex items-center gap-2 md:gap-3 shrink-0">
                      <span className="text-[10px] text-slate-500 hidden sm:inline">{t.closeReason}</span>
                      <span className={`text-xs font-mono ${t.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="p-8 text-center text-slate-500 text-xs">No closed trades yet — positions are still open</div>
          )}
        </div>
      )}
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
