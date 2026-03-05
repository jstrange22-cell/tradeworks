import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import {
  Zap, Wallet, ArrowRightLeft, TrendingUp, Sparkles, Shield, ShieldOff,
  ExternalLink, Loader2, AlertTriangle, CheckCircle, RefreshCw,
  Crosshair, Eye, Target, Play, Square, Plus, Trash2, Settings,
  Rocket, Brain, Award, Activity, Copy,
} from 'lucide-react';
import { apiClient } from '@/lib/api-client';

// ─── Types ──────────────────────────────────────────────────────────────

interface SolanaTokenBalance {
  mint: string; symbol: string; name: string; amount: number;
  decimals: number; valueUsd: number; logoUri?: string;
}

interface SolanaBalanceData {
  wallet: string; rpcUrl: string; solBalance: number; solValueUsd: number;
  tokens: SolanaTokenBalance[]; totalValueUsd: number;
}

interface TokenInfo {
  mint: string; symbol: string; name: string; priceUsd: number;
  priceChange24h: number; volume24h: number; liquidity: number;
  marketCap: number; pairCreatedAt: string | null;
  imageUrl: string | null; url: string;
}

interface TokenSafety {
  mintAuthorityRevoked: boolean; freezeAuthorityRevoked: boolean;
  top10HolderPercent: number | null;
  riskLevel: 'low' | 'medium' | 'high' | 'critical'; warnings: string[];
}

interface PumpFunToken {
  mint: string; name: string; symbol: string; description: string;
  imageUri: string | null; creator: string; createdAt: string;
  marketCap: number; usdMarketCap: number; replyCount: number;
  bondingCurveProgress: number; graduated: boolean;
  website: string | null; twitter: string | null; telegram: string | null;
  kingOfTheHill: boolean;
}

interface SniperConfig {
  enabled: boolean; buyAmountSol: number; dailyBudgetSol: number;
  slippageBps: number; priorityFee: number; takeProfitPercent: number;
  stopLossPercent: number; minLiquidityUsd: number;
  maxMarketCapUsd: number; requireMintRevoked: boolean;
  requireFreezeRevoked: boolean; maxOpenPositions: number;
  autoBuyPumpFun: boolean; autoBuyTrending: boolean;
}

interface SnipeExecution {
  id: string; mint: string; symbol: string; name: string;
  action: 'buy' | 'sell'; amountSol: number; signature: string | null;
  status: 'pending' | 'success' | 'failed'; error: string | null;
  trigger: string; timestamp: string;
}

interface WhaleActivity {
  id: string; whaleAddress: string; whaleLabel: string;
  type: 'buy' | 'sell' | 'transfer'; tokenMint: string;
  tokenSymbol: string; tokenName: string; amountUsd: number;
  amountTokens: number; priceUsd: number; signature: string;
  timestamp: string; copied: boolean;
}

interface MoonshotScore {
  mint: string; symbol: string; name: string; score: number;
  factors: Record<string, { score: number; weight: number; weighted: number; details: string }>;
  rugRisk: string; rugWarnings: string[];
  priceUsd: number; marketCap: number; volume24h: number;
  liquidity: number; priceChange24h: number; scoredAt: string;
  recommendation: string;
}

type PageTab = 'scanner' | 'pumpfun' | 'sniper' | 'whales' | 'moonshot';

// ─── Component ──────────────────────────────────────────────────────────

export function SolanaPage() {
  const [activeTab, setActiveTab] = useState<PageTab>('scanner');
  const [scannerTab, setScannerTab] = useState<'trending' | 'new'>('trending');
  const [selectedToken, setSelectedToken] = useState<string | null>(null);
  const [swapInput, setSwapInput] = useState({ inputMint: 'So11111111111111111111111111111111111111112', outputMint: '', amount: '', slippageBps: '300' });
  const [swapSource, setSwapSource] = useState<'bot' | 'phantom'>('bot');

  const { publicKey: phantomKey, connected: phantomConnected } = useWallet();
  const queryClient = useQueryClient();

  // ── Core Queries ──────────────────────────────────────────────────
  const walletQuery = useQuery({
    queryKey: ['solana-wallet'],
    queryFn: () => apiClient.get<{ connected: boolean; wallet: string | null; rpcUrl: string | null }>('/solana/wallet'),
  });
  const balanceQuery = useQuery({
    queryKey: ['solana-balances'],
    queryFn: () => apiClient.get<{ data: SolanaBalanceData }>('/solana/balances'),
    enabled: walletQuery.data?.connected === true,
    refetchInterval: 30_000,
  });
  const trendingQuery = useQuery({
    queryKey: ['solana-trending'],
    queryFn: () => apiClient.get<{ data: TokenInfo[]; total: number }>('/solana/trending'),
    refetchInterval: 60_000,
  });
  const newTokensQuery = useQuery({
    queryKey: ['solana-new-tokens'],
    queryFn: () => apiClient.get<{ data: TokenInfo[]; total: number }>('/solana/new-tokens'),
    enabled: scannerTab === 'new' && activeTab === 'scanner',
    refetchInterval: 60_000,
  });
  const tokenDetailQuery = useQuery({
    queryKey: ['solana-token', selectedToken],
    queryFn: () => apiClient.get<{ data: { token: TokenInfo | null; safety: TokenSafety } }>(`/solana/token/${selectedToken}`),
    enabled: !!selectedToken,
  });

  // ── pump.fun Queries ──────────────────────────────────────────────
  const pumpfunLatest = useQuery({
    queryKey: ['pumpfun-latest'],
    queryFn: () => apiClient.get<{ data: PumpFunToken[] }>('/solana/pumpfun/latest?limit=30'),
    enabled: activeTab === 'pumpfun',
    refetchInterval: 10_000,
  });
  const pumpfunStatus = useQuery({
    queryKey: ['pumpfun-monitor'],
    queryFn: () => apiClient.get<{ running: boolean; totalDetected: number; recentLaunches: PumpFunToken[] }>('/solana/pumpfun/monitor/status'),
    enabled: activeTab === 'pumpfun',
    refetchInterval: 5_000,
  });

  // ── Sniper Queries ────────────────────────────────────────────────
  const sniperConfig = useQuery({
    queryKey: ['sniper-config'],
    queryFn: () => apiClient.get<{ data: SniperConfig }>('/solana/sniper/config'),
    enabled: activeTab === 'sniper',
  });
  const sniperStatus = useQuery({
    queryKey: ['sniper-status'],
    queryFn: () => apiClient.get<{ running: boolean; dailySpentSol: number; dailyBudgetSol: number; openPositions: unknown[]; recentExecutions: SnipeExecution[] }>('/solana/sniper/status'),
    enabled: activeTab === 'sniper',
    refetchInterval: 5_000,
  });

  // ── Whale Queries ─────────────────────────────────────────────────
  const whaleList = useQuery({
    queryKey: ['whale-list'],
    queryFn: () => apiClient.get<{ data: Array<{ address: string; label: string; totalTxns: number; lastActivity: string | null }> }>('/solana/whales/list'),
    enabled: activeTab === 'whales',
  });
  const whaleActivity = useQuery({
    queryKey: ['whale-activity'],
    queryFn: () => apiClient.get<{ data: WhaleActivity[] }>('/solana/whales/activity?limit=50'),
    enabled: activeTab === 'whales',
    refetchInterval: 10_000,
  });
  const whaleMonitorStatus = useQuery({
    queryKey: ['whale-monitor'],
    queryFn: () => apiClient.get<{ running: boolean; trackedWhales: number }>('/solana/whales/monitor/status'),
    enabled: activeTab === 'whales',
    refetchInterval: 5_000,
  });

  // ── Moonshot Queries ──────────────────────────────────────────────
  const moonshotLeaderboard = useQuery({
    queryKey: ['moonshot-leaderboard'],
    queryFn: () => apiClient.get<{ data: MoonshotScore[] }>('/solana/moonshot/leaderboard'),
    enabled: activeTab === 'moonshot',
    refetchInterval: 30_000,
  });
  const moonshotAlerts = useQuery({
    queryKey: ['moonshot-alerts'],
    queryFn: () => apiClient.get<{ data: MoonshotScore[] }>('/solana/moonshot/alerts?limit=10'),
    enabled: activeTab === 'moonshot',
    refetchInterval: 15_000,
  });

  // ── Mutations ─────────────────────────────────────────────────────
  const swapMutation = useMutation({
    mutationFn: (data: { inputMint: string; outputMint: string; amount: string; slippageBps: number }) =>
      apiClient.post<{ data: { signature: string; success: boolean }; message: string }>('/solana/swap', data),
  });
  const pumpfunToggle = useMutation({
    mutationFn: (running: boolean) =>
      apiClient.post<{ message: string }>(running ? '/solana/pumpfun/monitor/stop' : '/solana/pumpfun/monitor/start', {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pumpfun-monitor'] }),
  });
  const sniperToggle = useMutation({
    mutationFn: (running: boolean) =>
      apiClient.post<{ message: string }>(running ? '/solana/sniper/stop' : '/solana/sniper/start', {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sniper-status'] }),
  });
  const sniperUpdateConfig = useMutation({
    mutationFn: (cfg: Partial<SniperConfig>) =>
      apiClient.put<{ data: SniperConfig }>('/solana/sniper/config', cfg),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sniper-config'] }),
  });
  const sniperExecute = useMutation({
    mutationFn: (data: { mint: string; symbol?: string; name?: string }) =>
      apiClient.post<{ data: SnipeExecution }>('/solana/sniper/execute', data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sniper-status'] }),
  });
  const whaleAdd = useMutation({
    mutationFn: (data: { address: string; label: string }) =>
      apiClient.post<unknown>('/solana/whales/add', data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['whale-list'] }),
  });
  const whaleMonitorToggle = useMutation({
    mutationFn: (running: boolean) =>
      apiClient.post<unknown>(running ? '/solana/whales/monitor/stop' : '/solana/whales/monitor/start', {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['whale-monitor'] }),
  });
  const moonshotScan = useMutation({
    mutationFn: () => apiClient.post<{ data: MoonshotScore[] }>('/solana/moonshot/scan', { limit: 15 }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['moonshot-leaderboard'] });
      queryClient.invalidateQueries({ queryKey: ['moonshot-alerts'] });
    },
  });
  const moonshotScoreOne = useMutation({
    mutationFn: (mint: string) => apiClient.post<{ data: MoonshotScore }>('/solana/moonshot/score', { mint }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['moonshot-leaderboard'] }),
  });

  // ── Derived ───────────────────────────────────────────────────────
  const botConnected = walletQuery.data?.connected ?? false;
  const botWallet = walletQuery.data?.wallet;
  const balances = balanceQuery.data?.data;
  const tokens = scannerTab === 'trending' ? trendingQuery.data?.data : newTokensQuery.data?.data;
  const tokensLoading = scannerTab === 'trending' ? trendingQuery.isLoading : newTokensQuery.isLoading;
  const detail = tokenDetailQuery.data?.data;

  const TABS: Array<{ key: PageTab; label: string; icon: React.ReactNode }> = [
    { key: 'scanner', label: 'Scanner', icon: <TrendingUp className="h-3.5 w-3.5" /> },
    { key: 'pumpfun', label: 'pump.fun', icon: <Rocket className="h-3.5 w-3.5" /> },
    { key: 'sniper', label: 'Sniper', icon: <Crosshair className="h-3.5 w-3.5" /> },
    { key: 'whales', label: 'Whales', icon: <Eye className="h-3.5 w-3.5" /> },
    { key: 'moonshot', label: 'Moonshot AI', icon: <Brain className="h-3.5 w-3.5" /> },
  ];

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Zap className="h-7 w-7 text-purple-400" />
          <h1 className="text-2xl font-bold text-slate-100">Solana Trading</h1>
        </div>
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium ${
            botConnected ? 'border-green-500/30 bg-green-500/10 text-green-400' : 'border-slate-600 bg-slate-800 text-slate-500'
          }`}>
            <Wallet className="h-3.5 w-3.5" />
            Bot: {botConnected ? `${botWallet?.slice(0, 4)}...${botWallet?.slice(-4)}` : 'Not connected'}
          </div>
          <WalletMultiButton className="!bg-purple-600 !rounded-lg !h-8 !text-xs" />
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="SOL Balance" value={balances ? `${balances.solBalance.toFixed(4)} SOL` : '--'} sub={balances ? `$${balances.solValueUsd.toFixed(2)}` : ''} icon={<Zap className="h-4 w-4 text-purple-400" />} />
        <StatCard label="Token Value" value={balances ? `$${balances.tokens.reduce((s, t) => s + t.valueUsd, 0).toFixed(2)}` : '--'} sub={balances ? `${balances.tokens.length} token(s)` : ''} icon={<TrendingUp className="h-4 w-4 text-blue-400" />} />
        <StatCard label="Total Portfolio" value={balances ? `$${balances.totalValueUsd.toFixed(2)}` : '--'} sub="Bot wallet" icon={<Wallet className="h-4 w-4 text-green-400" />} />
        <StatCard label="Phantom" value={phantomConnected ? `${phantomKey?.toBase58().slice(0, 4)}...${phantomKey?.toBase58().slice(-4)}` : 'Not connected'} sub={phantomConnected ? 'Browser wallet' : 'Click connect above'} icon={<Sparkles className="h-4 w-4 text-orange-400" />} />
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 rounded-lg bg-slate-800/50 p-1">
        {TABS.map((tab) => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${
              activeTab === tab.key ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700'
            }`}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* ═══ Tab: Scanner ════════════════════════════════════════════ */}
      {activeTab === 'scanner' && (
        <>
          {/* Quick Swap */}
          <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-4">
            <div className="mb-3 flex items-center gap-2">
              <ArrowRightLeft className="h-5 w-5 text-blue-400" />
              <h2 className="text-sm font-semibold text-slate-200">Quick Swap</h2>
              <div className="ml-auto flex items-center gap-2 text-xs">
                <button onClick={() => setSwapSource('bot')} className={`rounded px-2 py-1 ${swapSource === 'bot' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-400'}`}>Bot Wallet</button>
                <button onClick={() => setSwapSource('phantom')} className={`rounded px-2 py-1 ${swapSource === 'phantom' ? 'bg-purple-600 text-white' : 'bg-slate-700 text-slate-400'}`}>Phantom</button>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
              <div><label className="text-xs text-slate-400">From (mint)</label><input type="text" value={swapInput.inputMint} onChange={(e) => setSwapInput({ ...swapInput, inputMint: e.target.value })} className="input mt-1 w-full text-xs font-mono" /></div>
              <div><label className="text-xs text-slate-400">To (mint)</label><input type="text" value={swapInput.outputMint} onChange={(e) => setSwapInput({ ...swapInput, outputMint: e.target.value })} placeholder="Token mint" className="input mt-1 w-full text-xs font-mono" /></div>
              <div><label className="text-xs text-slate-400">Amount (lamports)</label><input type="text" value={swapInput.amount} onChange={(e) => setSwapInput({ ...swapInput, amount: e.target.value })} placeholder="e.g. 100000000" className="input mt-1 w-full text-xs font-mono" /></div>
              <div><label className="text-xs text-slate-400">Slippage (bps)</label><input type="text" value={swapInput.slippageBps} onChange={(e) => setSwapInput({ ...swapInput, slippageBps: e.target.value })} className="input mt-1 w-full text-xs font-mono" /></div>
              <div className="flex items-end">
                <button onClick={() => { if (swapSource === 'bot') swapMutation.mutate({ inputMint: swapInput.inputMint, outputMint: swapInput.outputMint, amount: swapInput.amount, slippageBps: parseInt(swapInput.slippageBps, 10) }); }} disabled={!swapInput.outputMint || !swapInput.amount || swapMutation.isPending} className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50">
                  {swapMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRightLeft className="h-4 w-4" />} Swap
                </button>
              </div>
            </div>
            {swapMutation.isSuccess && <div className="mt-2 rounded-lg bg-green-500/10 border border-green-500/20 p-2 text-xs text-green-400"><CheckCircle className="inline h-3 w-3 mr-1" />{swapMutation.data?.message}</div>}
            {swapMutation.isError && <div className="mt-2 rounded-lg bg-red-500/10 border border-red-500/20 p-2 text-xs text-red-400"><AlertTriangle className="inline h-3 w-3 mr-1" />{swapMutation.error?.message ?? 'Swap failed'}</div>}
          </div>

          {/* Token Scanner */}
          <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-4">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-200">Token Scanner</h2>
              <div className="flex gap-1">
                <button onClick={() => setScannerTab('trending')} className={`rounded px-3 py-1 text-xs font-medium ${scannerTab === 'trending' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-400'}`}>Trending</button>
                <button onClick={() => setScannerTab('new')} className={`rounded px-3 py-1 text-xs font-medium ${scannerTab === 'new' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-400'}`}>New Launches</button>
              </div>
            </div>
            {tokensLoading ? <div className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-blue-400" /></div> : (
              <TokenTable tokens={tokens ?? []} onSelect={setSelectedToken} onBuy={(mint) => setSwapInput(prev => ({ ...prev, outputMint: mint }))} />
            )}
          </div>

          {/* Token Detail */}
          {selectedToken && detail && <TokenDetailPanel detail={detail} onClose={() => setSelectedToken(null)} />}

          {/* Wallet Tokens */}
          {balances && balances.tokens.length > 0 && (
            <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-4">
              <h2 className="mb-3 text-sm font-semibold text-slate-200">Bot Wallet Tokens</h2>
              <WalletTokenTable tokens={balances.tokens} />
            </div>
          )}
        </>
      )}

      {/* ═══ Tab: pump.fun ═══════════════════════════════════════════ */}
      {activeTab === 'pumpfun' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Rocket className="h-5 w-5 text-pink-400" />
              <h2 className="text-sm font-semibold text-slate-200">pump.fun Monitor</h2>
              <span className={`text-[10px] px-2 py-0.5 rounded-full ${pumpfunStatus.data?.running ? 'bg-green-500/20 text-green-400' : 'bg-slate-700 text-slate-500'}`}>
                {pumpfunStatus.data?.running ? 'LIVE' : 'STOPPED'}
              </span>
            </div>
            <button onClick={() => pumpfunToggle.mutate(pumpfunStatus.data?.running ?? false)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ${pumpfunStatus.data?.running ? 'bg-red-600 text-white' : 'bg-green-600 text-white'}`}>
              {pumpfunStatus.data?.running ? <><Square className="h-3 w-3" /> Stop</> : <><Play className="h-3 w-3" /> Start Monitor</>}
            </button>
          </div>

          {pumpfunStatus.data?.running && (
            <div className="grid grid-cols-3 gap-3">
              <StatCard label="Detected" value={String(pumpfunStatus.data.totalDetected)} sub="new tokens" icon={<Sparkles className="h-4 w-4 text-pink-400" />} />
              <StatCard label="Known Tokens" value={String(pumpfunStatus.data.recentLaunches?.length ?? 0)} sub="in buffer" icon={<Activity className="h-4 w-4 text-blue-400" />} />
              <StatCard label="Status" value="Polling" sub="every 5s" icon={<RefreshCw className="h-4 w-4 text-green-400" />} />
            </div>
          )}

          <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-4">
            <h3 className="mb-3 text-sm font-semibold text-slate-200">Latest pump.fun Launches</h3>
            {pumpfunLatest.isLoading ? <Loader2 className="mx-auto h-6 w-6 animate-spin text-pink-400" /> : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead><tr className="border-b border-slate-700/50 text-slate-400">
                    <th className="pb-2 pr-3">Token</th><th className="pb-2 pr-3 text-right">Market Cap</th>
                    <th className="pb-2 pr-3 text-right">Bonding %</th><th className="pb-2 pr-3 text-right">Replies</th>
                    <th className="pb-2 pr-3">Status</th><th className="pb-2"></th>
                  </tr></thead>
                  <tbody>
                    {(pumpfunLatest.data?.data ?? []).map((t) => (
                      <tr key={t.mint} className="border-b border-slate-700/30 hover:bg-slate-700/20">
                        <td className="py-2 pr-3"><div className="font-medium text-slate-200">{t.symbol}</div><div className="text-[10px] text-slate-500">{t.name.slice(0, 25)}</div></td>
                        <td className="py-2 pr-3 text-right font-mono text-slate-300">${formatCompact(t.usdMarketCap)}</td>
                        <td className="py-2 pr-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <div className="h-1.5 w-16 rounded-full bg-slate-700"><div className="h-1.5 rounded-full bg-pink-500" style={{ width: `${Math.min(100, t.bondingCurveProgress)}%` }} /></div>
                            <span className="text-slate-400 font-mono">{t.bondingCurveProgress.toFixed(0)}%</span>
                          </div>
                        </td>
                        <td className="py-2 pr-3 text-right text-slate-400">{t.replyCount}</td>
                        <td className="py-2 pr-3">
                          {t.graduated ? <span className="text-green-400 text-[10px] font-medium">GRADUATED</span> :
                            t.kingOfTheHill ? <span className="text-yellow-400 text-[10px] font-medium">KOTH</span> :
                            <span className="text-slate-500 text-[10px]">Bonding</span>}
                        </td>
                        <td className="py-2">
                          <button onClick={() => sniperExecute.mutate({ mint: t.mint, symbol: t.symbol, name: t.name })}
                            className="rounded bg-pink-600/20 px-2 py-0.5 text-[10px] font-medium text-pink-400 hover:bg-pink-600/30">Snipe</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══ Tab: Sniper ═════════════════════════════════════════════ */}
      {activeTab === 'sniper' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Crosshair className="h-5 w-5 text-red-400" />
              <h2 className="text-sm font-semibold text-slate-200">Sniping Engine</h2>
              <span className={`text-[10px] px-2 py-0.5 rounded-full ${sniperStatus.data?.running ? 'bg-green-500/20 text-green-400' : 'bg-slate-700 text-slate-500'}`}>
                {sniperStatus.data?.running ? 'ACTIVE' : 'STOPPED'}
              </span>
            </div>
            <button onClick={() => sniperToggle.mutate(sniperStatus.data?.running ?? false)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ${sniperStatus.data?.running ? 'bg-red-600 text-white' : 'bg-green-600 text-white'}`}>
              {sniperStatus.data?.running ? <><Square className="h-3 w-3" /> Stop</> : <><Play className="h-3 w-3" /> Start Sniper</>}
            </button>
          </div>

          {/* Sniper Stats */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Daily Spent" value={`${(sniperStatus.data?.dailySpentSol ?? 0).toFixed(4)} SOL`} sub={`of ${sniperStatus.data?.dailyBudgetSol ?? 0} budget`} icon={<Wallet className="h-4 w-4 text-red-400" />} />
            <StatCard label="Open Positions" value={String((sniperStatus.data?.openPositions ?? []).length)} sub={`max ${sniperConfig.data?.data?.maxOpenPositions ?? 5}`} icon={<Target className="h-4 w-4 text-blue-400" />} />
            <StatCard label="Buy Amount" value={`${sniperConfig.data?.data?.buyAmountSol ?? 0.05} SOL`} sub="per snipe" icon={<Crosshair className="h-4 w-4 text-orange-400" />} />
            <StatCard label="Take Profit" value={`+${sniperConfig.data?.data?.takeProfitPercent ?? 100}%`} sub={`SL: ${sniperConfig.data?.data?.stopLossPercent ?? -50}%`} icon={<TrendingUp className="h-4 w-4 text-green-400" />} />
          </div>

          {/* Config */}
          <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-4">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-200"><Settings className="h-4 w-4" /> Configuration</h3>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 text-xs">
              <ConfigInput label="Buy Amount (SOL)" value={sniperConfig.data?.data?.buyAmountSol} onChange={(v) => sniperUpdateConfig.mutate({ buyAmountSol: parseFloat(v) })} />
              <ConfigInput label="Daily Budget (SOL)" value={sniperConfig.data?.data?.dailyBudgetSol} onChange={(v) => sniperUpdateConfig.mutate({ dailyBudgetSol: parseFloat(v) })} />
              <ConfigInput label="Take Profit %" value={sniperConfig.data?.data?.takeProfitPercent} onChange={(v) => sniperUpdateConfig.mutate({ takeProfitPercent: parseFloat(v) })} />
              <ConfigInput label="Stop Loss %" value={sniperConfig.data?.data?.stopLossPercent} onChange={(v) => sniperUpdateConfig.mutate({ stopLossPercent: parseFloat(v) })} />
              <ConfigInput label="Slippage (bps)" value={sniperConfig.data?.data?.slippageBps} onChange={(v) => sniperUpdateConfig.mutate({ slippageBps: parseInt(v) })} />
              <ConfigInput label="Priority Fee (μ-lam)" value={sniperConfig.data?.data?.priorityFee} onChange={(v) => sniperUpdateConfig.mutate({ priorityFee: parseInt(v) })} />
              <ConfigInput label="Max Market Cap $" value={sniperConfig.data?.data?.maxMarketCapUsd} onChange={(v) => sniperUpdateConfig.mutate({ maxMarketCapUsd: parseFloat(v) })} />
              <ConfigInput label="Max Positions" value={sniperConfig.data?.data?.maxOpenPositions} onChange={(v) => sniperUpdateConfig.mutate({ maxOpenPositions: parseInt(v) })} />
            </div>
            <div className="mt-3 flex gap-4 text-xs">
              <label className="flex items-center gap-2 text-slate-400">
                <input type="checkbox" checked={sniperConfig.data?.data?.autoBuyPumpFun ?? false} onChange={(e) => sniperUpdateConfig.mutate({ autoBuyPumpFun: e.target.checked })} className="rounded bg-slate-700" /> Auto-snipe pump.fun
              </label>
              <label className="flex items-center gap-2 text-slate-400">
                <input type="checkbox" checked={sniperConfig.data?.data?.autoBuyTrending ?? false} onChange={(e) => sniperUpdateConfig.mutate({ autoBuyTrending: e.target.checked })} className="rounded bg-slate-700" /> Auto-snipe trending
              </label>
            </div>
          </div>

          {/* Recent Executions */}
          <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-4">
            <h3 className="mb-3 text-sm font-semibold text-slate-200">Recent Executions</h3>
            <div className="space-y-1.5">
              {(sniperStatus.data?.recentExecutions ?? []).map((ex) => (
                <div key={ex.id} className={`flex items-center justify-between rounded-lg border p-2 text-xs ${
                  ex.status === 'success' ? 'border-green-500/20 bg-green-500/5' : ex.status === 'failed' ? 'border-red-500/20 bg-red-500/5' : 'border-slate-700/30 bg-slate-900/20'
                }`}>
                  <div className="flex items-center gap-2">
                    <span className={`font-bold ${ex.action === 'buy' ? 'text-green-400' : 'text-red-400'}`}>{ex.action.toUpperCase()}</span>
                    <span className="text-slate-200">{ex.symbol}</span>
                    <span className="text-slate-500">({ex.trigger})</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-slate-400">{ex.amountSol.toFixed(4)} SOL</span>
                    <span className={ex.status === 'success' ? 'text-green-400' : ex.status === 'failed' ? 'text-red-400' : 'text-yellow-400'}>
                      {ex.status}
                    </span>
                  </div>
                </div>
              ))}
              {(sniperStatus.data?.recentExecutions ?? []).length === 0 && <div className="text-center text-slate-500 py-4">No executions yet</div>}
            </div>
          </div>
        </div>
      )}

      {/* ═══ Tab: Whales ═════════════════════════════════════════════ */}
      {activeTab === 'whales' && <WhalesTab
        whaleList={whaleList.data?.data ?? []}
        activity={whaleActivity.data?.data ?? []}
        monitorRunning={whaleMonitorStatus.data?.running ?? false}
        onToggleMonitor={() => whaleMonitorToggle.mutate(whaleMonitorStatus.data?.running ?? false)}
        onAddWhale={(addr, label) => whaleAdd.mutate({ address: addr, label })}
      />}

      {/* ═══ Tab: Moonshot AI ════════════════════════════════════════ */}
      {activeTab === 'moonshot' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Brain className="h-5 w-5 text-violet-400" />
              <h2 className="text-sm font-semibold text-slate-200">Moonshot Scoring AI</h2>
            </div>
            <button onClick={() => moonshotScan.mutate()} disabled={moonshotScan.isPending}
              className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50">
              {moonshotScan.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Scan Trending
            </button>
          </div>

          {/* Alerts */}
          {(moonshotAlerts.data?.data ?? []).length > 0 && (
            <div className="rounded-xl border border-violet-500/30 bg-violet-500/5 p-4">
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-violet-300"><AlertTriangle className="h-4 w-4" /> High Score Alerts</h3>
              <div className="flex flex-wrap gap-2">
                {(moonshotAlerts.data?.data ?? []).slice(0, 5).map(a => (
                  <div key={a.mint} className="rounded-lg border border-violet-500/20 bg-slate-800 px-3 py-1.5 text-xs">
                    <span className="font-bold text-violet-400">{a.score}</span>
                    <span className="mx-1 text-slate-300">{a.symbol}</span>
                    <span className={`text-[10px] ${a.recommendation === 'strong_buy' ? 'text-green-400' : a.recommendation === 'buy' ? 'text-blue-400' : 'text-slate-500'}`}>
                      {a.recommendation.replace('_', ' ').toUpperCase()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Leaderboard */}
          <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-4">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-200"><Award className="h-4 w-4 text-yellow-400" /> Leaderboard</h3>
            {moonshotScan.isPending ? <Loader2 className="mx-auto h-6 w-6 animate-spin text-violet-400" /> : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead><tr className="border-b border-slate-700/50 text-slate-400">
                    <th className="pb-2 pr-3">Score</th><th className="pb-2 pr-3">Token</th>
                    <th className="pb-2 pr-3 text-right">Price</th><th className="pb-2 pr-3 text-right">MCap</th>
                    <th className="pb-2 pr-3 text-right">24h %</th><th className="pb-2 pr-3">Rug Risk</th>
                    <th className="pb-2 pr-3">Signal</th><th className="pb-2"></th>
                  </tr></thead>
                  <tbody>
                    {(moonshotLeaderboard.data?.data ?? []).map((m) => (
                      <tr key={m.mint} className="border-b border-slate-700/30 hover:bg-slate-700/20">
                        <td className="py-2 pr-3">
                          <span className={`font-bold text-lg ${m.score >= 70 ? 'text-green-400' : m.score >= 50 ? 'text-yellow-400' : m.score >= 30 ? 'text-orange-400' : 'text-red-400'}`}>{m.score}</span>
                        </td>
                        <td className="py-2 pr-3"><div className="font-medium text-slate-200">{m.symbol}</div><div className="text-[10px] text-slate-500">{m.name.slice(0, 20)}</div></td>
                        <td className="py-2 pr-3 text-right font-mono text-slate-200">${m.priceUsd < 0.01 ? m.priceUsd.toExponential(2) : m.priceUsd.toFixed(4)}</td>
                        <td className="py-2 pr-3 text-right font-mono text-slate-300">${formatCompact(m.marketCap)}</td>
                        <td className={`py-2 pr-3 text-right font-mono ${m.priceChange24h >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {m.priceChange24h >= 0 ? '+' : ''}{m.priceChange24h.toFixed(1)}%
                        </td>
                        <td className="py-2 pr-3">
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                            m.rugRisk === 'low' ? 'bg-green-500/20 text-green-400' : m.rugRisk === 'medium' ? 'bg-yellow-500/20 text-yellow-400' : m.rugRisk === 'high' ? 'bg-orange-500/20 text-orange-400' : 'bg-red-500/20 text-red-400'
                          }`}>{m.rugRisk.toUpperCase()}</span>
                        </td>
                        <td className="py-2 pr-3">
                          <span className={`text-[10px] font-medium ${
                            m.recommendation === 'strong_buy' ? 'text-green-400' : m.recommendation === 'buy' ? 'text-blue-400' : m.recommendation === 'hold' ? 'text-slate-400' : 'text-red-400'
                          }`}>{m.recommendation.replace('_', ' ').toUpperCase()}</span>
                        </td>
                        <td className="py-2">
                          <button onClick={() => sniperExecute.mutate({ mint: m.mint, symbol: m.symbol, name: m.name })}
                            className="rounded bg-violet-600/20 px-2 py-0.5 text-[10px] font-medium text-violet-400 hover:bg-violet-600/30">Snipe</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────

function StatCard({ label, value, sub, icon }: { label: string; value: string; sub: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-4">
      <div className="flex items-center justify-between mb-1"><span className="text-xs text-slate-400">{label}</span>{icon}</div>
      <div className="text-lg font-bold text-slate-100">{value}</div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

function SafetyCheck({ label, passed, passText, failText }: { label: string; passed: boolean; passText: string; failText: string }) {
  return (
    <div className={`flex items-center gap-2 rounded-lg border p-2 ${passed ? 'border-green-500/30 bg-green-500/5' : 'border-red-500/30 bg-red-500/5'}`}>
      {passed ? <CheckCircle className="h-4 w-4 text-green-400" /> : <ShieldOff className="h-4 w-4 text-red-400" />}
      <div><div className="text-[10px] text-slate-400">{label}</div><div className={`text-xs font-medium ${passed ? 'text-green-400' : 'text-red-400'}`}>{passed ? passText : failText}</div></div>
    </div>
  );
}

function ConfigInput({ label, value, onChange }: { label: string; value: unknown; onChange: (v: string) => void }) {
  const [local, setLocal] = useState(String(value ?? ''));
  useEffect(() => { setLocal(String(value ?? '')); }, [value]);
  return (
    <div>
      <label className="text-[10px] text-slate-400">{label}</label>
      <input type="text" value={local} onChange={(e) => setLocal(e.target.value)}
        onBlur={() => { if (local !== String(value ?? '')) onChange(local); }}
        onKeyDown={(e) => { if (e.key === 'Enter') onChange(local); }}
        className="input mt-0.5 w-full text-xs font-mono" />
    </div>
  );
}

function TokenTable({ tokens, onSelect, onBuy }: { tokens: TokenInfo[]; onSelect: (mint: string) => void; onBuy: (mint: string) => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead><tr className="border-b border-slate-700/50 text-slate-400">
          <th className="pb-2 pr-4">Token</th><th className="pb-2 pr-4 text-right">Price</th>
          <th className="pb-2 pr-4 text-right">24h %</th><th className="pb-2 pr-4 text-right">Volume</th>
          <th className="pb-2 pr-4 text-right">Liquidity</th><th className="pb-2 pr-4 text-right">Market Cap</th><th className="pb-2"></th>
        </tr></thead>
        <tbody>
          {tokens.map((token) => (
            <tr key={token.mint} className="border-b border-slate-700/30 hover:bg-slate-700/20 cursor-pointer" onClick={() => onSelect(token.mint)}>
              <td className="py-2 pr-4"><div className="font-medium text-slate-200">{token.symbol}</div><div className="text-[10px] text-slate-500">{token.name.slice(0, 20)}</div></td>
              <td className="py-2 pr-4 text-right font-mono text-slate-200">${token.priceUsd < 0.01 ? token.priceUsd.toExponential(2) : token.priceUsd.toFixed(4)}</td>
              <td className={`py-2 pr-4 text-right font-mono ${token.priceChange24h >= 0 ? 'text-green-400' : 'text-red-400'}`}>{token.priceChange24h >= 0 ? '+' : ''}{token.priceChange24h.toFixed(1)}%</td>
              <td className="py-2 pr-4 text-right font-mono text-slate-300">${formatCompact(token.volume24h)}</td>
              <td className="py-2 pr-4 text-right font-mono text-slate-300">${formatCompact(token.liquidity)}</td>
              <td className="py-2 pr-4 text-right font-mono text-slate-300">${formatCompact(token.marketCap)}</td>
              <td className="py-2 text-right"><button onClick={(e) => { e.stopPropagation(); onBuy(token.mint); }}
                className="rounded bg-blue-600/20 px-2 py-0.5 text-[10px] font-medium text-blue-400 hover:bg-blue-600/30">Buy</button></td>
            </tr>
          ))}
          {tokens.length === 0 && <tr><td colSpan={7} className="py-8 text-center text-slate-500">No tokens found</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function TokenDetailPanel({ detail, onClose }: { detail: { token: TokenInfo | null; safety: TokenSafety }; onClose: () => void }) {
  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-slate-200">{detail.token?.symbol ?? 'Token'} — Safety Analysis</h2>
        <button onClick={onClose} className="text-xs text-slate-500 hover:text-slate-300">Close</button>
      </div>
      {detail.token && (
        <div className="grid grid-cols-2 gap-3 mb-4 text-xs lg:grid-cols-4">
          <div><span className="text-slate-400">Price:</span> <span className="text-slate-200 font-mono">${detail.token.priceUsd < 0.01 ? detail.token.priceUsd.toExponential(2) : detail.token.priceUsd.toFixed(6)}</span></div>
          <div><span className="text-slate-400">Volume 24h:</span> <span className="text-slate-200 font-mono">${formatCompact(detail.token.volume24h)}</span></div>
          <div><span className="text-slate-400">Liquidity:</span> <span className="text-slate-200 font-mono">${formatCompact(detail.token.liquidity)}</span></div>
          <div><span className="text-slate-400">Market Cap:</span> <span className="text-slate-200 font-mono">${formatCompact(detail.token.marketCap)}</span></div>
        </div>
      )}
      <div className="space-y-2">
        <span className={`text-xs font-bold px-2 py-0.5 rounded ${
          detail.safety.riskLevel === 'low' ? 'bg-green-500/20 text-green-400' : detail.safety.riskLevel === 'medium' ? 'bg-yellow-500/20 text-yellow-400' : detail.safety.riskLevel === 'high' ? 'bg-orange-500/20 text-orange-400' : 'bg-red-500/20 text-red-400'
        }`}>Risk: {detail.safety.riskLevel.toUpperCase()}</span>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 text-xs">
          <SafetyCheck label="Mint Authority" passed={detail.safety.mintAuthorityRevoked} passText="Revoked" failText="NOT Revoked" />
          <SafetyCheck label="Freeze Authority" passed={detail.safety.freezeAuthorityRevoked} passText="Revoked" failText="NOT Revoked" />
          <div className="flex items-center gap-2 rounded-lg border border-slate-700/50 bg-slate-900/50 p-2">
            <Shield className="h-4 w-4 text-slate-400" /><span className="text-slate-400">Top 10:</span>
            <span className="text-slate-200 font-mono">{detail.safety.top10HolderPercent !== null ? `${detail.safety.top10HolderPercent.toFixed(1)}%` : 'N/A'}</span>
          </div>
        </div>
        {detail.safety.warnings.length > 0 && <div className="mt-2 space-y-1">{detail.safety.warnings.map((w, i) => (
          <div key={i} className="flex items-start gap-1.5 text-xs text-yellow-400"><AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />{w}</div>
        ))}</div>}
        {detail.token?.url && <a href={detail.token.url} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 mt-2">View on Dexscreener <ExternalLink className="h-3 w-3" /></a>}
      </div>
    </div>
  );
}

function WalletTokenTable({ tokens }: { tokens: SolanaTokenBalance[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead><tr className="border-b border-slate-700/50 text-slate-400"><th className="pb-2 pr-4">Token</th><th className="pb-2 pr-4 text-right">Amount</th><th className="pb-2 pr-4 text-right">Value</th><th className="pb-2 text-right">Mint</th></tr></thead>
        <tbody>{tokens.map((t) => (
          <tr key={t.mint} className="border-b border-slate-700/30">
            <td className="py-2 pr-4 font-medium text-slate-200">{t.symbol}</td>
            <td className="py-2 pr-4 text-right font-mono text-slate-300">{t.amount.toFixed(4)}</td>
            <td className="py-2 pr-4 text-right font-mono text-slate-300">${t.valueUsd.toFixed(2)}</td>
            <td className="py-2 text-right font-mono text-slate-500 text-[10px]">{t.mint.slice(0, 8)}...{t.mint.slice(-4)}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function WhalesTab({ whaleList, activity, monitorRunning, onToggleMonitor, onAddWhale }: {
  whaleList: Array<{ address: string; label: string; totalTxns: number; lastActivity: string | null }>;
  activity: WhaleActivity[]; monitorRunning: boolean;
  onToggleMonitor: () => void; onAddWhale: (addr: string, label: string) => void;
}) {
  const [newAddr, setNewAddr] = useState('');
  const [newLabel, setNewLabel] = useState('');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Eye className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-slate-200">Whale Tracker</h2>
          <span className={`text-[10px] px-2 py-0.5 rounded-full ${monitorRunning ? 'bg-green-500/20 text-green-400' : 'bg-slate-700 text-slate-500'}`}>
            {monitorRunning ? 'TRACKING' : 'STOPPED'}
          </span>
        </div>
        <button onClick={onToggleMonitor}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ${monitorRunning ? 'bg-red-600 text-white' : 'bg-green-600 text-white'}`}>
          {monitorRunning ? <><Square className="h-3 w-3" /> Stop</> : <><Play className="h-3 w-3" /> Start Tracking</>}
        </button>
      </div>

      {/* Add Whale */}
      <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-200"><Plus className="h-4 w-4" /> Add Whale Wallet</h3>
        <div className="flex gap-3">
          <input type="text" placeholder="Solana address" value={newAddr} onChange={(e) => setNewAddr(e.target.value)} className="input flex-1 text-xs font-mono" />
          <input type="text" placeholder="Label" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} className="input w-32 text-xs" />
          <button onClick={() => { if (newAddr) { onAddWhale(newAddr, newLabel || 'Whale'); setNewAddr(''); setNewLabel(''); } }}
            className="btn-primary px-4 text-xs">Add</button>
        </div>
      </div>

      {/* Tracked Whales */}
      <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-4">
        <h3 className="mb-3 text-sm font-semibold text-slate-200">Tracked Wallets ({whaleList.length})</h3>
        <div className="space-y-1.5">
          {whaleList.map((w) => (
            <div key={w.address} className="flex items-center justify-between rounded-lg border border-slate-700/30 bg-slate-900/20 p-2 text-xs">
              <div><span className="font-medium text-cyan-400">{w.label}</span><span className="ml-2 font-mono text-slate-500">{w.address.slice(0, 8)}...{w.address.slice(-4)}</span></div>
              <div className="text-slate-400">{w.totalTxns} txns</div>
            </div>
          ))}
          {whaleList.length === 0 && <div className="text-center text-slate-500 py-4">No whales tracked yet — add one above</div>}
        </div>
      </div>

      {/* Activity Feed */}
      <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-200"><Activity className="h-4 w-4" /> Activity Feed</h3>
        <div className="space-y-1.5">
          {activity.map((a) => (
            <div key={a.id} className={`flex items-center justify-between rounded-lg border p-2 text-xs ${
              a.type === 'buy' ? 'border-green-500/20 bg-green-500/5' : 'border-red-500/20 bg-red-500/5'
            }`}>
              <div className="flex items-center gap-2">
                <span className={`font-bold ${a.type === 'buy' ? 'text-green-400' : 'text-red-400'}`}>{a.type.toUpperCase()}</span>
                <span className="text-slate-200">{a.tokenSymbol}</span>
                <span className="text-slate-500">by {a.whaleLabel}</span>
                {a.copied && <Copy className="h-3 w-3 text-cyan-400" title="Copy-traded" />}
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-slate-300">${formatCompact(a.amountUsd)}</span>
                <span className="text-slate-500 text-[10px]">{new Date(a.timestamp).toLocaleTimeString()}</span>
              </div>
            </div>
          ))}
          {activity.length === 0 && <div className="text-center text-slate-500 py-4">No whale activity detected yet</div>}
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────

function formatCompact(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(2);
}
