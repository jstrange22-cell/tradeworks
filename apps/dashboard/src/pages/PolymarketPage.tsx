import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import {
  TrendingUp, Activity, Shield, CloudSun, Zap,
  Rocket, DollarSign, RefreshCw,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────

interface CategoryScore {
  category: string;
  score: number;
  status: 'GOOD' | 'WEAK' | 'BLOCKED';
  winRate: number;
  trades: number;
}

interface KalshiSignal {
  engine: string;
  market: string;
  title: string;
  category: string;
  side: string;
  confidence: number;
  edge: number;
  reasoning: string;
  timestamp: string;
}

interface WeatherForecast {
  city: string;
  date: string;
  threshold: number;
  membersAbove: number;
  totalMembers: number;
  probability: number;
  confidence: number;
}

interface IntelResponse {
  data: {
    signals: KalshiSignal[];
    weatherForecasts: WeatherForecast[];
    categoryScores: CategoryScore[];
    timestamp: string;
  };
}

type KalshiTab = 'markets' | 'intelligence' | 'weather' | 'categories' | 'signals';

const TABS: ReadonlyArray<{ key: KalshiTab; label: string; icon: React.ReactNode }> = [
  { key: 'markets', label: 'Live Markets', icon: <TrendingUp className="h-3.5 w-3.5" /> },
  { key: 'intelligence', label: 'Intelligence', icon: <Activity className="h-3.5 w-3.5" /> },
  { key: 'weather', label: 'Weather', icon: <CloudSun className="h-3.5 w-3.5" /> },
  { key: 'categories', label: 'Categories', icon: <Shield className="h-3.5 w-3.5" /> },
  { key: 'signals', label: 'Crypto 15m', icon: <Zap className="h-3.5 w-3.5" /> },
];

const statusColors: Record<string, string> = {
  GOOD: 'bg-emerald-500/20 text-emerald-400',
  WEAK: 'bg-amber-500/20 text-amber-400',
  BLOCKED: 'bg-red-500/20 text-red-400',
};

// ── Paper Portfolio ──────────────────────────────────────────────────────

const PAPER_CAPITAL = 1000;

// ── Component ────────────────────────────────────────────────────────────

export function PolymarketPage() {
  const [activeTab, setActiveTab] = useState<KalshiTab>('markets');

  const { data: intelData, refetch, isFetching } = useQuery<IntelResponse>({
    queryKey: ['kalshi-intel'],
    queryFn: () => apiClient.get('/polymarket/intelligence'),
    refetchInterval: 300_000,
  });

  const { data: eventsData } = useQuery<{ data: Array<{ event_ticker: string; title: string; category: string; sub_title: string }> }>({
    queryKey: ['kalshi-events'],
    queryFn: () => apiClient.get('/polymarket/kalshi/events?limit=20'),
    refetchInterval: 60_000,
  });

  const { data: paperData } = useQuery<{ data: { cashUsd: number; totalValue: number; totalPnlUsd: number; trades: number; wins: number; winRate: number; positionsValue?: number; openPositions: Array<Record<string, unknown>>; recentTrades?: Array<Record<string, unknown>> } }>({
    queryKey: ['kalshi-paper'],
    queryFn: () => apiClient.get('/polymarket/kalshi/paper'),
    refetchInterval: 30_000,
  });

  const scanMutation = useMutation({
    mutationFn: () => apiClient.get('/polymarket/intelligence'),
    onSuccess: () => refetch(),
  });

  const intel = intelData?.data;
  const signals = intel?.signals ?? [];
  const weather = intel?.weatherForecasts ?? [];
  const categories = intel?.categoryScores ?? [];
  const goodCats = categories.filter(c => c.status === 'GOOD').length;
  const blockedCats = categories.filter(c => c.status === 'BLOCKED').length;
  const events = eventsData?.data ?? [];
  const paper = paperData?.data;

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <TrendingUp className="h-7 w-7 text-purple-400" />
          <h1 className="text-2xl font-bold text-slate-100">Kalshi Predictions</h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-lg border border-purple-500/30 bg-purple-500/10 px-3 py-1.5 text-xs font-medium text-purple-400">
            <DollarSign className="h-3.5 w-3.5" />
            CFTC Regulated (US Legal)
          </div>
          <button
            onClick={() => scanMutation.mutate()}
            disabled={isFetching}
            className="flex items-center gap-1.5 rounded-lg bg-purple-600/20 px-3 py-1.5 text-sm text-purple-400 hover:bg-purple-600/30"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} /> Scan Markets
          </button>
        </div>
      </div>

      {/* Paper Trading Banner with Balance Breakdown */}
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
        <div className="flex items-center gap-3">
          <Rocket className="h-5 w-5 text-amber-400 shrink-0" />
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-amber-300">PAPER TRADING</span>
              <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[9px] font-bold text-amber-400">KALSHI</span>
            </div>
            <span className="text-[10px] text-amber-400/70">5 engines · {paper?.trades ?? 0} trades · {events.length} markets</span>
          </div>
          <div className={`text-lg font-bold ${(paper?.totalPnlUsd ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {(paper?.totalPnlUsd ?? 0) >= 0 ? '+' : ''}${(paper?.totalPnlUsd ?? 0).toFixed(2)}
          </div>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg bg-slate-900/40 p-2">
            <div className="text-sm font-bold text-white">${(paper?.totalValue ?? PAPER_CAPITAL).toFixed(0)}</div>
            <div className="text-[9px] text-slate-500">Total Balance</div>
          </div>
          <div className="rounded-lg bg-slate-900/40 p-2">
            <div className="text-sm font-bold text-amber-400">${(paper?.positionsValue ?? 0).toFixed(0)}</div>
            <div className="text-[9px] text-slate-500">At Risk ({paper?.openPositions?.length ?? 0} pos)</div>
          </div>
          <div className="rounded-lg bg-slate-900/40 p-2">
            <div className="text-sm font-bold text-emerald-400">${(paper?.cashUsd ?? PAPER_CAPITAL).toFixed(0)}</div>
            <div className="text-[9px] text-slate-500">Available</div>
          </div>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-4">
          <div className="flex items-center gap-2 text-slate-400">
            <Activity className="h-4 w-4 text-purple-400" />
            <span className="text-[10px] uppercase tracking-wider">Engines</span>
          </div>
          <div className="mt-1 text-lg font-bold text-white">5 Active</div>
          <div className="text-xs text-slate-500">Arb, Crypto, AI, Weather, Sniper</div>
        </div>
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-4">
          <div className="flex items-center gap-2 text-slate-400">
            <DollarSign className="h-4 w-4 text-emerald-400" />
            <span className="text-[10px] uppercase tracking-wider">Paper Balance</span>
          </div>
          <div className="mt-1 text-lg font-bold text-white">${PAPER_CAPITAL.toLocaleString()}</div>
          <div className="text-xs text-slate-500">Started: $1,000</div>
        </div>
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-4">
          <div className="flex items-center gap-2 text-slate-400">
            <Shield className="h-4 w-4 text-amber-400" />
            <span className="text-[10px] uppercase tracking-wider">Categories</span>
          </div>
          <div className="mt-1 text-lg font-bold text-white">{goodCats} Active</div>
          <div className="text-xs text-slate-500">{blockedCats} blocked (CPI, Fed, Macro)</div>
        </div>
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-4">
          <div className="flex items-center gap-2 text-slate-400">
            <CloudSun className="h-4 w-4 text-blue-400" />
            <span className="text-[10px] uppercase tracking-wider">Weather</span>
          </div>
          <div className="mt-1 text-lg font-bold text-white">{weather.length} Forecasts</div>
          <div className="text-xs text-slate-500">GFS 31-member ensemble</div>
        </div>
      </div>

      {/* Live Activity Panel */}
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/8 px-3 py-3">
        <div className="flex items-center gap-3 mb-2">
          <span className="relative flex h-3 w-3 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
          </span>
          <span className="text-sm font-bold text-emerald-400">Kalshi Bot is LIVE</span>
          <span className="text-[10px] text-emerald-400/60">{paper?.trades ?? 0} trades</span>
          <span className="ml-auto text-xs text-slate-500">{paper?.openPositions?.length ?? 0} open positions</span>
        </div>
        {paper && (paper.openPositions?.length ?? 0) > 0 && (
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {paper.openPositions.map((p: Record<string, unknown>, i: number) => (
              <div key={i} className="flex items-center justify-between rounded-lg bg-slate-900/40 px-3 py-1.5">
                <div className="flex items-center gap-2">
                  <span className={`text-[9px] px-1 rounded font-bold ${(p.side as string) === 'yes' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                    {(p.side as string)?.toUpperCase()}
                  </span>
                  <span className="text-xs text-white truncate max-w-[200px]">{p.title as string}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-400">×{p.qty as number}</span>
                  <span className={`text-xs font-mono ${((p.pnlPct as number) ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {((p.pnlPct as number) ?? 0) >= 0 ? '+' : ''}{((p.pnlPct as number) ?? 0).toFixed(1)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
        {paper && (paper.recentTrades?.length ?? 0) > 0 && (
          <div className="mt-2 border-t border-slate-700/30 pt-2">
            <div className="text-[10px] text-slate-500 mb-1">Latest Activity</div>
            <div className="space-y-0.5 max-h-20 overflow-y-auto">
              {paper.recentTrades!.slice(-5).reverse().map((t: Record<string, unknown>, i: number) => (
                <div key={i} className="flex items-center justify-between text-[11px]">
                  <div className="flex items-center gap-2">
                    <span className={`px-1 py-0.5 rounded text-[9px] font-bold ${
                      (t.action as string) === 'buy' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-purple-500/20 text-purple-400'
                    }`}>{(t.action as string)?.toUpperCase()}</span>
                    <span className="text-slate-300 truncate max-w-[180px]">{t.ticker as string}</span>
                    <span className="text-[9px] text-slate-500">{(t.side as string)?.toUpperCase()}</span>
                  </div>
                  <span className="text-slate-600 text-[9px]">
                    {new Date(t.timestamp as string).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 rounded-lg bg-slate-800/50 p-1">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${
              activeTab === tab.key
                ? 'bg-purple-600 text-white'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700'
            }`}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* Live Markets Tab */}
      {activeTab === 'markets' && (
        <div className="space-y-1">
          {events.length > 0 ? events.map((evt) => (
            <div key={evt.event_ticker} className="flex items-center justify-between rounded-lg bg-slate-800/50 px-4 py-3 hover:bg-slate-800">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-purple-500/20 px-1.5 py-0.5 text-[9px] font-bold text-purple-400">{evt.category}</span>
                  <span className="text-sm font-semibold text-white">{evt.title}</span>
                </div>
                <div className="mt-0.5 text-xs text-slate-500">{evt.sub_title} · {evt.event_ticker}</div>
              </div>
              <div className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-400">
                LIVE
              </div>
            </div>
          )) : (
            <div className="rounded-lg bg-slate-800/50 p-8 text-center text-slate-500">
              Loading Kalshi markets...
            </div>
          )}
        </div>
      )}

      {/* Intelligence Tab */}
      {activeTab === 'intelligence' && (
        <div className="space-y-4">
          {signals.length > 0 ? signals.map((sig, i) => (
            <div key={i} className="rounded-lg border border-slate-700/50 bg-slate-800/50 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                    sig.side === 'yes' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                  }`}>{sig.side.toUpperCase()}</span>
                  <span className="text-sm font-semibold text-white">{sig.market}</span>
                  <span className="rounded bg-slate-700/50 px-1.5 py-0.5 text-[9px] text-slate-400">{sig.engine}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-white">{sig.confidence}%</span>
                  <span className={`text-xs ${sig.edge > 3 ? 'text-emerald-400' : 'text-slate-400'}`}>
                    +{sig.edge.toFixed(1)}% edge
                  </span>
                </div>
              </div>
              <p className="mt-2 text-xs text-slate-400">{sig.title}</p>
              <p className="mt-1 text-xs text-slate-500">{sig.reasoning}</p>
            </div>
          )) : (
            <div className="rounded-lg bg-slate-800/50 p-8 text-center text-slate-500">
              <Activity className="mx-auto h-8 w-8 mb-2 opacity-50" />
              <p>No active signals — engines scan every 5 minutes</p>
              <p className="text-xs mt-1">Crypto momentum needs {'>'} 2% 24h change to generate signals</p>
            </div>
          )}
        </div>
      )}

      {/* Weather Tab */}
      {activeTab === 'weather' && (
        <div className="space-y-1">
          {weather.length > 0 ? weather.map((w, i) => (
            <div key={i} className="flex items-center justify-between rounded-lg bg-slate-800/50 px-4 py-2.5">
              <div>
                <span className="text-sm font-semibold text-white">{w.city}</span>
                <span className="ml-2 text-xs text-slate-500">{w.date} {'>'}{w.threshold}°F</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <div className="text-sm font-medium text-white">{(w.probability * 100).toFixed(0)}%</div>
                  <div className="text-[10px] text-slate-500">{w.membersAbove}/{w.totalMembers} models</div>
                </div>
                <div className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  w.confidence > 60 ? 'bg-emerald-500/15 text-emerald-400' :
                  w.confidence > 30 ? 'bg-amber-500/15 text-amber-400' :
                  'bg-slate-600/15 text-slate-400'
                }`}>
                  {w.confidence}% conf
                </div>
              </div>
            </div>
          )) : (
            <div className="rounded-lg bg-slate-800/50 p-8 text-center text-slate-500">
              <CloudSun className="mx-auto h-8 w-8 mb-2 opacity-50" />
              <p>Loading GFS ensemble weather forecasts...</p>
              <p className="text-xs mt-1">5 cities: NY, Chicago, LA, Miami, Denver</p>
            </div>
          )}
        </div>
      )}

      {/* Categories Tab */}
      {activeTab === 'categories' && (
        <div className="space-y-1">
          {categories.map((cat) => (
            <div key={cat.category} className="flex items-center justify-between rounded-lg bg-slate-800/50 px-4 py-3">
              <div className="flex items-center gap-3">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${statusColors[cat.status]}`}>
                  {cat.status}
                </span>
                <span className="text-sm font-semibold text-white">{cat.category}</span>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <div className="text-sm font-medium text-white">Score: {cat.score}</div>
                  <div className="text-[10px] text-slate-500">{cat.trades} trades | {cat.winRate.toFixed(0)}% WR</div>
                </div>
                <div className="w-24 rounded-full bg-slate-700/50 h-2">
                  <div
                    className={`h-2 rounded-full ${
                      cat.status === 'GOOD' ? 'bg-emerald-500' :
                      cat.status === 'WEAK' ? 'bg-amber-500' :
                      'bg-red-500'
                    }`}
                    style={{ width: `${cat.score}%` }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Crypto 15m Signals Tab */}
      {activeTab === 'signals' && (
        <div className="space-y-4">
          {signals.filter(s => s.engine === 'crypto_sniper').length > 0 ? (
            signals.filter(s => s.engine === 'crypto_sniper').map((sig, i) => (
              <div key={i} className="rounded-lg border border-slate-700/50 bg-slate-800/50 p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Zap className="h-4 w-4 text-orange-400" />
                    <span className="text-sm font-semibold text-white">{sig.market}</span>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                      sig.side === 'yes' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                    }`}>{sig.side.toUpperCase()}</span>
                  </div>
                  <span className="text-sm font-bold text-white">{sig.confidence}% confidence</span>
                </div>
                <p className="mt-2 text-xs text-slate-400">{sig.reasoning}</p>
              </div>
            ))
          ) : (
            <div className="rounded-lg bg-slate-800/50 p-8 text-center text-slate-500">
              <Zap className="mx-auto h-8 w-8 mb-2 opacity-50" />
              <p>No crypto 15-min signals</p>
              <p className="text-xs mt-1">Signals fire when BTC/ETH/SOL momentum exceeds 2% (24h change)</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
