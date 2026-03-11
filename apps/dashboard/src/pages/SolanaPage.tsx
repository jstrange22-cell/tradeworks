import { useState } from 'react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { Zap, Wallet, TrendingUp, Sparkles, Rocket, Crosshair, Eye, Brain, PieChart, AlertTriangle, Info } from 'lucide-react';
import { StatCard } from '@/components/solana/shared';
import { ScannerTab, PumpFunTab, SniperTab, WhaleTab, MoonshotTab, ActiveTradesPanel } from '@/components/solana';
import { HoldingsTab } from '@/components/solana/HoldingsTab';
import { useWalletStatus, useBalances } from '@/hooks/useSolana';
import { usePhantomBalance } from '@/hooks/usePhantomBalance';
import type { PageTab } from '@/types/solana';

const TABS: ReadonlyArray<{ key: PageTab; label: string; icon: React.ReactNode }> = [
  { key: 'scanner', label: 'Scanner', icon: <TrendingUp className="h-3.5 w-3.5" /> },
  { key: 'pumpfun', label: 'pump.fun', icon: <Rocket className="h-3.5 w-3.5" /> },
  { key: 'sniper', label: 'Sniper', icon: <Crosshair className="h-3.5 w-3.5" /> },
  { key: 'whales', label: 'Whales', icon: <Eye className="h-3.5 w-3.5" /> },
  { key: 'moonshot', label: 'Moonshot AI', icon: <Brain className="h-3.5 w-3.5" /> },
  { key: 'holdings', label: 'Holdings', icon: <PieChart className="h-3.5 w-3.5" /> },
] as const;

export function SolanaPage() {
  const [activeTab, setActiveTab] = useState<PageTab>('scanner');

  // Phantom browser wallet (balance from on-chain RPC)
  const { balance: phantomSolBalance, loading: phantomLoading, connected: phantomConnected, publicKey: phantomKey } = usePhantomBalance();

  // Bot wallet (balance from gateway API)
  const walletQuery = useWalletStatus();
  const botConnected = walletQuery.data?.connected ?? false;
  const botWallet = walletQuery.data?.wallet;

  const balanceQuery = useBalances(botConnected);
  const balances = balanceQuery.data?.data;

  const phantomDisplay = phantomConnected
    ? phantomLoading
      ? 'Loading...'
      : phantomSolBalance !== null
        ? `${phantomSolBalance.toFixed(4)} SOL`
        : 'Error'
    : 'Not connected';

  const phantomSub = phantomConnected && phantomKey
    ? `${phantomKey.toBase58().slice(0, 4)}...${phantomKey.toBase58().slice(-4)}`
    : 'Click connect above';

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Zap className="h-7 w-7 text-purple-600 dark:text-purple-400" />
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Solana Trading</h1>
        </div>
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium ${
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

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
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
          label="Phantom"
          value={phantomDisplay}
          sub={phantomSub}
          icon={<Sparkles className="h-4 w-4 text-orange-600 dark:text-orange-400" />}
        />
      </div>

      {/* Active Trades Dashboard */}
      <ActiveTradesPanel />

      {/* Tab Navigation */}
      <div className="flex gap-1 rounded-lg bg-gray-100 p-1 dark:bg-slate-800/50">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${
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
      {activeTab === 'scanner' && <ScannerTab balances={balances} />}
      {activeTab === 'pumpfun' && <PumpFunTab />}
      {activeTab === 'sniper' && <SniperTab />}
      {activeTab === 'whales' && <WhaleTab />}
      {activeTab === 'moonshot' && <MoonshotTab />}
      {activeTab === 'holdings' && <HoldingsTab />}
    </div>
  );
}
