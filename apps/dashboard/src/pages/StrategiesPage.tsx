import { useState } from 'react';
import {
  Lightbulb,
  Play,
  Pause,
  Settings2,
  TrendingUp,
  BarChart3,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

interface StrategyCard {
  id: string;
  name: string;
  market: 'crypto' | 'prediction' | 'equity';
  type: string;
  enabled: boolean;
  winRate: number;
  totalTrades: number;
  totalPnl: number;
  sharpe: number;
  maxDrawdown: number;
  params: Record<string, unknown>;
}

const mockStrategies: StrategyCard[] = [
  {
    id: 'trend-following-btc',
    name: 'BTC Trend Following',
    market: 'crypto',
    type: 'trend_following',
    enabled: true,
    winRate: 58.3,
    totalTrades: 42,
    totalPnl: 3842.5,
    sharpe: 1.82,
    maxDrawdown: -4.2,
    params: {
      ema_fast: 12,
      ema_slow: 26,
      atr_period: 14,
      risk_per_trade: 0.01,
      min_risk_reward: 3.0,
    },
  },
  {
    id: 'mean-reversion-eth',
    name: 'ETH Mean Reversion',
    market: 'crypto',
    type: 'mean_reversion',
    enabled: true,
    winRate: 62.1,
    totalTrades: 38,
    totalPnl: 1654.2,
    sharpe: 1.45,
    maxDrawdown: -3.8,
    params: {
      bb_period: 20,
      bb_std: 2.0,
      rsi_period: 14,
      rsi_oversold: 30,
      rsi_overbought: 70,
    },
  },
  {
    id: 'breakout-sol',
    name: 'SOL Breakout',
    market: 'crypto',
    type: 'breakout',
    enabled: true,
    winRate: 45.6,
    totalTrades: 28,
    totalPnl: 892.1,
    sharpe: 1.12,
    maxDrawdown: -6.1,
    params: {
      lookback_period: 20,
      volume_threshold: 1.5,
      breakout_confirmation: 2,
    },
  },
  {
    id: 'momentum-spy',
    name: 'SPY Momentum',
    market: 'equity',
    type: 'momentum',
    enabled: true,
    winRate: 55.8,
    totalTrades: 34,
    totalPnl: 1245.0,
    sharpe: 1.35,
    maxDrawdown: -2.9,
    params: {
      rsi_period: 14,
      macd_fast: 12,
      macd_slow: 26,
      macd_signal: 9,
    },
  },
  {
    id: 'prediction-arb',
    name: 'Polymarket Arbitrage',
    market: 'prediction',
    type: 'arbitrage',
    enabled: false,
    winRate: 72.4,
    totalTrades: 15,
    totalPnl: 342.8,
    sharpe: 2.1,
    maxDrawdown: -1.2,
    params: {
      min_edge: 0.03,
      max_position: 500,
      expiry_buffer_hours: 24,
    },
  },
];

export function StrategiesPage() {
  const [strategies, setStrategies] = useState(mockStrategies);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const toggleEnabled = (id: string) => {
    setStrategies((prev) =>
      prev.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s)),
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Lightbulb className="h-6 w-6 text-blue-400" />
        <h1 className="text-2xl font-bold text-slate-100">Strategy Manager</h1>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {strategies.map((strategy) => {
          const isExpanded = expandedId === strategy.id;

          return (
            <div key={strategy.id} className="card">
              {/* Strategy Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className={`h-3 w-3 rounded-full ${
                      strategy.enabled ? 'bg-green-500' : 'bg-slate-600'
                    }`}
                  />
                  <div>
                    <h3 className="font-semibold text-slate-200">
                      {strategy.name}
                    </h3>
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <span className="badge-info">{strategy.market.toUpperCase()}</span>
                      <span>{strategy.type.replace('_', ' ')}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {/* Enable/Disable */}
                  <button
                    onClick={() => toggleEnabled(strategy.id)}
                    className={`btn-ghost flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs ${
                      strategy.enabled
                        ? 'text-green-400 hover:bg-green-500/10'
                        : 'text-slate-500 hover:bg-slate-700'
                    }`}
                  >
                    {strategy.enabled ? (
                      <Pause className="h-3.5 w-3.5" />
                    ) : (
                      <Play className="h-3.5 w-3.5" />
                    )}
                    {strategy.enabled ? 'Enabled' : 'Disabled'}
                  </button>

                  {/* Backtest */}
                  <button className="btn-ghost flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-blue-400 hover:bg-blue-500/10">
                    <BarChart3 className="h-3.5 w-3.5" />
                    Backtest
                  </button>

                  {/* Expand */}
                  <button
                    onClick={() =>
                      setExpandedId(isExpanded ? null : strategy.id)
                    }
                    className="btn-ghost p-1.5"
                  >
                    {isExpanded ? (
                      <ChevronUp className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              {/* Performance Summary */}
              <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-5">
                <div>
                  <div className="text-xs text-slate-500">Win Rate</div>
                  <div className="text-sm font-semibold text-slate-200">
                    {strategy.winRate}%
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Total Trades</div>
                  <div className="text-sm font-semibold text-slate-200">
                    {strategy.totalTrades}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Total P&L</div>
                  <div
                    className={`text-sm font-semibold ${
                      strategy.totalPnl >= 0 ? 'text-green-400' : 'text-red-400'
                    }`}
                  >
                    {strategy.totalPnl >= 0 ? '+' : ''}$
                    {strategy.totalPnl.toFixed(2)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Sharpe</div>
                  <div className="text-sm font-semibold text-slate-200">
                    {strategy.sharpe.toFixed(2)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Max Drawdown</div>
                  <div className="text-sm font-semibold text-red-400">
                    {strategy.maxDrawdown}%
                  </div>
                </div>
              </div>

              {/* Expanded: Parameter Editor */}
              {isExpanded && (
                <div className="mt-4 border-t border-slate-700/50 pt-4">
                  <div className="flex items-center gap-2 text-xs font-medium text-slate-400">
                    <Settings2 className="h-4 w-4" />
                    Strategy Parameters
                  </div>
                  <div className="mt-3 rounded-lg bg-slate-900/50 p-4">
                    <pre className="text-xs text-slate-300">
                      {JSON.stringify(strategy.params, null, 2)}
                    </pre>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button className="btn-primary text-xs">
                      Save Parameters
                    </button>
                    <button className="btn-ghost text-xs">
                      Reset to Defaults
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
