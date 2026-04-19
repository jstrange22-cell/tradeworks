import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Rocket, Target,
  DollarSign, Trash2, Plus, Copy,
  Zap, Play, Square,
} from 'lucide-react';
import { apiClient } from '@/lib/api-client';

// ── Types ──────────────────────────────────────────────────────────────

interface TrackedToken {
  mint: string;
  name: string;
  ticker: string;
  graduated: boolean;
  graduatedAt: string | null;
  bondingCurvePct: number;
  holders: number;
  buys: number;
  sells: number;
  buySellRatio: number;
  marketCapUsd: number;
  volumeUsd: number;
  minutesSinceLastBuy: number;
  graduationOdds: number;
  coachingStatus: string;
  nextAction: string;
  readyTweet: string | null;
  revenueSOL: number;
  revenueUSD: number;
  lastUpdated: string;
}

// ── Component ──────────────────────────────────────────────────────────

export function LaunchCoachPage() {
  const queryClient = useQueryClient();
  const [mintInput, setMintInput] = useState('');
  const [conceptInput, setConceptInput] = useState('');
  const [showPlanner, setShowPlanner] = useState(false);

  const { data: trackedData } = useQuery({
    queryKey: ['launch-coach-tracked'],
    queryFn: () => apiClient.get<{ data: TrackedToken[]; count: number; coachingActive: boolean }>('/launch-coach/tracked'),
    refetchInterval: 10_000,
  });

  const trackMutation = useMutation({
    mutationFn: (mint: string) => apiClient.post('/launch-coach/track', { mint }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['launch-coach-tracked'] });
      setMintInput('');
    },
  });

  const untrackMutation = useMutation({
    mutationFn: (mint: string) => apiClient.delete(`/launch-coach/track/${mint}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['launch-coach-tracked'] }),
  });

  const planMutation = useMutation({
    mutationFn: (concept: string) => apiClient.post<{ data: Record<string, unknown> }>('/launch-coach/plan', { concept }),
  });

  const tracked = (trackedData as { data: TrackedToken[]; count: number } | undefined)?.data ?? [];

  // Factory data
  const { data: factoryData } = useQuery({
    queryKey: ['launch-factory'],
    queryFn: () => apiClient.get<{ data: Record<string, unknown> }>('/launch-coach/factory/status'),
    refetchInterval: 30_000,
  });

  const factory = (factoryData as { data: Record<string, unknown> } | undefined)?.data;

  // Derived factory accessors (factory is Record<string, unknown>)
  const fRunning = factory?.running as boolean | undefined;
  const fDailyLaunches = factory?.dailyLaunches as number | undefined;
  const fMaxDaily = factory?.maxDaily as number | undefined;
  const fTrendCategories = factory?.trendCategories as Array<{ category: string; opportunity: number; saturation: string; tokensLaunched24h: number; graduated24h: number }> | undefined;
  const fLaunchedTokens = factory?.launchedTokens as Array<Record<string, unknown>> | undefined;
  const fNextLaunchWindow = factory?.nextLaunchWindow as string | undefined;
  const fTotalCreationCostSOL = factory?.totalCreationCostSOL as number | undefined;
  const fTotalRevenueSOL = factory?.totalRevenueSOL as number | undefined;
  const fWallet = factory?.wallet as { sol?: number; usd?: number; address?: string } | undefined;

  const factoryStartMutation = useMutation({
    mutationFn: () => apiClient.post('/launch-coach/factory/start', {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['launch-factory'] }),
  });

  const factoryStopMutation = useMutation({
    mutationFn: () => apiClient.post('/launch-coach/factory/stop', {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['launch-factory'] }),
  });

  const launchNowMutation = useMutation({
    mutationFn: () => apiClient.post('/launch-coach/factory/launch-now', {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['launch-factory'] }),
  });

  const [historyMint, setHistoryMint] = useState<string | null>(null);

  const { data: historyData } = useQuery({
    queryKey: ['launch-coach-history', historyMint],
    queryFn: () => apiClient.get<{ data: Array<{ type: string; message: string; timestamp: string; detail?: string }> }>(`/launch-coach/history/${historyMint}`),
    enabled: !!historyMint,
    refetchInterval: 30_000,
  });

  const coachingHistory = (historyData as { data: Array<{ type: string; message: string; timestamp: string; detail?: string }> } | undefined)?.data ?? [];

  const historyEventColor = (type: string) => {
    switch (type) {
      case 'milestone': return 'border-emerald-500/50 text-emerald-400';
      case 'stall': return 'border-amber-500/50 text-amber-400';
      case 'whale_alert': return 'border-blue-500/50 text-blue-400';
      case 'graduated': return 'border-purple-500/50 text-purple-400';
      case 'momentum_fading': return 'border-orange-500/50 text-orange-400';
      default: return 'border-slate-600/50 text-slate-400';
    }
  };

  const statusColor = (status: string) => {
    switch (status) {
      case 'graduated': return 'text-emerald-400 bg-emerald-500/20';
      case 'almost_there': return 'text-amber-400 bg-amber-500/20';
      case 'stalled': return 'text-red-400 bg-red-500/20';
      case 'whale_alert': return 'text-blue-400 bg-blue-500/20';
      case 'momentum_fading': return 'text-orange-400 bg-orange-500/20';
      default: return 'text-slate-400 bg-slate-500/20';
    }
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case 'graduated': return '🎓';
      case 'almost_there': return '🔥';
      case 'stalled': return '⚠️';
      case 'whale_alert': return '🐋';
      case 'momentum_fading': return '📉';
      default: return '📊';
    }
  };

  return (
    <div className="space-y-4 p-3 md:space-y-6 md:p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Rocket className="h-6 w-6 text-purple-400" />
          <div>
            <h1 className="text-lg md:text-2xl font-bold text-slate-100">Token Launch Coach</h1>
            <p className="text-xs text-slate-500">APEX coaches you through launch → graduation → revenue</p>
          </div>
        </div>
        <button
          onClick={() => setShowPlanner(!showPlanner)}
          className="flex items-center gap-1.5 rounded-lg bg-purple-600/20 px-3 py-1.5 text-sm text-purple-400 hover:bg-purple-600/30"
        >
          <Plus className="h-3.5 w-3.5" /> Plan Launch
        </button>
      </div>

      {/* Token Factory — Auto-Launch Engine */}
      <div className="rounded-xl border border-purple-500/30 bg-purple-500/5 p-4">
        <div className="flex flex-col gap-2 mb-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-purple-400 shrink-0" />
            <div>
              <span className="text-sm font-bold text-purple-400">Token Factory</span>
              <span className="ml-2 text-[10px] text-slate-500 hidden sm:inline">Auto-launches tokens on pump.fun</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${fRunning ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-600/20 text-slate-500'}`}>
              {fRunning ? `ACTIVE · ${fDailyLaunches}/${fMaxDaily} today` : 'STOPPED'}
            </span>
            {fRunning ? (
              <button onClick={() => factoryStopMutation.mutate()} className="rounded-md bg-red-600/20 px-3 py-2 text-[10px] text-red-400 hover:bg-red-600/30">
                <Square className="h-3 w-3" />
              </button>
            ) : (
              <button onClick={() => factoryStartMutation.mutate()} className="rounded-md bg-emerald-600/20 px-3 py-2 text-[10px] text-emerald-400 hover:bg-emerald-600/30">
                <Play className="h-3 w-3" />
              </button>
            )}
            <button
              onClick={() => launchNowMutation.mutate()}
              disabled={launchNowMutation.isPending}
              className="rounded-md bg-purple-600/20 px-3 py-2 text-[10px] text-purple-400 hover:bg-purple-600/30 disabled:opacity-50"
              title="Force launch a token now"
            >
              {launchNowMutation.isPending ? '...' : 'Force Launch'}
            </button>
          </div>
        </div>

        {/* Trend Categories */}
        {fTrendCategories && fTrendCategories.length > 0 && (
          <div className="mb-3">
            <p className="text-[10px] text-slate-500 mb-1">Trending Categories (opportunity score)</p>
            <div className="flex flex-wrap gap-1">
              {fTrendCategories.slice(0, 8).map(t => (
                <span key={t.category} className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  t.opportunity >= 70 ? 'bg-emerald-500/20 text-emerald-400' :
                  t.opportunity >= 50 ? 'bg-amber-500/20 text-amber-400' :
                  'bg-slate-600/20 text-slate-500'
                }`}>
                  {t.category} {t.opportunity}/100 · {t.saturation}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Auto-Launched Tokens */}
        {fLaunchedTokens && fLaunchedTokens.length > 0 && (
          <div>
            <p className="text-[10px] text-slate-500 mb-1">Auto-Launched ({fLaunchedTokens.length})</p>
            <div className="space-y-2 max-h-48 md:max-h-64 overflow-y-auto">
              {fLaunchedTokens.map((t, i) => {
                const tok = t;
                const imageUri = tok.imageUri as string | null;
                const pumpUrl = tok.pumpFunUrl as string | null;
                const solscanUrl = tok.solscanUrl as string | null;
                const hook = tok.hook as string | null;
                const ticker = tok.ticker as string | undefined;
                const name = tok.name as string | undefined;
                const status = tok.status as string | undefined;
                const mint = tok.mint as string | null;
                const launchedAt = tok.launchedAt as string;
                return (
                <div key={i} className="rounded-lg bg-slate-900/40 px-3 py-3 border border-slate-700/30">
                  {/* Header with logo */}
                  <div className="flex items-start gap-3 mb-2">
                    {/* Token Logo */}
                    {imageUri ? (
                      <img src={imageUri} alt={ticker} className="h-12 w-12 rounded-lg shrink-0" />
                    ) : (
                      <div className="h-12 w-12 rounded-lg bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center text-white font-bold text-sm shrink-0">
                        {ticker?.slice(0, 3)}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${
                          status === 'created' ? 'bg-emerald-500/20 text-emerald-400' :
                          status === 'graduated' ? 'bg-purple-500/20 text-purple-400' :
                          status === 'failed' ? 'bg-red-500/20 text-red-400' :
                          'bg-slate-600/20 text-slate-500'
                        }`}>{status === 'created' ? 'LIVE' : (status ?? '').toUpperCase()}</span>
                        <span className="text-sm font-bold text-white">{ticker}</span>
                        <span className="text-[10px] text-slate-500">{name}</span>
                      </div>
                      {hook && <p className="text-[10px] text-slate-400 italic">{hook}</p>}
                    </div>
                    <span className="text-[10px] text-slate-600 shrink-0">{new Date(launchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>

                  {/* Contract Address — FULL, no truncation */}
                  {mint && !mint.startsWith('paper_') && (
                    <div className="mb-3">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] text-slate-400 font-semibold">Contract:</span>
                        <button
                          onClick={() => navigator.clipboard.writeText(mint ?? '')}
                          className="text-xs bg-slate-700 hover:bg-slate-600 text-white px-2 py-1 rounded font-bold flex items-center gap-1"
                        >
                          <Copy className="h-3 w-3" /> Copy CA
                        </button>
                      </div>
                      <p className="text-xs font-mono text-emerald-400 bg-slate-800/80 rounded px-2 py-1.5 break-all select-all cursor-pointer border border-slate-700/50"
                         onClick={() => navigator.clipboard.writeText(mint ?? '')}>
                        {mint}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 mt-2">
                        <a href={pumpUrl ?? `https://pump.fun/coin/${mint}`} target="_blank" rel="noopener noreferrer"
                          className="text-xs bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-lg font-bold">
                          Buy More on pump.fun
                        </a>
                        <a href={pumpUrl ?? `https://pump.fun/coin/${mint}`} target="_blank" rel="noopener noreferrer"
                          className="text-[10px] bg-emerald-500/20 text-emerald-400 px-2 py-1 rounded hover:bg-emerald-500/30">
                          View on pump.fun
                        </a>
                        {solscanUrl && (
                          <a href={solscanUrl} target="_blank" rel="noopener noreferrer"
                            className="text-[10px] bg-blue-500/20 text-blue-400 px-2 py-1 rounded hover:bg-blue-500/30">
                            Solscan
                          </a>
                        )}
                      </div>
                    </div>
                  )}
                  {mint?.startsWith('paper_') && (
                    <span className="text-[9px] text-amber-500/60 block mb-2">Paper launch — not on-chain</span>
                  )}

                  {/* Market Stats */}
                  <div className="grid grid-cols-2 gap-2 text-[10px] text-center md:grid-cols-4">
                    <div className="bg-slate-800/50 rounded px-2 py-1">
                      <p className="text-slate-500">Holders</p>
                      <p className="text-slate-200 font-bold">{(tok.holders as number) ?? 0}</p>
                    </div>
                    <div className="bg-slate-800/50 rounded px-2 py-1">
                      <p className="text-slate-500">Curve</p>
                      <p className="text-slate-200 font-bold">{((tok.bondingCurvePct as number ?? 0) * 100).toFixed(0)}%</p>
                    </div>
                    <div className="bg-slate-800/50 rounded px-2 py-1">
                      <p className="text-slate-500">Revenue</p>
                      <p className="text-emerald-400 font-bold">{(tok.revenueSOL as number ?? 0).toFixed(4)}</p>
                    </div>
                    <div className="bg-slate-800/50 rounded px-2 py-1">
                      <p className="text-slate-500">Cost</p>
                      <p className="text-amber-400 font-bold">{(tok.creationCostSOL as number ?? 0).toFixed(3)}</p>
                    </div>
                  </div>
                </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Wallet + Stats */}
        <div className="mt-3 rounded-lg bg-slate-800/60 border border-slate-700/50 p-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <p className="text-[10px] text-slate-400 mb-0.5">Launch Wallet</p>
              <p className="text-sm font-bold text-emerald-400 font-mono">
                {fWallet ? `${(fWallet.sol ?? 0).toFixed(4)} SOL` : 'Not configured'}
                <span className="text-slate-500 font-normal ml-1">(~${(fWallet?.usd ?? 0).toFixed(2)})</span>
              </p>
              {fWallet?.address && (
                <p className="text-[10px] font-mono text-slate-500 mt-0.5 break-all">{fWallet.address}</p>
              )}
            </div>
            <div className="flex items-center gap-3 text-xs flex-wrap">
              <div className="text-center">
                <p className="text-slate-500 text-[10px]">Spent</p>
                <p className="text-amber-400 font-bold">{(fTotalCreationCostSOL ?? 0).toFixed(3)} SOL</p>
              </div>
              <div className="text-center">
                <p className="text-slate-500 text-[10px]">Revenue</p>
                <p className="text-emerald-400 font-bold">{(fTotalRevenueSOL ?? 0).toFixed(4)} SOL</p>
              </div>
              <div className="text-center">
                <p className="text-slate-500 text-[10px]">Next</p>
                <p className="text-purple-400 font-bold">{fNextLaunchWindow ?? '—'}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Pre-Launch Planner */}
      {showPlanner && (
        <div className="rounded-xl border border-purple-500/30 bg-purple-500/5 p-4">
          <h3 className="text-sm font-bold text-purple-400 mb-2">Launch Planner</h3>
          <p className="text-xs text-slate-400 mb-3">Describe your coin idea. APEX will generate names, timing, and tweets.</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={conceptInput}
              onChange={e => setConceptInput(e.target.value)}
              placeholder="e.g., dog-themed meme coin, AI agent token..."
              className="flex-1 rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-purple-500 focus:outline-none"
            />
            <button
              onClick={() => { planMutation.mutate(conceptInput); }}
              disabled={!conceptInput || planMutation.isPending}
              className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50 whitespace-nowrap"
            >
              {planMutation.isPending ? 'Planning...' : 'Generate Plan'}
            </button>
          </div>
          {planMutation.data && (
            <div className="mt-3 rounded-lg bg-slate-800/50 p-3 text-xs space-y-2">
              <pre className="text-slate-300 whitespace-pre-wrap">{JSON.stringify((planMutation.data as { data: Record<string, unknown> }).data, null, 2)}</pre>
            </div>
          )}
        </div>
      )}

      {/* Track New Token */}
      <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-4">
        <h3 className="text-sm font-bold text-slate-200 mb-2">Track Your Token</h3>
        <p className="text-xs text-slate-500 mb-3">Paste your token's contract address. APEX will start coaching you through graduation.</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={mintInput}
            onChange={e => setMintInput(e.target.value)}
            placeholder="Paste Solana token mint address..."
            className="flex-1 rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm font-mono text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
          />
          <button
            onClick={() => trackMutation.mutate(mintInput)}
            disabled={!mintInput || mintInput.length < 30 || trackMutation.isPending}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 whitespace-nowrap"
          >
            {trackMutation.isPending ? 'Tracking...' : 'Start Coaching'}
          </button>
        </div>
      </div>

      {/* Tracked Tokens */}
      {tracked.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-700/50 bg-slate-800/30 p-8 text-center">
          <Rocket className="h-10 w-10 text-slate-600 mx-auto mb-3" />
          <p className="text-sm text-slate-500">No tokens tracked yet.</p>
          <p className="text-xs text-slate-600 mt-1">Launch a token on pump.fun, then paste the contract address above.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {tracked.map(token => (
            <div key={token.mint} className="rounded-xl border border-slate-700/50 bg-slate-800/50 overflow-hidden">
              {/* Token Header */}
              <div className="border-b border-slate-700/30 px-3 py-3 md:px-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2 min-w-0">
                    <span className="text-lg shrink-0">{statusIcon(token.coachingStatus)}</span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-bold text-white">{token.ticker}</span>
                        <span className="text-xs text-slate-500">{token.name}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${statusColor(token.coachingStatus)}`}>
                          {token.coachingStatus.replace(/_/g, ' ').toUpperCase()}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <p className="text-[10px] font-mono text-emerald-400/80 break-all select-all cursor-pointer"
                           onClick={() => navigator.clipboard.writeText(token.mint)}>
                          {token.mint}
                        </p>
                        <button onClick={() => navigator.clipboard.writeText(token.mint)}
                          className="text-[9px] bg-slate-700 hover:bg-slate-600 text-white px-1.5 py-0.5 rounded shrink-0">
                          Copy
                        </button>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1">
                        <a href={`https://pump.fun/coin/${token.mint}`} target="_blank" rel="noopener noreferrer"
                          className="text-[10px] bg-emerald-600 hover:bg-emerald-500 text-white px-2 py-0.5 rounded font-bold">
                          Buy More
                        </a>
                        <a href={`https://pump.fun/coin/${token.mint}`} target="_blank" rel="noopener noreferrer"
                          className="text-[10px] bg-slate-700 hover:bg-slate-600 text-slate-300 px-2 py-0.5 rounded">
                          pump.fun
                        </a>
                        <a href={`https://solscan.io/token/${token.mint}`} target="_blank" rel="noopener noreferrer"
                          className="text-[10px] bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded hover:bg-blue-500/30">
                          Solscan
                        </a>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {token.graduated && (
                      <div className="text-right hidden sm:block">
                        <p className="text-[10px] text-slate-500">Creator Revenue</p>
                        <p className="text-sm font-bold text-emerald-400">{token.revenueSOL.toFixed(2)} SOL</p>
                      </div>
                    )}
                    <button
                      onClick={() => untrackMutation.mutate(token.mint)}
                      className="rounded-md p-1.5 text-slate-600 hover:bg-red-500/20 hover:text-red-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                {token.graduated && (
                  <div className="text-right mt-2 sm:hidden">
                    <p className="text-[10px] text-slate-500">Creator Revenue</p>
                    <p className="text-sm font-bold text-emerald-400">{token.revenueSOL.toFixed(2)} SOL</p>
                  </div>
                )}
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-2 gap-2 px-3 py-3 text-center text-xs border-b border-slate-700/30 md:grid-cols-4 md:gap-3 md:px-4">
                <div>
                  <p className="text-[10px] text-slate-500">Curve</p>
                  <p className="text-sm font-bold text-white">{(token.bondingCurvePct * 100).toFixed(0)}%</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-500">Holders</p>
                  <p className="text-sm font-bold text-white">{token.holders}</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-500">Buy/Sell</p>
                  <p className={`text-sm font-bold ${token.buySellRatio >= 3 ? 'text-emerald-400' : token.buySellRatio >= 1.5 ? 'text-amber-400' : 'text-red-400'}`}>
                    {token.buySellRatio.toFixed(1)}:1
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-500">Grad Odds</p>
                  <p className={`text-sm font-bold ${token.graduationOdds > 10 ? 'text-emerald-400' : token.graduationOdds > 3 ? 'text-amber-400' : 'text-slate-400'}`}>
                    {token.graduationOdds.toFixed(1)}%
                  </p>
                </div>
              </div>

              {/* Coaching Action */}
              <div className="px-4 py-3 bg-slate-900/30">
                <div className="flex items-start gap-2">
                  <Target className="h-4 w-4 text-purple-400 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-xs font-semibold text-purple-400 mb-1">Next Action</p>
                    <p className="text-xs text-slate-300 whitespace-pre-line">{token.nextAction}</p>
                  </div>
                </div>

                {/* Ready Tweet */}
                {token.readyTweet && (
                  <div className="mt-3 rounded-lg bg-slate-800/50 border border-slate-700/30 p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-bold text-blue-400">Ready to Post</span>
                      <button
                        onClick={() => navigator.clipboard.writeText(token.readyTweet ?? '')}
                        className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] text-slate-400 hover:bg-slate-700 hover:text-white"
                      >
                        <Copy className="h-3 w-3" /> Copy
                      </button>
                    </div>
                    <p className="text-xs text-slate-300 whitespace-pre-line">{token.readyTweet}</p>
                  </div>
                )}
              </div>

              {/* Revenue Section (graduated only) */}
              {token.graduated && (
                <div className="px-4 py-3 border-t border-emerald-500/20 bg-emerald-500/5">
                  <div className="flex items-center gap-2 mb-2">
                    <DollarSign className="h-4 w-4 text-emerald-400" />
                    <span className="text-xs font-bold text-emerald-400">Creator Revenue (0.95% of volume)</span>
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-center text-xs">
                    <div>
                      <p className="text-[10px] text-emerald-400/60">24h Volume</p>
                      <p className="text-sm font-bold text-white">${token.volumeUsd.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-emerald-400/60">Daily Revenue</p>
                      <p className="text-sm font-bold text-emerald-400">{token.revenueSOL.toFixed(2)} SOL</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-emerald-400/60">Monthly (proj)</p>
                      <p className="text-sm font-bold text-emerald-400">{(token.revenueSOL * 30).toFixed(1)} SOL</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Buy More + History Toggle */}
              <div className="px-4 py-2 border-t border-slate-700/30 flex items-center gap-2">
                <a
                  href={`https://pump.fun/coin/${token.mint}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-md bg-purple-600/20 px-3 py-1.5 text-[10px] font-bold text-purple-400 hover:bg-purple-600/30"
                >
                  Buy More on pump.fun
                </a>
                <button
                  onClick={() => setHistoryMint(historyMint === token.mint ? null : token.mint)}
                  className={`rounded-md px-3 py-1.5 text-[10px] font-bold ${
                    historyMint === token.mint
                      ? 'bg-slate-600/30 text-slate-200'
                      : 'bg-slate-700/20 text-slate-500 hover:bg-slate-700/30 hover:text-slate-300'
                  }`}
                >
                  {historyMint === token.mint ? 'Hide History' : 'Coaching History'}
                </button>
              </div>

              {/* Coaching History Timeline */}
              {historyMint === token.mint && (
                <div className="px-4 py-3 border-t border-slate-700/30 bg-slate-900/20">
                  <p className="text-[10px] font-bold text-slate-400 mb-2">Coaching Timeline</p>
                  {coachingHistory.length === 0 ? (
                    <p className="text-[10px] text-slate-600">No coaching events yet.</p>
                  ) : (
                    <div className="space-y-1.5 max-h-48 overflow-y-auto">
                      {coachingHistory.map((event, idx) => (
                        <div
                          key={idx}
                          className={`border-l-2 pl-3 py-1 ${historyEventColor(event.type)}`}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-[9px] font-bold uppercase">{event.type.replace(/_/g, ' ')}</span>
                            <span className="text-[9px] text-slate-600">
                              {new Date(event.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          <p className="text-[10px] text-slate-300">{event.message}</p>
                          {event.detail && <p className="text-[9px] text-slate-500 mt-0.5">{event.detail}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
