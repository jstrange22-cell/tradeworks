import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { useWallet } from '@solana/wallet-adapter-react';
import { useAccount as useEVMAccount } from 'wagmi';
import { apiClient } from '@/lib/api-client';
import {
  Play, Square, TrendingUp, Coins, Activity,
  Wallet, Zap, Radio, Shield, RefreshCw, AlertTriangle,
  Rocket, DollarSign, Eye,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────

interface PriceData {
  symbol: string;
  price: number;
  change24h: number;
  volume24h: number;
}

interface CryptoStatus {
  data: {
    running: boolean;
    paperMode: boolean;
    startedAt: string | null;
    coinbaseConnected: boolean;
    universe: number;
    totalCycles: number;
    lastCycleAt: string | null;
    circuitBreaker: { tripped: boolean; reason: string | null };
    paperCapital: number;
    paperCashUsd: number;
    paperPositionsValue: number;
    paperTotalValue: number;
    paperPnlUsd: number;
    paperTrades: number;
    paperWins: number;
    paperLosses: number;
    paperWinRate: number;
    regime: string;
    regimeMultiplier: number;
    tradingViewSignals: Array<{ symbol: string; action: string; price: number; receivedAt: string }>;
    tradingViewConnected: boolean;
  };
}

interface PaperReport {
  data: {
    startingCapital: number;
    cashUsd: number;
    positionsValue: number;
    totalValue: number;
    totalPnlUsd: number;
    totalPnlPct: number;
    trades: number;
    wins: number;
    losses: number;
    winRate: number;
    openPositions: Array<{ symbol: string; qty: number; avgEntry: number; currentPrice: number; value: number; pnlUsd: number; pnlPct: number }>;
    recentTrades: Array<{ symbol: string; side: string; qty: number; price: number; pnlUsd: number; timestamp: string }>;
    regime: string;
    regimeMultiplier: number;
    derivedPnlMatch: boolean;
  };
}

type CryptoTab = 'markets' | 'portfolio' | 'signals' | 'tradingview';

const TABS: ReadonlyArray<{ key: CryptoTab; label: string; icon: React.ReactNode }> = [
  { key: 'markets', label: 'Markets', icon: <TrendingUp className="h-3.5 w-3.5" /> },
  { key: 'portfolio', label: 'Portfolio', icon: <Wallet className="h-3.5 w-3.5" /> },
  { key: 'signals', label: 'Signals', icon: <Activity className="h-3.5 w-3.5" /> },
  { key: 'tradingview', label: 'TradingView', icon: <Eye className="h-3.5 w-3.5" /> },
];

const regimeColors: Record<string, string> = {
  risk_on: 'text-emerald-400',
  risk_off: 'text-red-400',
  transitioning: 'text-amber-400',
  crisis: 'text-red-500',
};

// ── Component ────────────────────────────────────────────────────────────

export function CryptoPage() {
  const [activeTab, setActiveTab] = useState<CryptoTab>('markets');
  const queryClient = useQueryClient();

  const { data: status } = useQuery<CryptoStatus>({
    queryKey: ['crypto-status'],
    queryFn: () => apiClient.get('/crypto/status'),
    refetchInterval: 10_000,
  });

  const { data: pricesData } = useQuery<{ data: PriceData[] }>({
    queryKey: ['crypto-prices'],
    queryFn: () => apiClient.get('/crypto/prices'),
    refetchInterval: 60_000,
  });

  const { data: paperData } = useQuery<PaperReport>({
    queryKey: ['crypto-paper'],
    queryFn: () => apiClient.get('/crypto/paper'),
    refetchInterval: 30_000,
  });

  useQuery<{ data: Record<string, unknown> }>({
    queryKey: ['crypto-signals'],
    queryFn: () => apiClient.get('/crypto/signals'),
    refetchInterval: 60_000,
  });

  const startMutation = useMutation({
    mutationFn: () => apiClient.post('/crypto/start', {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['crypto-status'] }),
  });

  const stopMutation = useMutation({
    mutationFn: () => apiClient.post('/crypto/stop', {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['crypto-status'] }),
  });

  const s = status?.data;
  const paper = paperData?.data;
  void pricesData;

  return (
    <div className="space-y-4 p-3 md:space-y-6 md:p-6">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Coins className="h-6 w-6 md:h-7 md:w-7 text-blue-400" />
          <h1 className="text-lg md:text-2xl font-bold text-slate-100">Crypto Agent</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium ${
            s?.coinbaseConnected
              ? 'border-green-500/30 bg-green-500/10 text-green-400'
              : 'border-slate-600 bg-slate-800 text-slate-500'
          }`}>
            <DollarSign className="h-3.5 w-3.5" />
            Coinbase: {s?.coinbaseConnected ? 'Connected' : 'Not connected'}
          </div>
          {s?.running ? (
            <button
              onClick={() => stopMutation.mutate()}
              disabled={stopMutation.isPending}
              className="flex items-center gap-1.5 rounded-lg bg-red-600/20 px-3 py-1.5 text-sm text-red-400 hover:bg-red-600/30"
            >
              <Square className="h-3.5 w-3.5" /> Stop
            </button>
          ) : (
            <button
              onClick={() => startMutation.mutate()}
              disabled={startMutation.isPending}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-600/20 px-3 py-1.5 text-sm text-emerald-400 hover:bg-emerald-600/30"
            >
              <Play className="h-3.5 w-3.5" /> Start
            </button>
          )}
        </div>
      </div>

      {/* Multi-Chain Wallet Connect */}
      <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Wallet className="h-4 w-4 text-blue-400" />
            <span className="text-xs font-semibold text-slate-300">Connected Wallets</span>
          </div>
          <div className="flex items-center gap-2">
            <WalletMultiButton className="!bg-purple-600 !rounded-lg !h-7 !text-[10px] !px-3" />
            {/* @ts-expect-error Web3Modal custom element */}
            <w3m-button size="sm" />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-1 md:grid-cols-3">
          <div className="rounded bg-slate-900/40 p-2">
            <div className="text-[9px] text-slate-500 mb-1">Solana (Phantom/Solflare)</div>
            <WalletDisplay />
          </div>
          <div className="rounded bg-slate-900/40 p-2">
            <div className="text-[9px] text-slate-500 mb-1">EVM (SafePal/MetaMask)</div>
            <EVMWalletDisplay />
          </div>
          <div className="rounded bg-slate-900/40 p-2">
            <div className="text-[9px] text-slate-500 mb-1">Coinbase (API Keys)</div>
            <div className="flex items-center gap-1">
              <span className={`h-2 w-2 rounded-full ${s?.coinbaseConnected ? 'bg-green-400' : 'bg-slate-600'}`} />
              <span className={`text-[10px] ${s?.coinbaseConnected ? 'text-green-400' : 'text-slate-500'}`}>
                {s?.coinbaseConnected ? 'Connected' : 'Setup in Settings'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Circuit Breaker Alert */}
      {s?.circuitBreaker?.tripped && (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Circuit breaker tripped: {s.circuitBreaker.reason ?? 'Unknown'}
        </div>
      )}

      {/* Paper Mode Banner with Balance Breakdown */}
      {s?.paperMode && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
          <div className="flex items-center gap-3">
            <Rocket className="h-5 w-5 text-amber-400 shrink-0" />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-amber-300">PAPER TRADING</span>
                <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[9px] font-bold text-amber-400">CRYPTO AGENT</span>
              </div>
              <span className="text-[10px] text-amber-400/70">Signal-driven · Tradevisor TA · {s.paperTrades ?? 0} trades · {s.paperWinRate ?? 0}% WR</span>
            </div>
            <div className={`text-lg font-bold ${(s.paperPnlUsd ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {(s.paperPnlUsd ?? 0) >= 0 ? '+' : ''}${(s.paperPnlUsd ?? 0).toFixed(2)}
            </div>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-slate-900/40 p-2">
              <div className="text-sm font-bold text-white">${(s.paperTotalValue ?? 1000).toFixed(0)}</div>
              <div className="text-[9px] text-slate-500">Total Balance</div>
            </div>
            <div className="rounded-lg bg-slate-900/40 p-2">
              <div className="text-sm font-bold text-amber-400">${((s.paperPositionsValue ?? 0)).toFixed(0)}</div>
              <div className="text-[9px] text-slate-500">At Risk</div>
            </div>
            <div className="rounded-lg bg-slate-900/40 p-2">
              <div className="text-sm font-bold text-emerald-400">${(s.paperCashUsd ?? 1000).toFixed(0)}</div>
              <div className="text-[9px] text-slate-500">Available</div>
            </div>
          </div>
        </div>
      )}

      {/* Stats Row */}
      <div className="grid grid-cols-2 gap-2 md:gap-4 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-3 md:p-4">
          <div className="flex items-center gap-2 text-slate-400">
            <Zap className="h-4 w-4 text-blue-400" />
            <span className="text-[10px] uppercase tracking-wider">Status</span>
          </div>
          <div className={`mt-1 text-lg font-bold ${s?.running ? 'text-emerald-400' : 'text-slate-400'}`}>
            {s?.running ? 'Running' : 'Stopped'}
          </div>
          <div className="text-xs text-slate-500">{s?.totalCycles ?? 0} cycles completed</div>
        </div>
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-3 md:p-4">
          <div className="flex items-center gap-2 text-slate-400">
            <DollarSign className="h-4 w-4 text-emerald-400" />
            <span className="text-[10px] uppercase tracking-wider">Paper Balance</span>
          </div>
          <div className="mt-1 text-base font-bold md:text-lg text-white">${(s?.paperTotalValue ?? 1000).toLocaleString('en-US', { maximumFractionDigits: 2 })}</div>
          <div className="text-xs text-slate-500">Started: ${s?.paperCapital ?? 1000}</div>
        </div>
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-3 md:p-4">
          <div className="flex items-center gap-2 text-slate-400">
            <Radio className="h-4 w-4 text-purple-400" />
            <span className="text-[10px] uppercase tracking-wider">TradingView</span>
          </div>
          <div className={`mt-1 text-lg font-bold ${s?.tradingViewConnected ? 'text-emerald-400' : 'text-slate-400'}`}>
            {s?.tradingViewConnected ? 'Connected' : 'Waiting'}
          </div>
          <div className="text-xs text-slate-500">{(s?.tradingViewSignals ?? []).length} signals received</div>
        </div>
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-3 md:p-4">
          <div className="flex items-center gap-2 text-slate-400">
            <Shield className="h-4 w-4 text-amber-400" />
            <span className="text-[10px] uppercase tracking-wider">Regime</span>
          </div>
          <div className={`mt-1 text-lg font-bold capitalize ${regimeColors[s?.regime ?? ''] ?? 'text-slate-400'}`}>
            {(s?.regime ?? 'unknown').replace('_', ' ')}
          </div>
          <div className="text-xs text-slate-500">Size: {((s?.regimeMultiplier ?? 1) * 100).toFixed(0)}%</div>
        </div>
      </div>

      {/* Live Activity Panel */}
      <div className={`rounded-xl border px-3 py-3 md:px-4 ${
        s?.running ? 'border-emerald-500/30 bg-emerald-500/8' : 'border-slate-600/30 bg-slate-800/50'
      }`}>
        <div className="flex items-center gap-3 mb-2">
          {s?.running ? (
            <>
              <span className="relative flex h-3 w-3 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
              </span>
              <span className="text-sm font-bold text-emerald-400">Bot is LIVE</span>
              <span className="text-[10px] text-emerald-400/60">{s.totalCycles} cycles · {s.paperTrades} trades</span>
            </>
          ) : (
            <>
              <span className="h-3 w-3 rounded-full bg-slate-600" />
              <span className="text-sm font-bold text-slate-400">Bot Stopped</span>
            </>
          )}
          <span className="ml-auto text-xs text-slate-500">{paper?.openPositions?.length ?? 0} open positions</span>
        </div>
        {paper && paper.openPositions.length > 0 && (
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {paper.openPositions.filter((p: Record<string, unknown>) => (p.qty as number) > 0 && (p.value as number) > 0.5).map((p: Record<string, unknown>, i: number) => (
              <div key={i} className="flex items-center justify-between rounded-lg bg-slate-900/40 px-3 py-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-white">{p.symbol as string}</span>
                  <span className="text-[10px] text-slate-500">{(p.qty as number).toFixed(4)}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-400">${((p.value as number) ?? 0).toFixed(2)}</span>
                  <span className={`text-xs font-mono ${((p.pnlPct as number) ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {((p.pnlPct as number) ?? 0) >= 0 ? '+' : ''}{((p.pnlPct as number) ?? 0).toFixed(2)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
        {paper && paper.recentTrades.length > 0 && (
          <div className="mt-2 border-t border-slate-700/30 pt-2">
            <div className="text-[10px] text-slate-500 mb-1">Latest Activity</div>
            <div className="space-y-0.5 max-h-24 overflow-y-auto">
              {paper.recentTrades.slice(-5).reverse().map((t: Record<string, unknown>, i: number) => (
                <div key={i} className="flex items-center justify-between text-[11px]">
                  <div className="flex items-center gap-2">
                    <span className={`px-1 py-0.5 rounded text-[9px] font-bold ${
                      (t.side as string) === 'buy' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                    }`}>{(t.side as string).toUpperCase()}</span>
                    <span className="text-slate-300">{t.symbol as string}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {(t.side as string) === 'sell' ? (
                      <span className={`font-mono ${((t.pnlUsd as number) ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {((t.pnlUsd as number) ?? 0) >= 0 ? '+' : ''}${((t.pnlUsd as number) ?? 0).toFixed(2)}
                      </span>
                    ) : (
                      <span className="text-slate-500">-${((t.qty as number) * (t.price as number)).toFixed(2)}</span>
                    )}
                    <span className="text-slate-600 text-[9px]">
                      {new Date(t.timestamp as string).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── CEX Section — Blue Chip Trading ─────────────────────── */}
      <CEXTab />

      {/* Tab Navigation (matches Solana style) */}
      <div className="flex gap-1 rounded-lg bg-slate-800/50 p-1 overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition whitespace-nowrap ${
              activeTab === tab.key
                ? 'bg-blue-600 text-white'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700'
            }`}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* Markets Tab */}
      {activeTab === 'markets' && (
        <DexScreenerTrending />
      )}

      {/* Portfolio Tab */}
      {activeTab === 'portfolio' && paper && (
        <div className="space-y-4">
          {/* Portfolio Summary */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl bg-slate-800/50 p-3 text-center">
              <div className="text-2xl font-bold text-white">${paper.totalValue.toFixed(2)}</div>
              <div className="text-xs text-slate-400">Total Value</div>
            </div>
            <div className="rounded-xl bg-slate-800/50 p-3 text-center">
              <div className={`text-2xl font-bold ${paper.totalPnlUsd >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {paper.totalPnlUsd >= 0 ? '+' : ''}${paper.totalPnlUsd.toFixed(2)}
              </div>
              <div className="text-xs text-slate-400">P&L ({paper.totalPnlPct}%)</div>
            </div>
            <div className="rounded-xl bg-slate-800/50 p-3 text-center">
              <div className="text-2xl font-bold text-white">{paper.trades}</div>
              <div className="text-xs text-slate-400">Trades</div>
            </div>
            <div className="rounded-xl bg-slate-800/50 p-3 text-center">
              <div className="text-2xl font-bold text-white">{paper.winRate}%</div>
              <div className="text-xs text-slate-400">Win Rate</div>
            </div>
          </div>

          {/* P&L Accuracy Badge */}
          <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${
            paper.derivedPnlMatch ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
          }`}>
            {paper.derivedPnlMatch ? '✓' : '✗'} P&L Accuracy: {paper.derivedPnlMatch ? 'VERIFIED — derived matches reported' : 'MISMATCH — investigate'}
          </div>

          {/* Open Positions */}
          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-300">Open Positions</h3>
            {paper.openPositions.length > 0 ? paper.openPositions.map((p) => (
              <div key={p.symbol} className="flex items-center justify-between rounded-lg bg-slate-800/50 px-4 py-2.5 mb-1">
                <div>
                  <span className="text-sm font-semibold text-white">{p.symbol}</span>
                  <span className="ml-2 text-xs text-slate-500">{p.qty.toFixed(6)} @ ${p.avgEntry.toFixed(2)}</span>
                </div>
                <div className="text-right">
                  <div className="text-sm font-medium text-white">${p.value.toFixed(2)}</div>
                  <div className={`text-xs ${p.pnlUsd >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {p.pnlUsd >= 0 ? '+' : ''}${p.pnlUsd.toFixed(2)} ({p.pnlPct.toFixed(1)}%)
                  </div>
                </div>
              </div>
            )) : (
              <div className="rounded-lg bg-slate-800/50 p-6 text-center text-slate-500">
                No open positions — engine will generate signals and trade automatically
              </div>
            )}
          </div>

          {/* Recent Trades */}
          {paper.recentTrades.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-slate-300">Recent Trades</h3>
              {paper.recentTrades.slice(0, 10).map((t, i) => (
                <div key={i} className="flex items-center justify-between rounded-lg bg-slate-800/30 px-4 py-2 mb-0.5">
                  <div className="flex items-center gap-2">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                      t.side === 'buy' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                    }`}>{t.side.toUpperCase()}</span>
                    <span className="text-sm text-white">{t.symbol}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    {t.side === 'buy' ? (
                      <span className="text-xs text-slate-400 font-mono">
                        -${(t.qty * t.price).toFixed(2)}
                      </span>
                    ) : (
                      <span className={`text-xs font-mono ${t.pnlUsd >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {t.pnlUsd >= 0 ? '+' : ''}${t.pnlUsd.toFixed(2)}
                      </span>
                    )}
                    <span className="text-[10px] text-slate-500">
                      {new Date(t.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {activeTab === 'portfolio' && !paper && (
        <div className="rounded-lg bg-slate-800/50 p-8 text-center text-slate-500">Loading portfolio...</div>
      )}

      {/* Signals Tab */}
      {activeTab === 'signals' && (
        <div className="space-y-3">
          <div className="rounded-lg border border-slate-700/50 bg-slate-800/50 p-4">
            <h3 className="text-sm font-semibold text-slate-200 mb-2">Tradevisor Watchlist</h3>
            <p className="text-[10px] text-slate-500 mb-3">Coins discovered by APEX agents waiting for 6-indicator technical analysis confirmation (4+ must align before trading)</p>
            <TradevisorWatchlist />
          </div>
          <div className="rounded-lg border border-slate-700/50 bg-slate-800/50 p-4">
            <h3 className="text-sm font-semibold text-slate-200 mb-2">Signal Trade Log</h3>
            <SignalTradeLog />
          </div>
        </div>
      )}

      {/* TradingView Tab */}
      {activeTab === 'tradingview' && (
        <div className="space-y-4">
          <div className={`rounded-lg border p-4 ${
            s?.tradingViewConnected
              ? 'border-emerald-500/30 bg-emerald-500/5'
              : 'border-slate-700/50 bg-slate-800/50'
          }`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Radio className={`h-5 w-5 ${s?.tradingViewConnected ? 'text-emerald-400' : 'text-slate-500'}`} />
                <div>
                  <div className="text-sm font-semibold text-white">TradingView Webhook</div>
                  <div className="text-xs text-slate-400">Tradevisor V2 signals feed into APEX intelligence</div>
                </div>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                s?.tradingViewConnected ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-600/20 text-slate-500'
              }`}>
                {s?.tradingViewConnected ? 'CONNECTED' : 'WAITING FOR FIRST SIGNAL'}
              </span>
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-300">Recent Signals</h3>
            {(s?.tradingViewSignals ?? []).length > 0 ? (
              (s?.tradingViewSignals ?? []).map((sig, i) => (
                <div key={i} className="flex items-center justify-between rounded-lg bg-slate-800/30 px-4 py-2.5 mb-1">
                  <div className="flex items-center gap-2">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                      sig.action === 'buy' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                    }`}>{sig.action.toUpperCase()}</span>
                    <span className="text-sm font-medium text-white">{sig.symbol}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-slate-300">${sig.price.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
                    <span className="text-[10px] text-slate-500">
                      {new Date(sig.receivedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-lg bg-slate-800/50 p-6 text-center text-slate-500">
                <RefreshCw className="mx-auto h-6 w-6 mb-2 opacity-50" />
                <p>No TradingView signals yet</p>
                <p className="text-xs mt-1">Alerts fire automatically when Tradevisor V2 detects trend changes on SOL, BTC, ETH</p>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}

// ── Wallet Display Component ────────────────────────────────────────

function WalletDisplay() {
  const { publicKey, connected } = useWallet();

  if (!connected || !publicKey) {
    return (
      <div className="mt-2 text-[10px] text-slate-500">
        Connect a Solana wallet (Phantom/Solflare) to enable live DEX trading on discovered coins.
        Coinbase is connected via API keys in Settings.
      </div>
    );
  }

  return (
    <div className="mt-2 flex items-center gap-2">
      <span className="h-2 w-2 rounded-full bg-green-400" />
      <span className="text-[10px] text-green-400 font-mono">
        {publicKey.toBase58().slice(0, 6)}...{publicKey.toBase58().slice(-4)}
      </span>
      <span className="text-[10px] text-slate-500">Solana wallet connected · Coinbase via API Keys in Settings · Add EVM wallet (MetaMask) coming soon</span>
    </div>
  );
}

// ── EVM Wallet Display ──────────────────────────────────────────────

function EVMWalletDisplay() {
  try {
    const { address, isConnected, chain } = useEVMAccount();
    if (!isConnected || !address) {
      return <span className="text-[10px] text-slate-500">Click button above to connect SafePal/MetaMask</span>;
    }
    return (
      <div className="flex items-center gap-1">
        <span className="h-2 w-2 rounded-full bg-green-400" />
        <span className="text-[10px] text-green-400 font-mono">{address.slice(0, 6)}...{address.slice(-4)}</span>
        <span className="text-[9px] text-slate-500">{chain?.name ?? 'EVM'}</span>
      </div>
    );
  } catch {
    return <span className="text-[10px] text-slate-500">EVM wallet available after setup</span>;
  }
}

// ── DexScreener Trending Component ──────────────────────────────────

function DexScreenerTrending() {
  const { data, isLoading } = useQuery({
    queryKey: ['dexscreener-trending'],
    queryFn: async () => {
      const res = await fetch('https://api.dexscreener.com/token-boosts/latest/v1');
      if (!res.ok) return [];
      const tokens = await res.json() as Array<{
        tokenAddress: string; chainId: string; description?: string; totalAmount?: number;
        links?: Array<{ type: string; url: string }>;
      }>;
      // Get price data for top tokens
      const top = tokens.filter(t => t.chainId === 'solana').slice(0, 30);
      const withPrices: Array<{ address: string; symbol: string; price: number; change: number; volume: number; liquidity: number; chain: string; boosted: number }> = [];

      // Batch fetch prices from DexScreener
      for (const t of top.slice(0, 15)) {
        try {
          const pRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${t.tokenAddress}`);
          if (pRes.ok) {
            const pData = await pRes.json() as { pairs?: Array<{ baseToken: { symbol: string }; priceUsd: string; priceChange: { h24: number }; volume: { h24: number }; liquidity: { usd: number } }> };
            const pair = pData.pairs?.[0];
            if (pair) {
              withPrices.push({
                address: t.tokenAddress.slice(0, 8),
                symbol: pair.baseToken.symbol,
                price: parseFloat(pair.priceUsd ?? '0'),
                change: pair.priceChange?.h24 ?? 0,
                volume: pair.volume?.h24 ?? 0,
                liquidity: pair.liquidity?.usd ?? 0,
                chain: t.chainId,
                boosted: t.totalAmount ?? 0,
              });
            }
          }
        } catch { continue; }
      }
      return withPrices;
    },
    refetchInterval: 120_000, // 2 min
  });

  const tokens = (data ?? []) as Array<{ address: string; symbol: string; price: number; change: number; volume: number; liquidity: number; chain: string; boosted: number }>;

  if (isLoading) return <div className="p-8 text-center text-slate-500 text-xs">Loading DexScreener trending...</div>;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between px-3 py-1 text-[9px] text-slate-500 uppercase tracking-wider">
        <span>Token</span>
        <div className="flex gap-6"><span>Price</span><span>24h</span><span>Volume</span><span>Liquidity</span></div>
      </div>
      {tokens.map((t, i) => (
        <div key={i} className="flex items-center justify-between rounded-lg bg-slate-800/50 px-3 py-2 hover:bg-slate-800">
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-slate-600 w-4">{i + 1}</span>
            <span className="text-xs font-semibold text-white">{t.symbol}</span>
            <span className="text-[9px] text-slate-500">{t.chain}</span>
            {t.boosted > 0 && <span className="text-[8px] px-1 rounded bg-amber-500/20 text-amber-400">🔥 ${t.boosted}</span>}
          </div>
          <div className="flex items-center gap-4 text-xs">
            <span className="text-slate-200 font-mono w-20 text-right">
              ${t.price < 0.01 ? t.price.toExponential(2) : t.price < 1 ? t.price.toFixed(4) : t.price.toFixed(2)}
            </span>
            <span className={`w-14 text-right font-mono ${t.change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {t.change >= 0 ? '+' : ''}{t.change.toFixed(1)}%
            </span>
            <span className="text-slate-400 w-16 text-right">${(t.volume / 1000).toFixed(0)}K</span>
            <span className="text-slate-500 w-16 text-right">${(t.liquidity / 1000).toFixed(0)}K</span>
          </div>
        </div>
      ))}
      {tokens.length === 0 && <div className="p-8 text-center text-slate-500 text-xs">No DexScreener data available</div>}
    </div>
  );
}

// ── Tradevisor Watchlist Component ──────────────────────────────────

interface WatchlistDetail {
  ticker: string;
  chain: string;
  source: string;
  addedAt: string;
  analysisCount: number;
  lastAction: string;
  lastGrade: string;
  lastScore: number;
  lastConfidence: number;
  currentPrice: number;
  analyzedAt: string | null;
}

function TradevisorWatchlist() {
  const { data } = useQuery({
    queryKey: ['tradevisor-status'],
    queryFn: () => apiClient.get<{ data: { running: boolean; watchlistSize: number; watchlistDetails: WatchlistDetail[]; stats: { totalScans: number; totalSignals: number; lastScanAt: string | null } } }>('/intel/tradevisor/status'),
    refetchInterval: 15_000,
  });

  const resp = data as { data: { running: boolean; watchlistSize: number; watchlistDetails: WatchlistDetail[]; stats: { totalScans: number; totalSignals: number; lastScanAt: string | null } } } | undefined;
  const items = resp?.data?.watchlistDetails ?? [];
  const stats = resp?.data?.stats;

  const gradeColor = (grade: string) => {
    switch (grade) {
      case 'prime': return 'bg-emerald-500/20 text-emerald-400';
      case 'strong': return 'bg-blue-500/20 text-blue-400';
      case 'standard': return 'bg-amber-500/20 text-amber-400';
      case 'reject': return 'bg-red-500/20 text-red-400';
      default: return 'bg-slate-600/20 text-slate-500';
    }
  };

  const actionColor = (action: string) => {
    switch (action) {
      case 'buy': return 'text-emerald-400';
      case 'sell': return 'text-red-400';
      case 'hold': return 'text-amber-400';
      default: return 'text-slate-500';
    }
  };

  return (
    <div className="space-y-2">
      {/* Scan stats bar */}
      <div className="flex items-center gap-4 text-[10px] text-slate-500">
        <span>Watching: <span className="text-slate-300">{items.length}</span> tickers</span>
        <span>Scans: <span className="text-slate-300">{stats?.totalScans ?? 0}</span></span>
        <span>Signals: <span className="text-slate-300">{stats?.totalSignals ?? 0}</span></span>
        {stats?.lastScanAt && (
          <span>Last: <span className="text-slate-300">{new Date(stats.lastScanAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></span>
        )}
      </div>

      {/* Watchlist items */}
      {items.length > 0 ? (
        <div className="space-y-1">
          {items.map((w) => (
            <div key={`${w.ticker}_${w.chain}`} className="flex items-center justify-between rounded bg-slate-900/40 px-3 py-2">
              <div className="flex items-center gap-2">
                <span className={`text-xs font-bold ${actionColor(w.lastAction)}`}>{w.ticker}</span>
                <span className="text-[9px] text-slate-500">{w.chain}</span>
                <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${gradeColor(w.lastGrade)}`}>
                  {w.lastGrade === 'pending' ? '⏳ PENDING' : `${w.lastGrade.toUpperCase()} ${w.lastScore}/6`}
                </span>
              </div>
              <div className="flex items-center gap-3 text-[10px]">
                <span className={`font-mono ${actionColor(w.lastAction)}`}>
                  {w.lastAction === 'pending' ? 'SCANNING...' : w.lastAction.toUpperCase()}
                </span>
                {w.currentPrice > 0 && (
                  <span className="text-slate-400 font-mono">
                    ${w.currentPrice < 0.01 ? w.currentPrice.toExponential(2) : w.currentPrice < 1 ? w.currentPrice.toFixed(4) : w.currentPrice.toFixed(2)}
                  </span>
                )}
                <span className="text-slate-600">{w.source.split(',')[0]}</span>
                <span className="text-slate-600">×{w.analysisCount}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-[10px] text-slate-500 py-2">
          No tickers on watchlist. APEX agents scan every 15 min for new coins to analyze.
        </div>
      )}
    </div>
  );
}

// ── Signal Trade Log Component ──────────────────────────────────────

function SignalTradeLog() {
  const { data } = useQuery({
    queryKey: ['signal-log'],
    queryFn: () => apiClient.get<{ data: Array<{ symbol: string; action: string; source: string; confidence: number; price: number; executedAt: string }>; count: number }>('/crypto/signal-log'),
    refetchInterval: 15_000,
  });

  const log = (data as { data: Array<{ symbol: string; action: string; source: string; confidence: number; price: number; executedAt: string }>; count: number } | undefined);

  if (!log || log.count === 0) {
    return <div className="text-[10px] text-slate-500">No signal trades yet. Tradevisor will trade when 4+ indicators confirm on watched tickers.</div>;
  }

  return (
    <div className="space-y-1">
      {log.data.slice(0, 10).map((s, i) => (
        <div key={i} className="flex items-center justify-between text-[11px] rounded bg-slate-900/40 px-2 py-1">
          <div className="flex items-center gap-2">
            <span className={`px-1 py-0.5 rounded text-[9px] font-bold ${s.action === 'buy' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>{s.action.toUpperCase()}</span>
            <span className="text-white">{s.symbol}</span>
            <span className="text-slate-500">{s.source}</span>
          </div>
          <span className="text-slate-500">{s.confidence}%</span>
        </div>
      ))}
    </div>
  );
}

// ── CEX Tab — Blue Chip & Top 100 Crypto ──────────────────────────────

interface CEXPortfolioData {
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
    symbol: string;
    qty: number;
    avgEntry: number;
    currentPrice: number;
    value: number;
    pnlUsd: number;
    pnlPct: number;
    openedAt: string;
  }>;
  recentTrades: Array<{
    symbol: string;
    side: string;
    qty: number;
    price: number;
    pnlUsd: number;
    reason: string;
    timestamp: string;
  }>;
  universe: number;
  cycleCount: number;
  lastScanAt: string | null;
  running: boolean;
}

function CEXTab() {
  const { data } = useQuery({
    queryKey: ['cex-portfolio'],
    queryFn: () => apiClient.get<{ data: CEXPortfolioData }>('/crypto/cex/status'),
    refetchInterval: 15_000,
  });

  const cex = (data as { data: CEXPortfolioData } | undefined)?.data;
  const pnl = cex?.totalPnlUsd ?? 0;
  const atRisk = cex?.positionsValue ?? 0;

  return (
    <div className="space-y-3">
      {/* Paper Trading Banner */}
      <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Coins className="h-4 w-4 text-blue-400" />
            <span className="text-sm font-bold text-blue-400">CEX — Blue Chip Trading (Coinbase)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${cex?.running ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-600/20 text-slate-500'}`}>
              {cex?.running ? `LIVE · Cycle #${cex.cycleCount}` : 'STOPPED'}
            </span>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <p className="text-[10px] text-slate-500">Total Balance</p>
            <p className="text-lg font-bold text-white">${(cex?.totalValue ?? 5000).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          </div>
          <div>
            <p className="text-[10px] text-slate-500">At Risk</p>
            <p className="text-lg font-bold text-amber-400">${atRisk.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          </div>
          <div>
            <p className="text-[10px] text-slate-500">P&L</p>
            <p className={`text-lg font-bold ${pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
            </p>
          </div>
        </div>
        <div className="flex items-center justify-center gap-4 mt-2 text-[10px] text-slate-500">
          <span>{cex?.universe ?? 30} coins tracked</span>
          <span>{cex?.totalTrades ?? 0} trades</span>
          <span>{cex?.wins ?? 0}W / {cex?.losses ?? 0}L ({cex?.winRate ?? 0}%)</span>
        </div>
      </div>

      {/* Open Positions */}
      <div className="rounded-lg border border-slate-700/50 bg-slate-800/50 p-3">
        <h3 className="text-sm font-semibold text-slate-200 mb-2">Open Positions ({cex?.openPositions?.length ?? 0})</h3>
        {cex?.openPositions && cex.openPositions.length > 0 ? (
          <div className="space-y-1">
            {cex.openPositions.map((p) => (
              <div key={p.symbol} className="flex items-center justify-between rounded bg-slate-900/40 px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-white">{p.symbol}</span>
                  <span className="text-[10px] text-slate-500">{p.qty < 0.01 ? p.qty.toFixed(6) : p.qty.toFixed(4)}</span>
                </div>
                <div className="flex items-center gap-4 text-[11px]">
                  <span className="text-slate-400 font-mono">${p.currentPrice.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
                  <span className="text-slate-500 font-mono w-16 text-right">${p.value.toFixed(2)}</span>
                  <span className={`font-mono font-bold w-20 text-right ${p.pnlUsd >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {p.pnlUsd >= 0 ? '+' : ''}${p.pnlUsd.toFixed(2)} ({p.pnlPct >= 0 ? '+' : ''}{p.pnlPct.toFixed(1)}%)
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[10px] text-slate-500 py-2">No open positions. CEX engine scans top 30 coins every 5 min via Tradevisor (4/6 confluence required).</p>
        )}
      </div>

      {/* Recent Trades */}
      <div className="rounded-lg border border-slate-700/50 bg-slate-800/50 p-3">
        <h3 className="text-sm font-semibold text-slate-200 mb-2">Recent Trades</h3>
        {cex?.recentTrades && cex.recentTrades.length > 0 ? (
          <div className="space-y-1">
            {cex.recentTrades.slice(0, 10).map((t, i) => (
              <div key={i} className="flex items-center justify-between rounded bg-slate-900/40 px-3 py-1.5">
                <div className="flex items-center gap-2">
                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${t.side === 'buy' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                    {t.side.toUpperCase()}
                  </span>
                  <span className="text-xs font-medium text-white">{t.symbol}</span>
                  <span className="text-[9px] text-slate-500 truncate max-w-[200px]">{t.reason}</span>
                </div>
                <div className="flex items-center gap-3 text-[10px]">
                  {t.pnlUsd !== 0 && (
                    <span className={`font-mono ${t.pnlUsd >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {t.pnlUsd >= 0 ? '+' : ''}${t.pnlUsd.toFixed(2)}
                    </span>
                  )}
                  <span className="text-slate-600">{new Date(t.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[10px] text-slate-500 py-2">No trades yet. Waiting for Tradevisor 4/6+ confluence on blue chip coins.</p>
        )}
      </div>
    </div>
  );
}
