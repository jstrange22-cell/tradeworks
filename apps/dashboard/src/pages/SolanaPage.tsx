import { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { Zap, Wallet, TrendingUp, Sparkles, Rocket, Crosshair, Eye, Brain } from 'lucide-react';
import { StatCard } from '@/components/solana/shared';
import { ScannerTab, PumpFunTab, SniperTab, WhaleTab, MoonshotTab } from '@/components/solana';
import { useWalletStatus, useBalances } from '@/hooks/useSolana';
import type { PageTab } from '@/types/solana';

const TABS: ReadonlyArray<{ key: PageTab; label: string; icon: React.ReactNode }> = [
  { key: 'scanner', label: 'Scanner', icon: <TrendingUp className="h-3.5 w-3.5" /> },
  { key: 'pumpfun', label: 'pump.fun', icon: <Rocket className="h-3.5 w-3.5" /> },
  { key: 'sniper', label: 'Sniper', icon: <Crosshair className="h-3.5 w-3.5" /> },
  { key: 'whales', label: 'Whales', icon: <Eye className="h-3.5 w-3.5" /> },
  { key: 'moonshot', label: 'Moonshot AI', icon: <Brain className="h-3.5 w-3.5" /> },
] as const;

export function SolanaPage() {
  const [activeTab, setActiveTab] = useState<PageTab>('scanner');
  const { publicKey: phantomKey, connected: phantomConnected } = useWallet();

  const walletQuery = useWalletStatus();
  const botConnected = walletQuery.data?.connected ?? false;
  const botWallet = walletQuery.data?.wallet;

  const balanceQuery = useBalances(botConnected);
  const balances = balanceQuery.data?.data;

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
        <StatCard label="Token Value" value={balances ? `$${balances.tokens.reduce((sum, token) => sum + token.valueUsd, 0).toFixed(2)}` : '--'} sub={balances ? `${balances.tokens.length} token(s)` : ''} icon={<TrendingUp className="h-4 w-4 text-blue-400" />} />
        <StatCard label="Total Portfolio" value={balances ? `$${balances.totalValueUsd.toFixed(2)}` : '--'} sub="Bot wallet" icon={<Wallet className="h-4 w-4 text-green-400" />} />
        <StatCard label="Phantom" value={phantomConnected ? `${phantomKey?.toBase58().slice(0, 4)}...${phantomKey?.toBase58().slice(-4)}` : 'Not connected'} sub={phantomConnected ? 'Browser wallet' : 'Click connect above'} icon={<Sparkles className="h-4 w-4 text-orange-400" />} />
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 rounded-lg bg-slate-800/50 p-1">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${
              activeTab === tab.key ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700'
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
    </div>
  );
}
