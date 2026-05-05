import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import {
  Trophy, TrendingUp, TrendingDown, Target, Activity,
  DollarSign, Shield, RefreshCw, Clock, Zap,
} from 'lucide-react';

interface SportsPortfolio {
  startingCapital: number;
  cashUsd: number;
  totalValue: number;
  totalPnlUsd: number;
  totalBets: number;
  wins: number;
  losses: number;
  winRate: number;
  rollingClv: number;
  openBetsValue?: number;
  openBets: Array<{
    opportunity: { engine: string; sport: string; homeTeam: string; awayTeam: string; side: string; softBook: string; evPct: number; reasoning: string };
    size: number;
    placedAt: string;
  }>;
  recentBets: Array<{
    opportunity: { engine: string; homeTeam: string; awayTeam: string };
    size: number;
    pnl: number;
    status: string;
    settledAt: string;
  }>;
}

interface SportsStatus {
  running: boolean;
  scanCycles: number;
  opportunitiesFound: number;
  betsPlaced: number;
  enginesActive: number;
}

export function SportsPage() {
  const { data: pData } = useQuery({ queryKey: ['sports-portfolio'], queryFn: () => apiClient.get<{ data: SportsPortfolio }>('/sports/portfolio'), refetchInterval: 10_000 });
  const { data: sData } = useQuery({ queryKey: ['sports-status'], queryFn: () => apiClient.get<{ data: SportsStatus }>('/sports/status'), refetchInterval: 10_000 });
  const { data: scanData, refetch: forceScan, isFetching: scanning } = useQuery({ queryKey: ['sports-scan'], queryFn: () => apiClient.get<{ data: { opportunities: number; topOpps: Array<{ engine: string; sport: string; homeTeam: string; awayTeam: string; side: string; evPct: number; softBook: string; reasoning: string }> } }>('/sports/scan'), enabled: false });

  const p = (pData as { data: SportsPortfolio } | undefined)?.data;
  const s = (sData as { data: SportsStatus } | undefined)?.data;
  const scan = (scanData as { data: { opportunities: number; topOpps: Array<{ engine: string; sport: string; homeTeam: string; awayTeam: string; side: string; evPct: number; softBook: string; reasoning: string }> } } | undefined)?.data;

  const pnl = p?.totalPnlUsd ?? 0;

  return (
    <div className="space-y-4 p-3 md:space-y-6 md:p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Trophy className="h-6 w-6 text-emerald-400" />
          <div>
            <h1 className="text-lg md:text-2xl font-bold text-slate-100">Sports Intelligence</h1>
            <p className="text-[10px] md:text-xs text-slate-500">6 Engines — +EV, Cross-Venue, Live, Props, SGP, Kalshi</p>
          </div>
        </div>
        <button onClick={() => forceScan()} disabled={scanning} className="flex items-center gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-lg transition disabled:opacity-50">
          <RefreshCw className={`h-3 w-3 ${scanning ? 'animate-spin' : ''}`} /> Scan
        </button>
      </div>

      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3">
        <div className="flex items-center gap-3">
          <Shield className="h-5 w-5 text-emerald-400 shrink-0" />
          <div className="flex-1">
            <p className="text-xs font-medium text-emerald-300">Paper Trading — Sports Betting</p>
            <p className="text-[10px] text-emerald-400/70">6 engines scanning The Odds API for +EV opportunities</p>
          </div>
          <div className={`text-lg font-bold ${pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}</div>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg bg-slate-900/40 p-2">
            <div className="text-sm font-bold text-white">${(p?.totalValue ?? 1000).toFixed(0)}</div>
            <div className="text-[9px] text-slate-500">Total Balance</div>
          </div>
          <div className="rounded-lg bg-slate-900/40 p-2">
            <div className="text-sm font-bold text-amber-400">${(p?.openBetsValue ?? 0).toFixed(0)}</div>
            <div className="text-[9px] text-slate-500">At Risk ({p?.openBets?.length ?? 0} bets)</div>
          </div>
          <div className="rounded-lg bg-slate-900/40 p-2">
            <div className="text-sm font-bold text-emerald-400">${(p?.cashUsd ?? 1000).toFixed(0)}</div>
            <div className="text-[9px] text-slate-500">Available</div>
          </div>
        </div>
      </div>

      {/* Live Status */}
      <div className={`rounded-xl border px-3 py-3 ${s?.running ? 'border-emerald-500/30 bg-emerald-500/8' : 'border-slate-600/30 bg-slate-800/50'}`}>
        <div className="flex items-center gap-3 mb-2">
          {s?.running ? (<><span className="relative flex h-3 w-3"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" /><span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" /></span><span className="text-sm font-bold text-emerald-400">Sports Bot is LIVE</span><span className="text-[10px] text-emerald-400/60">{s.scanCycles} cycles · {s.betsPlaced} bets</span></>) : (<><span className="h-3 w-3 rounded-full bg-slate-600" /><span className="text-sm font-bold text-slate-400">Not Running</span></>)}
          <span className="ml-auto text-xs text-slate-500">{p?.openBets?.length ?? 0} open bets</span>
        </div>
        {p && p.openBets.length > 0 && (
          <div className="space-y-1 max-h-96 overflow-y-auto">
            {p.openBets.map((bet, i) => (
              <div key={i} className="rounded-lg bg-slate-900/40 px-3 py-2">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] px-1.5 py-0.5 rounded font-bold bg-emerald-500/20 text-emerald-400">{bet.opportunity.engine}</span>
                    <span className="text-xs font-semibold text-white">{bet.opportunity.homeTeam} vs {bet.opportunity.awayTeam}</span>
                  </div>
                  <span className="text-xs font-bold text-emerald-400">+{(bet.opportunity.evPct * 100).toFixed(1)}% EV</span>
                </div>
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-slate-400">{bet.opportunity.side} on {bet.opportunity.softBook} · {bet.opportunity.sport}</span>
                  <span className="text-slate-300 font-mono">${bet.size}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5 md:gap-3">
        <StatCard label="Portfolio" value={`$${(p?.totalValue ?? 1000).toFixed(0)}`} color="text-slate-100" icon={<DollarSign className="h-4 w-4" />} />
        <StatCard label="P&L" value={`${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`} color={pnl >= 0 ? 'text-emerald-400' : 'text-red-400'} icon={pnl >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />} />
        <StatCard label="Bets" value={String(p?.totalBets ?? 0)} subtitle={`${p?.wins ?? 0}W / ${p?.losses ?? 0}L`} color="text-blue-400" icon={<Target className="h-4 w-4" />} />
        <StatCard label="Engines" value={String(s?.enginesActive ?? 6)} subtitle={`${s?.scanCycles ?? 0} scans`} color="text-emerald-400" icon={<Zap className="h-4 w-4" />} />
        <StatCard label="CLV" value={(p?.rollingClv ?? 0).toFixed(3)} color={(p?.rollingClv ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'} icon={<Activity className="h-4 w-4" />} />
      </div>

      {/* Scan Results */}
      {scan && scan.topOpps && scan.topOpps.length > 0 && (
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 overflow-hidden">
          <div className="border-b border-slate-700/30 px-4 py-2.5"><h2 className="text-xs font-semibold text-slate-300">Latest Scan ({scan.opportunities} opportunities)</h2></div>
          <div className="divide-y divide-slate-700/30 max-h-60 overflow-y-auto">
            {scan.topOpps.slice(0, 10).map((opp, i) => (
              <div key={i} className="px-4 py-2.5">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-emerald-500/20 text-emerald-400">{opp.engine}</span>
                    <span className="text-xs text-white">{opp.homeTeam} vs {opp.awayTeam}</span>
                  </div>
                  <span className="text-xs text-emerald-400">+{(opp.evPct * 100).toFixed(1)}% EV</span>
                </div>
                <p className="text-[10px] text-slate-400">{opp.reasoning.slice(0, 100)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Bets */}
      {p && p.recentBets.length > 0 && (
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 overflow-hidden">
          <div className="border-b border-slate-700/30 px-4 py-2.5 flex items-center gap-2"><Clock className="h-4 w-4 text-slate-400" /><h2 className="text-xs font-semibold text-slate-300">Recent Bets</h2></div>
          <div className="divide-y divide-slate-700/30">
            {p.recentBets.map((b, i) => (
              <div key={i} className="flex items-center justify-between px-4 py-2">
                <div className="flex items-center gap-2">
                  <span className={`text-[9px] px-1 py-0.5 rounded font-bold ${b.status === 'won' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>{b.status === 'won' ? 'WIN' : 'LOSS'}</span>
                  <span className="text-xs text-white">{b.opportunity.homeTeam} vs {b.opportunity.awayTeam}</span>
                </div>
                <span className={`text-xs font-mono ${b.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{b.pnl >= 0 ? '+' : ''}${b.pnl.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, subtitle, color, icon }: { label: string; value: string; subtitle?: string; color: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-3">
      <div className="flex items-center justify-between mb-1"><span className="text-[10px] text-slate-500">{label}</span><span className={color}>{icon}</span></div>
      <p className={`text-sm font-bold font-mono ${color}`}>{value}</p>
      {subtitle && <p className="text-[10px] text-slate-500 mt-0.5">{subtitle}</p>}
    </div>
  );
}
