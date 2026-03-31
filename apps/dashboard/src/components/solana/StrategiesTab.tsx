import { useState } from 'react';
import { Zap, Copy, Target, TrendingUp, AlertTriangle, Play, Square, Loader2 } from 'lucide-react';
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
    name: 'Graduation Hold',
    type: 'graduation_hold',
    icon: <TrendingUp className="h-5 w-5" />,
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/10',
    borderColor: 'border-emerald-500/30',
    description: 'Buy early on bonding curve, hold through graduation to DEX. Never sell on bonding curve — avoids the slippage problem entirely.',
    howItWorks: [
      'Buy tokens at $5-15K mcap on bonding curve',
      'Hold until token graduates to Raydium ($69K mcap)',
      'Sell on DEX with Jupiter split routing (good fills)',
    ],
    expectedWinRate: '15-25%',
    riskLevel: 'High',
    bestFor: 'Avoiding bonding curve sell slippage. Fewer trades, bigger wins.',
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
    name: 'Copy Trading',
    type: 'copy_trade',
    icon: <Copy className="h-5 w-5" />,
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/10',
    borderColor: 'border-blue-500/30',
    description: 'Mirror whale wallets with >60% win rate. When they buy, you buy. When they sell, you sell.',
    howItWorks: [
      'Track whale wallets with proven track records',
      'Mirror their buys within 500ms',
      'Mirror their sells or use trailing stop',
    ],
    expectedWinRate: '40-60%',
    riskLevel: 'Medium',
    bestFor: 'Hands-off trading. Let smart money do the research.',
    tradeSize: '0.05 SOL',
  },
  {
    id: 'graduation-snipe',
    name: 'Graduation Snipe',
    type: 'graduation_snipe',
    icon: <Target className="h-5 w-5" />,
    color: 'text-purple-400',
    bgColor: 'bg-purple-500/10',
    borderColor: 'border-purple-500/30',
    description: 'Buy AT the graduation moment when token moves to DEX. All sells happen with real liquidity — best fill quality.',
    howItWorks: [
      'Monitor tokens approaching 90% bonding curve completion',
      'Buy the moment graduation happens (token hits Raydium)',
      'Sell on DEX with Jupiter split routing',
    ],
    expectedWinRate: '30-40%',
    riskLevel: 'Low',
    bestFor: 'Best fill quality. Only trades tokens that proved demand.',
    tradeSize: '0.10 SOL',
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

      <div className="grid gap-4 md:grid-cols-2">
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
              className={`rounded-xl border p-5 transition-all ${
                isRunning
                  ? `${strategy.borderColor} ${strategy.bgColor}`
                  : 'border-slate-700/50 bg-slate-800/30 hover:border-slate-600/50'
              }`}
            >
              {/* Header */}
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${strategy.bgColor}`}>
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
