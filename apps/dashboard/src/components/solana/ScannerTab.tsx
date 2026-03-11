import { useState, useMemo } from 'react';
import { ArrowRightLeft, Loader2, AlertTriangle, CheckCircle, Search, Shield, ShieldOff } from 'lucide-react';
import { TokenTable, WalletTokenTable } from '@/components/solana/TokenPanels';
import { TokenDetailPanel } from '@/components/solana/TokenDetailPanel';
import { useTrending, useNewTokens, useTokenDetail, useSwap } from '@/hooks/useSolana';
import type { SolanaBalanceData, TokenInfo } from '@/types/solana';

interface ScannerTabProps {
  balances: SolanaBalanceData | undefined;
}

function applyFilters(tokens: TokenInfo[], search: string, filters: SafetyFilters): TokenInfo[] {
  let filtered = tokens;
  if (search.trim()) {
    const q = search.trim().toLowerCase();
    filtered = filtered.filter(
      (t) => t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q) || t.mint.toLowerCase().includes(q),
    );
  }
  if (filters.minLiquidity > 0) {
    filtered = filtered.filter((t) => t.liquidity >= filters.minLiquidity);
  }
  if (filters.minMarketCap > 0) {
    filtered = filtered.filter((t) => t.marketCap >= filters.minMarketCap);
  }
  if (filters.hideNegative24h) {
    filtered = filtered.filter((t) => t.priceChange24h >= 0);
  }
  return filtered;
}

interface SafetyFilters {
  minLiquidity: number;
  minMarketCap: number;
  hideNegative24h: boolean;
}

export function ScannerTab({ balances }: ScannerTabProps) {
  const [scannerTab, setScannerTab] = useState<'trending' | 'new'>('trending');
  const [selectedToken, setSelectedToken] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<SafetyFilters>({
    minLiquidity: 0,
    minMarketCap: 0,
    hideNegative24h: false,
  });
  const [swapInput, setSwapInput] = useState({
    inputMint: 'So11111111111111111111111111111111111111112',
    outputMint: '',
    amount: '',
    slippageBps: '300',
  });
  const [swapSource, setSwapSource] = useState<'bot' | 'phantom'>('bot');

  const trendingQuery = useTrending();
  const newTokensQuery = useNewTokens(scannerTab === 'new');
  const tokenDetailQuery = useTokenDetail(selectedToken);
  const swapMutation = useSwap();

  const rawTokens = scannerTab === 'trending' ? trendingQuery.data?.data : newTokensQuery.data?.data;
  const tokensLoading = scannerTab === 'trending' ? trendingQuery.isLoading : newTokensQuery.isLoading;
  const tokens = useMemo(() => applyFilters(rawTokens ?? [], search, filters), [rawTokens, search, filters]);
  const detail = tokenDetailQuery.data?.data;

  return (
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
          <div>
            <label className="text-xs text-slate-400">From (mint)</label>
            <input type="text" value={swapInput.inputMint} onChange={(event) => setSwapInput({ ...swapInput, inputMint: event.target.value })} className="input mt-1 w-full text-xs font-mono" />
          </div>
          <div>
            <label className="text-xs text-slate-400">To (mint)</label>
            <input type="text" value={swapInput.outputMint} onChange={(event) => setSwapInput({ ...swapInput, outputMint: event.target.value })} placeholder="Token mint" className="input mt-1 w-full text-xs font-mono" />
          </div>
          <div>
            <label className="text-xs text-slate-400">Amount (lamports)</label>
            <input type="text" value={swapInput.amount} onChange={(event) => setSwapInput({ ...swapInput, amount: event.target.value })} placeholder="e.g. 100000000" className="input mt-1 w-full text-xs font-mono" />
          </div>
          <div>
            <label className="text-xs text-slate-400">Slippage (bps)</label>
            <input type="text" value={swapInput.slippageBps} onChange={(event) => setSwapInput({ ...swapInput, slippageBps: event.target.value })} className="input mt-1 w-full text-xs font-mono" />
          </div>
          <div className="flex items-end">
            <button
              onClick={() => { if (swapSource === 'bot') swapMutation.mutate({ inputMint: swapInput.inputMint, outputMint: swapInput.outputMint, amount: swapInput.amount, slippageBps: parseInt(swapInput.slippageBps, 10) }); }}
              disabled={!swapInput.outputMint || !swapInput.amount || swapMutation.isPending}
              className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {swapMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRightLeft className="h-4 w-4" />} Swap
            </button>
          </div>
        </div>
        {swapMutation.isSuccess && (
          <div className="mt-2 rounded-lg bg-green-500/10 border border-green-500/20 p-2 text-xs text-green-400">
            <CheckCircle className="inline h-3 w-3 mr-1" />{swapMutation.data?.message}
          </div>
        )}
        {swapMutation.isError && (
          <div className="mt-2 rounded-lg bg-red-500/10 border border-red-500/20 p-2 text-xs text-red-400">
            <AlertTriangle className="inline h-3 w-3 mr-1" />{swapMutation.error?.message ?? 'Swap failed'}
          </div>
        )}
      </div>

      {/* Token Scanner */}
      <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-200">Token Scanner</h2>
          <div className="flex gap-1">
            <button onClick={() => setScannerTab('trending')} className={`rounded px-3 py-1 text-xs font-medium ${scannerTab === 'trending' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-400'}`}>Trending</button>
            <button onClick={() => setScannerTab('new')} className={`rounded px-3 py-1 text-xs font-medium ${scannerTab === 'new' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-400'}`}>New Launches</button>
          </div>
        </div>

        {/* Search + Filters */}
        <div className="mb-3 space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              placeholder="Search by name, symbol, or mint..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="input w-full pl-9 text-xs"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setFilters((prev) => ({ ...prev, minLiquidity: prev.minLiquidity > 0 ? 0 : 10000 }))}
              className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-medium transition ${
                filters.minLiquidity > 0
                  ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                  : 'bg-slate-700 text-slate-400 border border-slate-600'
              }`}
            >
              <Shield className="h-3 w-3" /> Min Liquidity $10K
            </button>
            <button
              onClick={() => setFilters((prev) => ({ ...prev, minMarketCap: prev.minMarketCap > 0 ? 0 : 50000 }))}
              className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-medium transition ${
                filters.minMarketCap > 0
                  ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                  : 'bg-slate-700 text-slate-400 border border-slate-600'
              }`}
            >
              <Shield className="h-3 w-3" /> Min MCap $50K
            </button>
            <button
              onClick={() => setFilters((prev) => ({ ...prev, hideNegative24h: !prev.hideNegative24h }))}
              className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-medium transition ${
                filters.hideNegative24h
                  ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                  : 'bg-slate-700 text-slate-400 border border-slate-600'
              }`}
            >
              {filters.hideNegative24h ? <Shield className="h-3 w-3" /> : <ShieldOff className="h-3 w-3" />} Hide Dumps
            </button>
            {(search || filters.minLiquidity > 0 || filters.minMarketCap > 0 || filters.hideNegative24h) && (
              <span className="text-[10px] text-slate-500">
                {tokens.length} of {(rawTokens ?? []).length} tokens
              </span>
            )}
          </div>
        </div>

        {tokensLoading
          ? <div className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-blue-400" /></div>
          : <TokenTable tokens={tokens} onSelect={setSelectedToken} onBuy={(mint) => setSwapInput((prev) => ({ ...prev, outputMint: mint }))} />
        }
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
  );
}
