import { useState } from 'react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { Zap, Wallet, TrendingUp, Sparkles, Rocket, Crosshair, Eye, Brain, PieChart, AlertTriangle, Info, BarChart3 } from 'lucide-react';
import { StatCard } from '@/components/solana/shared';
import { ScannerTab, PumpFunTab, SniperTab, WhaleTab, MoonshotTab, ActiveTradesPanel } from '@/components/solana';
import { HoldingsTab } from '@/components/solana/HoldingsTab';
import { SniperPnL } from '@/components/solana/SniperPnL';
import { StrategiesTab } from '@/components/solana/StrategiesTab';
import { useWalletStatus, useBalances, useSniperTemplates } from '@/hooks/useSolana';
import { usePhantomBalance } from '@/hooks/usePhantomBalance';
import type { PageTab } from '@/types/solana';

const TABS: ReadonlyArray<{ key: PageTab; label: string; icon: React.ReactNode }> = [
  { key: 'strategies', label: 'Strategies', icon: <Zap className="h-3.5 w-3.5" /> },
  { key: 'scanner', label: 'Scanner', icon: <TrendingUp className="h-3.5 w-3.5" /> },
  { key: 'pumpfun', label: 'pump.fun', icon: <Rocket className="h-3.5 w-3.5" /> },
  { key: 'sniper', label: 'Sniper', icon: <Crosshair className="h-3.5 w-3.5" /> },
  { key: 'whales', label: 'Whales', icon: <Eye className="h-3.5 w-3.5" /> },
  { key: 'moonshot', label: 'Moonshot AI', icon: <Brain className="h-3.5 w-3.5" /> },
  { key: 'holdings', label: 'Holdings', icon: <PieChart className="h-3.5 w-3.5" /> },
  { key: 'pnl', label: 'P&L', icon: <BarChart3 className="h-3.5 w-3.5" /> },
] as const;

export function SolanaPage() {
  const [activeTab, setActiveTab] = useState<PageTab>('strategies');

  // Phantom browser wallet (full balance: SOL + all tokens)
  const { totalValueUsd: phantomTotalUsd, tokens: phantomTokens, loading: phantomLoading, connected: phantomConnected, publicKey: phantomKey } = usePhantomBalance();

  // Bot wallet (balance from gateway API)
  const walletQuery = useWalletStatus();
  const botConnected = walletQuery.data?.connected ?? false;
  const botWallet = walletQuery.data?.wallet;

  const balanceQuery = useBalances(botConnected);
  const balances = balanceQuery.data?.data;

  // Sniper templates (for paper mode balance)
  const templatesQuery = useSniperTemplates(botConnected);
  const allTemplates = (templatesQuery.data as { data?: Array<{ id: string; name?: string; paperMode?: boolean; paperBalanceSol?: number; running?: boolean; openPositions?: number; stats?: { totalTrades?: number; wins?: number; losses?: number; totalPnlSol?: number } }> })?.data ?? [];

  // Use active paper templates (not Default Sniper which is stopped)
  const paperTemplates = allTemplates.filter(t => t.paperMode && t.running);
  const isPaperMode = paperTemplates.length > 0;

  // Aggregate paper balance and stats across all running paper templates
  const paperBalanceSol = paperTemplates.reduce((sum, t) => sum + (t.paperBalanceSol ?? 0), 0);
  const paperStats = isPaperMode ? {
    totalTrades: paperTemplates.reduce((s, t) => s + (t.stats?.totalTrades ?? 0), 0),
    wins: paperTemplates.reduce((s, t) => s + (t.stats?.wins ?? 0), 0),
    losses: paperTemplates.reduce((s, t) => s + (t.stats?.losses ?? 0), 0),
    totalPnlSol: paperTemplates.reduce((s, t) => s + (t.stats?.totalPnlSol ?? 0), 0),
  } : undefined;

  const phantomDisplay = phantomConnected
    ? phantomLoading
      ? 'Loading...'
      : phantomTotalUsd !== null
        ? `$${phantomTotalUsd.toFixed(2)}`
        : 'RPC unavailable'
    : 'Not connected';

  const phantomSub = phantomConnected && phantomKey
    ? `${phantomTokens.length} token(s) · ${phantomKey.toBase58().slice(0, 4)}...${phantomKey.toBase58().slice(-4)}`
    : 'Click connect above';

  return (
    <div className="space-y-4 p-3 md:space-y-6 md:p-6">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Zap className="h-6 w-6 md:h-7 md:w-7 text-purple-600 dark:text-purple-400" />
          <h1 className="text-lg md:text-2xl font-bold text-gray-900 dark:text-slate-100">Solana Trading</h1>
        </div>
        <div className="flex items-center gap-2 overflow-x-auto">
          <div className={`flex items-center gap-2 rounded-lg border px-2 py-1 md:px-3 md:py-1.5 text-[10px] md:text-xs font-medium whitespace-nowrap ${
            botConnected
              ? 'border-green-500/30 bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400'
              : 'border-gray-300 bg-gray-100 text-gray-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-500'
          }`}>
            <Wallet className="h-3.5 w-3.5" />
            Bot: {botConnected ? `${botWallet?.slice(0, 4)}...${botWallet?.slice(-4)}` : 'Not connected'}
          </div>
          <WalletMultiButton className="!bg-purple-600 !rounded-lg !h-8 !text-xs" />
        </div>
      </div>

      {/* Wallet Status Alerts */}
      {walletQuery.isError && (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-50 p-3 text-xs text-red-700 dark:bg-red-500/10 dark:text-red-400">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Failed to reach gateway: {walletQuery.error instanceof Error ? walletQuery.error.message : 'Unknown error'}
        </div>
      )}
      {!walletQuery.isLoading && !botConnected && !walletQuery.isError && (
        <div className="flex items-center gap-2 rounded-lg border border-yellow-500/30 bg-yellow-50 p-3 text-xs text-yellow-700 dark:bg-yellow-500/10 dark:text-yellow-400">
          <Info className="h-4 w-4 shrink-0" />
          Bot wallet not connected. Add your Solana private key in Settings → API Keys, then restart the gateway.
        </div>
      )}

      {/* Paper Mode Banner */}
      {isPaperMode && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-3 md:px-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 md:h-10 md:w-10 items-center justify-center rounded-full bg-amber-500/20 shrink-0">
              <Rocket className="h-4 w-4 md:h-5 md:w-5 text-amber-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs md:text-sm font-semibold text-amber-300">PAPER TRADING</span>
                <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-400">SIMULATED</span>
              </div>
              <span className="text-[10px] md:text-xs text-amber-400/70">No real money at risk</span>
            </div>
          </div>
          {paperStats && (
            <div className="mt-2 grid grid-cols-2 gap-2 text-center text-xs md:grid-cols-4">
              <div>
                <div className="text-sm font-bold text-amber-300">{paperBalanceSol.toFixed(2)}</div>
                <div className="text-[10px] text-amber-400/60">SOL</div>
              </div>
              <div>
                <div className={`text-sm font-bold ${(paperStats.totalPnlSol ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {(paperStats.totalPnlSol ?? 0) >= 0 ? '+' : ''}{(paperStats.totalPnlSol ?? 0).toFixed(3)}
                </div>
                <div className="text-[10px] text-amber-400/60">P&L</div>
              </div>
              <div>
                <div className="text-sm font-bold text-slate-200">{paperStats.totalTrades ?? 0}</div>
                <div className="text-[10px] text-amber-400/60">Trades</div>
              </div>
              <div>
                <div className="text-sm font-bold text-slate-200">
                  {paperStats.totalTrades ? Math.round(((paperStats.wins ?? 0) / paperStats.totalTrades) * 100) : 0}%
                </div>
                <div className="text-[10px] text-amber-400/60">Win</div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Per-Template Balance Breakdown */}
      {isPaperMode && paperTemplates.length > 1 && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
          {paperTemplates.map(t => {
            const bal = t.paperBalanceSol ?? 0;
            const pnl = t.stats?.totalPnlSol ?? 0;
            return (
              <div key={t.id} className={`rounded-lg border px-3 py-2 ${bal <= 0 ? 'border-red-500/30 bg-red-500/10' : 'border-slate-700/50 bg-slate-800/50'}`}>
                <div className="text-[10px] text-slate-500">{(t as { name?: string }).name ?? t.id}</div>
                <div className={`text-sm font-bold ${bal <= 0 ? 'text-red-400' : 'text-slate-200'}`}>{bal.toFixed(3)} SOL</div>
                <div className={`text-[10px] font-mono ${pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{pnl >= 0 ? '+' : ''}{pnl.toFixed(3)}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-2 md:gap-4 lg:grid-cols-4">
        <StatCard
          label="SOL Balance"
          value={balances ? `${balances.solBalance.toFixed(4)} SOL` : '--'}
          sub={balances ? `$${balances.solValueUsd.toFixed(2)}` : ''}
          icon={<Zap className="h-4 w-4 text-purple-600 dark:text-purple-400" />}
        />
        <StatCard
          label="Token Value"
          value={balances ? `$${balances.tokens.reduce((sum, token) => sum + token.valueUsd, 0).toFixed(2)}` : '--'}
          sub={balances ? `${balances.tokens.length} token(s)` : ''}
          icon={<TrendingUp className="h-4 w-4 text-blue-600 dark:text-blue-400" />}
        />
        <StatCard
          label="Total Portfolio"
          value={balances ? `$${balances.totalValueUsd.toFixed(2)}` : '--'}
          sub="Bot wallet"
          icon={<Wallet className="h-4 w-4 text-green-600 dark:text-green-400" />}
        />
        <StatCard
          label="Phantom Wallet"
          value={phantomDisplay}
          sub={phantomSub}
          icon={<Sparkles className="h-4 w-4 text-orange-600 dark:text-orange-400" />}
        />
      </div>

      {/* Active Trades Dashboard */}
      <ActiveTradesPanel />

      {/* Tab Navigation */}
      <div className="flex gap-1 rounded-lg bg-gray-100 p-1 dark:bg-slate-800/50 overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 md:px-3 text-xs font-medium transition whitespace-nowrap ${
              activeTab === tab.key
                ? 'bg-blue-600 text-white'
                : 'text-gray-500 hover:text-gray-800 hover:bg-gray-200 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'strategies' && <StrategiesTab />}
      {activeTab === 'scanner' && <ScannerTab balances={balances} />}
      {activeTab === 'pumpfun' && <PumpFunTab />}
      {activeTab === 'sniper' && <SniperTab />}
      {activeTab === 'whales' && <WhaleTab />}
      {activeTab === 'moonshot' && <MoonshotTab />}
      {activeTab === 'holdings' && <HoldingsTab />}
      {activeTab === 'pnl' && <SniperPnL />}
    </div>
  );
}
