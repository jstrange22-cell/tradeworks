import { useState } from 'react';
import { Zap, Copy, TrendingUp, AlertTriangle, Play, Square, Loader2 } from 'lucide-react';
import { useSniperTemplates, useStartTemplate, useStopTemplate } from '@/hooks/useSolana';
import { useQueryClient } from '@tanstack/react-query';

interface StrategyDef {
  id: string;
  name: string;
  type: string;
  icon: React.ReactNode;
  color: string;
  bgColor: string;
  borderColor: string;
  description: string;
  howItWorks: string[];
  expectedWinRate: string;
  riskLevel: 'Low' | 'Medium' | 'High';
  bestFor: string;
  tradeSize: string;
}

const STRATEGIES: StrategyDef[] = [
  {
    id: 'graduation-hold',
    name: 'DEX Graduation Play',
    type: 'graduation_hold',
    icon: <TrendingUp className="h-5 w-5" />,
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/10',
    borderColor: 'border-emerald-500/30',
    description: 'Buy tokens AFTER they graduate to DEX. Real liquidity for sells, token has proven demand. No more bonding curve slippage.',
    howItWorks: [
      'Wait for pump.fun token to graduate to Raydium ($69K+ mcap)',
      'Buy on DEX with Jupiter routing (good fills)',
      'Tiered exits + trailing stop — sells have real liquidity',
    ],
    expectedWinRate: '20-35%',
    riskLevel: 'Medium',
    bestFor: 'Avoiding bonding curve slippage. Only buying proven tokens.',
    tradeSize: '0.05 SOL',
  },
  {
    id: 'quick-scalp',
    name: 'Quick Scalp',
    type: 'quick_scalp',
    icon: <Zap className="h-5 w-5" />,
    color: 'text-amber-400',
    bgColor: 'bg-amber-500/10',
    borderColor: 'border-amber-500/30',
    description: 'Buy on momentum, sell at ANY profit after 3-5 seconds. Get in, take profit, get out before the dump.',
    howItWorks: [
      'Momentum gate confirms real buying activity',
      'Buy immediately when confirmed',
      'Sell after 3-5s at any profit (bonding curve) or trail (DEX)',
    ],
    expectedWinRate: '35-45%',
    riskLevel: 'Medium',
    bestFor: 'High volume, fast trades. Small wins that compound.',
    tradeSize: '0.05 SOL',
  },
  {
    id: 'copy-trade',
    name: 'Whale Copy',
    type: 'copy_trade',
    icon: <Copy className="h-5 w-5" />,
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/10',
    borderColor: 'border-blue-500/30',
    description: 'Mirror verified whale wallets via Helius WebSocket. When a tracked whale buys, you buy within 500ms.',
    howItWorks: [
      'Tracks 7+ verified profitable wallets (Nansen, GMGN, Axiom)',
      'Helius WebSocket detects whale buys in real-time',
      'Mirror their buys within 500ms, mirror sells or trail',
    ],
    expectedWinRate: '50-65%',
    riskLevel: 'Medium',
    bestFor: 'Smart money following. Let proven traders do the research.',
    tradeSize: '0.05 SOL',
  },
  {
    id: 'graduation-snipe',
    name: 'Volume Spike Sniper',
    type: 'graduation_snipe',
    icon: <TrendingUp className="h-5 w-5" />,
    color: 'text-orange-400',
    bgColor: 'bg-orange-500/10',
    borderColor: 'border-orange-500/30',
    description: 'Find graduated tokens showing a second volume wave on DexScreener. Buy survivors with momentum — these tokens already proved they can live.',
    howItWorks: [
      'Scan DexScreener for graduated pump.fun tokens with volume spikes',
      'Require 10+ unique buyers and 2.5x buy/sell ratio',
      'Tight stops and fast exits — ride the second wave',
    ],
    expectedWinRate: '25-40%',
    riskLevel: 'Medium',
    bestFor: 'Catching tokens on their second life. Higher conviction, better liquidity.',
    tradeSize: '0.05 SOL',
  },
];

export function StrategiesTab() {
  const templatesQuery = useSniperTemplates(true);
  const templates = (templatesQuery.data as { data?: Array<{ id: string; running: boolean; enabled: boolean; stats?: { totalTrades: number; wins: number; losses: number; totalPnlSol: number } }> })?.data ?? [];
  const startMutation = useStartTemplate();
  const stopMutation = useStopTemplate();
  const queryClient = useQueryClient();
  const [activating, setActivating] = useState<string | null>(null);

  const getTemplateStatus = (strategyId: string) => {
    const tmpl = templates.find(t => t.id === strategyId);
    return tmpl ?? null;
  };

  const handleToggle = async (strategyId: string, isRunning: boolean) => {
    setActivating(strategyId);
    try {
      if (isRunning) {
        await stopMutation.mutateAsync(strategyId);
      } else {
        await startMutation.mutateAsync(strategyId);
      }
      await queryClient.invalidateQueries({ queryKey: ['sniper-templates'] });
    } catch (err) {
      console.error('Toggle failed:', err);
    } finally {
      setActivating(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Trading Strategies</h2>
          <p className="text-xs text-slate-400 mt-1">Each strategy uses a different approach to solve the bonding curve execution problem</p>
        </div>
      </div>

      {/* Strategy Summary Bars */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {STRATEGIES.map(strategy => {
          const tmpl = getTemplateStatus(strategy.id);
          const stats = tmpl?.stats;
          const pnl = stats?.totalPnlSol ?? 0;
          const trades = stats?.totalTrades ?? 0;
          const wins = stats?.wins ?? 0;
          const winRate = trades > 0 ? Math.round((wins / trades) * 100) : 0;
          const isRunning = tmpl?.running ?? false;
          return (
            <div key={`bar-${strategy.id}`} className={`rounded-xl border p-3 ${isRunning ? strategy.borderColor + ' ' + strategy.bgColor : 'border-slate-700/50 bg-slate-800/30'}`}>
              <div className="flex items-center gap-2 mb-2">
                <div className={`flex h-6 w-6 items-center justify-center rounded-md ${strategy.bgColor}`}>
                  <span className={`${strategy.color} [&>svg]:h-3.5 [&>svg]:w-3.5`}>{strategy.icon}</span>
                </div>
                <span className="text-xs font-semibold text-slate-200 truncate">{strategy.name}</span>
                <span className={`ml-auto h-2 w-2 rounded-full ${isRunning ? 'bg-green-400 animate-pulse' : 'bg-slate-600'}`} />
              </div>
              <div className={`text-lg font-bold font-mono ${pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {pnl >= 0 ? '+' : ''}{pnl.toFixed(3)} <span className="text-[10px] font-normal text-slate-500">SOL</span>
              </div>
              <div className="flex items-center gap-3 mt-1 text-[10px] text-slate-500">
                <span>{trades} trades</span>
                <span>{winRate}% win</span>
                <span>{wins}W / {trades - wins}L</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid gap-3 md:gap-4 md:grid-cols-2">
        {STRATEGIES.map(strategy => {
          const tmpl = getTemplateStatus(strategy.id);
          const isRunning = tmpl?.running ?? false;
          const isLoading = activating === strategy.id;
          const stats = tmpl?.stats;
          const winRate = stats && stats.totalTrades > 0
            ? Math.round((stats.wins / stats.totalTrades) * 100)
            : null;

          return (
            <div
              key={strategy.id}
              className={`rounded-xl border p-3 md:p-5 transition-all ${
                isRunning
                  ? `${strategy.borderColor} ${strategy.bgColor}`
                  : 'border-slate-700/50 bg-slate-800/30 hover:border-slate-600/50'
              }`}
            >
              {/* Header */}
              <div className="flex items-start justify-between mb-2 md:mb-3">
                <div className="flex items-center gap-2 md:gap-3">
                  <div className={`flex h-8 w-8 md:h-10 md:w-10 items-center justify-center rounded-lg ${strategy.bgColor}`}>
                    <span className={strategy.color}>{strategy.icon}</span>
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-100">{strategy.name}</h3>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                        strategy.riskLevel === 'Low' ? 'bg-green-500/20 text-green-400' :
                        strategy.riskLevel === 'Medium' ? 'bg-yellow-500/20 text-yellow-400' :
                        'bg-red-500/20 text-red-400'
                      }`}>{strategy.riskLevel} Risk</span>
                      <span className="text-[10px] text-slate-500">WR: {strategy.expectedWinRate}</span>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => handleToggle(strategy.id, isRunning)}
                  disabled={isLoading}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    isRunning
                      ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                      : `${strategy.bgColor} ${strategy.color} hover:opacity-80`
                  }`}
                >
                  {isLoading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : isRunning ? (
                    <><Square className="h-3.5 w-3.5" /> Stop</>
                  ) : (
                    <><Play className="h-3.5 w-3.5" /> Start</>
                  )}
                </button>
              </div>

              {/* Description */}
              <p className="text-xs text-slate-400 mb-3">{strategy.description}</p>

              {/* How it works */}
              <div className="mb-3 space-y-1.5">
                {strategy.howItWorks.map((step, i) => (
                  <div key={i} className="flex items-start gap-2 text-[11px]">
                    <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold ${strategy.bgColor} ${strategy.color}`}>
                      {i + 1}
                    </span>
                    <span className="text-slate-300">{step}</span>
                  </div>
                ))}
              </div>

              {/* Stats bar */}
              {stats && stats.totalTrades > 0 && (
                <div className="flex items-center gap-3 rounded-lg bg-slate-900/50 px-3 py-2 text-[11px]">
                  <span className="text-slate-400">{stats.totalTrades} trades</span>
                  <span className="text-slate-600">|</span>
                  <span className={winRate !== null && winRate >= 35 ? 'text-green-400' : 'text-slate-300'}>
                    {winRate}% WR
                  </span>
                  <span className="text-slate-600">|</span>
                  <span className={stats.totalPnlSol >= 0 ? 'text-green-400' : 'text-red-400'}>
                    {stats.totalPnlSol >= 0 ? '+' : ''}{stats.totalPnlSol.toFixed(4)} SOL
                  </span>
                </div>
              )}

              {/* Footer */}
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-700/30 text-[10px] text-slate-500">
                <span>{strategy.bestFor}</span>
                <span className="font-mono">{strategy.tradeSize}/trade</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Info box */}
      <div className="flex items-start gap-3 rounded-lg border border-slate-700/30 bg-slate-800/20 p-4">
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
        <div className="text-xs text-slate-400">
          <span className="font-medium text-slate-300">Multiple strategies can run simultaneously.</span> Each operates independently with its own P&L tracking, positions, and exit logic. Start with one strategy at a time to understand its behavior before combining.
        </div>
      </div>
    </div>
  );
}
