import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import {
  Zap,
  Wallet,
  ArrowRightLeft,
  TrendingUp,
  Sparkles,
  Shield,
  ShieldAlert,
  ShieldOff,
  ExternalLink,
  Loader2,
  AlertTriangle,
  CheckCircle,
  RefreshCw,
} from 'lucide-react';
import { apiClient } from '@/lib/api-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SolanaTokenBalance {
  mint: string;
  symbol: string;
  name: string;
  amount: number;
  decimals: number;
  valueUsd: number;
  logoUri?: string;
}

interface SolanaBalanceData {
  wallet: string;
  rpcUrl: string;
  solBalance: number;
  solValueUsd: number;
  tokens: SolanaTokenBalance[];
  totalValueUsd: number;
}

interface TokenInfo {
  mint: string;
  symbol: string;
  name: string;
  priceUsd: number;
  priceChange24h: number;
  volume24h: number;
  liquidity: number;
  marketCap: number;
  pairCreatedAt: string | null;
  imageUrl: string | null;
  url: string;
}

interface TokenSafety {
  mintAuthorityRevoked: boolean;
  freezeAuthorityRevoked: boolean;
  top10HolderPercent: number | null;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SolanaPage() {
  const [scannerTab, setScannerTab] = useState<'trending' | 'new'>('trending');
  const [selectedToken, setSelectedToken] = useState<string | null>(null);
  const [swapInput, setSwapInput] = useState({ inputMint: 'So11111111111111111111111111111111111111112', outputMint: '', amount: '', slippageBps: '300' });
  const [swapSource, setSwapSource] = useState<'bot' | 'phantom'>('bot');

  const { publicKey: phantomKey, connected: phantomConnected } = useWallet();

  // ── Queries ────────────────────────────────────────────────────────

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
    enabled: scannerTab === 'new',
    refetchInterval: 60_000,
  });

  const tokenDetailQuery = useQuery({
    queryKey: ['solana-token', selectedToken],
    queryFn: () => apiClient.get<{ data: { token: TokenInfo | null; safety: TokenSafety } }>(`/solana/token/${selectedToken}`),
    enabled: !!selectedToken,
  });

  // ── Swap mutation ──────────────────────────────────────────────────

  const swapMutation = useMutation({
    mutationFn: (data: { inputMint: string; outputMint: string; amount: string; slippageBps: number }) =>
      apiClient.post<{ data: { signature: string; success: boolean }; message: string }>('/solana/swap', data),
  });

  // ── Derived data ───────────────────────────────────────────────────

  const botConnected = walletQuery.data?.connected ?? false;
  const botWallet = walletQuery.data?.wallet;
  const balances = balanceQuery.data?.data;
  const tokens = scannerTab === 'trending' ? trendingQuery.data?.data : newTokensQuery.data?.data;
  const tokensLoading = scannerTab === 'trending' ? trendingQuery.isLoading : newTokensQuery.isLoading;
  const detail = tokenDetailQuery.data?.data;

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Zap className="h-7 w-7 text-purple-400" />
          <h1 className="text-2xl font-bold text-slate-100">Solana Trading</h1>
        </div>
        <div className="flex items-center gap-3">
          {/* Bot wallet badge */}
          <div className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium ${
            botConnected
              ? 'border-green-500/30 bg-green-500/10 text-green-400'
              : 'border-slate-600 bg-slate-800 text-slate-500'
          }`}>
            <Wallet className="h-3.5 w-3.5" />
            Bot: {botConnected ? `${botWallet?.slice(0, 4)}...${botWallet?.slice(-4)}` : 'Not connected'}
          </div>
          {/* Phantom wallet button */}
          <WalletMultiButton className="!bg-purple-600 !rounded-lg !h-8 !text-xs" />
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="SOL Balance"
          value={balances ? `${balances.solBalance.toFixed(4)} SOL` : '--'}
          sub={balances ? `$${balances.solValueUsd.toFixed(2)}` : ''}
          icon={<Zap className="h-4 w-4 text-purple-400" />}
        />
        <StatCard
          label="Token Value"
          value={balances ? `$${balances.tokens.reduce((s, t) => s + t.valueUsd, 0).toFixed(2)}` : '--'}
          sub={balances ? `${balances.tokens.length} token(s)` : ''}
          icon={<TrendingUp className="h-4 w-4 text-blue-400" />}
        />
        <StatCard
          label="Total Portfolio"
          value={balances ? `$${balances.totalValueUsd.toFixed(2)}` : '--'}
          sub="Bot wallet"
          icon={<Wallet className="h-4 w-4 text-green-400" />}
        />
        <StatCard
          label="Phantom"
          value={phantomConnected ? `${phantomKey?.toBase58().slice(0, 4)}...${phantomKey?.toBase58().slice(-4)}` : 'Not connected'}
          sub={phantomConnected ? 'Browser wallet' : 'Click connect above'}
          icon={<Sparkles className="h-4 w-4 text-orange-400" />}
        />
      </div>

      {/* Quick Swap Panel */}
      <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-4">
        <div className="mb-3 flex items-center gap-2">
          <ArrowRightLeft className="h-5 w-5 text-blue-400" />
          <h2 className="text-sm font-semibold text-slate-200">Quick Swap</h2>
          <div className="ml-auto flex items-center gap-2 text-xs">
            <button
              onClick={() => setSwapSource('bot')}
              className={`rounded px-2 py-1 ${swapSource === 'bot' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-400'}`}
            >
              Bot Wallet
            </button>
            <button
              onClick={() => setSwapSource('phantom')}
              className={`rounded px-2 py-1 ${swapSource === 'phantom' ? 'bg-purple-600 text-white' : 'bg-slate-700 text-slate-400'}`}
            >
              Phantom
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
          <div>
            <label className="text-xs text-slate-400">From (mint)</label>
            <input
              type="text"
              value={swapInput.inputMint}
              onChange={(e) => setSwapInput({ ...swapInput, inputMint: e.target.value })}
              placeholder="SOL mint"
              className="input mt-1 w-full text-xs font-mono"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400">To (mint)</label>
            <input
              type="text"
              value={swapInput.outputMint}
              onChange={(e) => setSwapInput({ ...swapInput, outputMint: e.target.value })}
              placeholder="Token mint address"
              className="input mt-1 w-full text-xs font-mono"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400">Amount (lamports)</label>
            <input
              type="text"
              value={swapInput.amount}
              onChange={(e) => setSwapInput({ ...swapInput, amount: e.target.value })}
              placeholder="e.g. 100000000"
              className="input mt-1 w-full text-xs font-mono"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400">Slippage (bps)</label>
            <input
              type="text"
              value={swapInput.slippageBps}
              onChange={(e) => setSwapInput({ ...swapInput, slippageBps: e.target.value })}
              placeholder="300"
              className="input mt-1 w-full text-xs font-mono"
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={() => {
                if (swapSource === 'bot') {
                  swapMutation.mutate({
                    inputMint: swapInput.inputMint,
                    outputMint: swapInput.outputMint,
                    amount: swapInput.amount,
                    slippageBps: parseInt(swapInput.slippageBps, 10),
                  });
                }
              }}
              disabled={!swapInput.outputMint || !swapInput.amount || swapMutation.isPending}
              className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {swapMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRightLeft className="h-4 w-4" />}
              Swap
            </button>
          </div>
        </div>

        {swapMutation.isSuccess && (
          <div className="mt-2 rounded-lg bg-green-500/10 border border-green-500/20 p-2 text-xs text-green-400">
            <CheckCircle className="inline h-3 w-3 mr-1" />
            {swapMutation.data?.message} — Signature: {swapMutation.data?.data?.signature?.slice(0, 16)}...
          </div>
        )}
        {swapMutation.isError && (
          <div className="mt-2 rounded-lg bg-red-500/10 border border-red-500/20 p-2 text-xs text-red-400">
            <AlertTriangle className="inline h-3 w-3 mr-1" />
            {swapMutation.error?.message ?? 'Swap failed'}
          </div>
        )}
        {swapSource === 'phantom' && !phantomConnected && (
          <div className="mt-2 text-xs text-yellow-400">Connect Phantom wallet above to swap via browser wallet.</div>
        )}
      </div>

      {/* Token Scanner */}
      <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-4">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-200">Token Scanner</h2>
          <div className="flex gap-1">
            <button
              onClick={() => setScannerTab('trending')}
              className={`rounded px-3 py-1 text-xs font-medium ${scannerTab === 'trending' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-400'}`}
            >
              Trending
            </button>
            <button
              onClick={() => setScannerTab('new')}
              className={`rounded px-3 py-1 text-xs font-medium ${scannerTab === 'new' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-400'}`}
            >
              New Launches
            </button>
          </div>
        </div>

        {tokensLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-blue-400" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-700/50 text-slate-400">
                  <th className="pb-2 pr-4">Token</th>
                  <th className="pb-2 pr-4 text-right">Price</th>
                  <th className="pb-2 pr-4 text-right">24h %</th>
                  <th className="pb-2 pr-4 text-right">Volume</th>
                  <th className="pb-2 pr-4 text-right">Liquidity</th>
                  <th className="pb-2 pr-4 text-right">Market Cap</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {(tokens ?? []).map((token) => (
                  <tr
                    key={token.mint}
                    className="border-b border-slate-700/30 hover:bg-slate-700/20 cursor-pointer"
                    onClick={() => setSelectedToken(token.mint)}
                  >
                    <td className="py-2 pr-4">
                      <div className="flex items-center gap-2">
                        <div>
                          <div className="font-medium text-slate-200">{token.symbol}</div>
                          <div className="text-[10px] text-slate-500">{token.name.slice(0, 20)}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-2 pr-4 text-right font-mono text-slate-200">
                      ${token.priceUsd < 0.01 ? token.priceUsd.toExponential(2) : token.priceUsd.toFixed(4)}
                    </td>
                    <td className={`py-2 pr-4 text-right font-mono ${token.priceChange24h >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {token.priceChange24h >= 0 ? '+' : ''}{token.priceChange24h.toFixed(1)}%
                    </td>
                    <td className="py-2 pr-4 text-right font-mono text-slate-300">
                      ${formatCompact(token.volume24h)}
                    </td>
                    <td className="py-2 pr-4 text-right font-mono text-slate-300">
                      ${formatCompact(token.liquidity)}
                    </td>
                    <td className="py-2 pr-4 text-right font-mono text-slate-300">
                      ${formatCompact(token.marketCap)}
                    </td>
                    <td className="py-2 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSwapInput(prev => ({ ...prev, outputMint: token.mint }));
                        }}
                        className="rounded bg-blue-600/20 px-2 py-0.5 text-[10px] font-medium text-blue-400 hover:bg-blue-600/30"
                      >
                        Buy
                      </button>
                    </td>
                  </tr>
                ))}
                {(tokens ?? []).length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-500">
                      No tokens found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Token Detail Panel */}
      {selectedToken && detail && (
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-200">
              {detail.token?.symbol ?? 'Token'} — Safety Analysis
            </h2>
            <button onClick={() => setSelectedToken(null)} className="text-xs text-slate-500 hover:text-slate-300">
              Close
            </button>
          </div>

          {detail.token && (
            <div className="grid grid-cols-2 gap-3 mb-4 text-xs lg:grid-cols-4">
              <div><span className="text-slate-400">Price:</span> <span className="text-slate-200 font-mono">${detail.token.priceUsd < 0.01 ? detail.token.priceUsd.toExponential(2) : detail.token.priceUsd.toFixed(6)}</span></div>
              <div><span className="text-slate-400">Volume 24h:</span> <span className="text-slate-200 font-mono">${formatCompact(detail.token.volume24h)}</span></div>
              <div><span className="text-slate-400">Liquidity:</span> <span className="text-slate-200 font-mono">${formatCompact(detail.token.liquidity)}</span></div>
              <div><span className="text-slate-400">Market Cap:</span> <span className="text-slate-200 font-mono">${formatCompact(detail.token.marketCap)}</span></div>
            </div>
          )}

          {/* Safety checks */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                detail.safety.riskLevel === 'low' ? 'bg-green-500/20 text-green-400' :
                detail.safety.riskLevel === 'medium' ? 'bg-yellow-500/20 text-yellow-400' :
                detail.safety.riskLevel === 'high' ? 'bg-orange-500/20 text-orange-400' :
                'bg-red-500/20 text-red-400'
              }`}>
                Risk: {detail.safety.riskLevel.toUpperCase()}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 text-xs">
              <SafetyCheck
                label="Mint Authority"
                passed={detail.safety.mintAuthorityRevoked}
                passText="Revoked"
                failText="NOT Revoked"
              />
              <SafetyCheck
                label="Freeze Authority"
                passed={detail.safety.freezeAuthorityRevoked}
                passText="Revoked"
                failText="NOT Revoked"
              />
              <div className="flex items-center gap-2 rounded-lg border border-slate-700/50 bg-slate-900/50 p-2">
                <Shield className="h-4 w-4 text-slate-400" />
                <span className="text-slate-400">Top 10 Holders:</span>
                <span className="text-slate-200 font-mono">
                  {detail.safety.top10HolderPercent !== null
                    ? `${detail.safety.top10HolderPercent.toFixed(1)}%`
                    : 'N/A'}
                </span>
              </div>
            </div>

            {detail.safety.warnings.length > 0 && (
              <div className="mt-2 space-y-1">
                {detail.safety.warnings.map((w, i) => (
                  <div key={i} className="flex items-start gap-1.5 text-xs text-yellow-400">
                    <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                    {w}
                  </div>
                ))}
              </div>
            )}

            {detail.token?.url && (
              <a
                href={detail.token.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 mt-2"
              >
                View on Dexscreener <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        </div>
      )}

      {/* Wallet Tokens */}
      {balances && balances.tokens.length > 0 && (
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-200">Bot Wallet Tokens</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-700/50 text-slate-400">
                  <th className="pb-2 pr-4">Token</th>
                  <th className="pb-2 pr-4 text-right">Amount</th>
                  <th className="pb-2 pr-4 text-right">Value</th>
                  <th className="pb-2 text-right">Mint</th>
                </tr>
              </thead>
              <tbody>
                {balances.tokens.map((token) => (
                  <tr key={token.mint} className="border-b border-slate-700/30">
                    <td className="py-2 pr-4 font-medium text-slate-200">{token.symbol}</td>
                    <td className="py-2 pr-4 text-right font-mono text-slate-300">{token.amount.toFixed(4)}</td>
                    <td className="py-2 pr-4 text-right font-mono text-slate-300">${token.valueUsd.toFixed(2)}</td>
                    <td className="py-2 text-right font-mono text-slate-500 text-[10px]">
                      {token.mint.slice(0, 8)}...{token.mint.slice(-4)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────

function StatCard({ label, value, sub, icon }: { label: string; value: string; sub: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-4">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-slate-400">{label}</span>
        {icon}
      </div>
      <div className="text-lg font-bold text-slate-100">{value}</div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

function SafetyCheck({ label, passed, passText, failText }: { label: string; passed: boolean; passText: string; failText: string }) {
  return (
    <div className={`flex items-center gap-2 rounded-lg border p-2 ${
      passed ? 'border-green-500/30 bg-green-500/5' : 'border-red-500/30 bg-red-500/5'
    }`}>
      {passed ? <CheckCircle className="h-4 w-4 text-green-400" /> : <ShieldOff className="h-4 w-4 text-red-400" />}
      <div>
        <div className="text-[10px] text-slate-400">{label}</div>
        <div className={`text-xs font-medium ${passed ? 'text-green-400' : 'text-red-400'}`}>
          {passed ? passText : failText}
        </div>
      </div>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────

function formatCompact(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(2);
}
