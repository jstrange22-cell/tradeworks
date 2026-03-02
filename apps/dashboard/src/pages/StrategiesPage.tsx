import { useState } from 'react';
import {
  Lightbulb,
  Play,
  Pause,
  Settings2,
  BarChart3,
  ChevronDown,
  ChevronUp,
  Plus,
  Trash2,
  Loader2,
  X,
  TrendingUp,
  Repeat,
  Zap,
  ArrowUpRight,
  Shuffle,
  Store,
  Brain,
  Info,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

interface Strategy {
  id: string;
  name: string;
  market: string;
  strategyType: string;
  enabled: boolean;
  params: Record<string, unknown>;
  maxAllocation: string | null;
  riskPerTrade: string | null;
  minRiskReward: string | null;
  createdAt: string;
  updatedAt: string;
}

// Strategy type descriptions for user education
const STRATEGY_TYPES: Record<string, { label: string; icon: typeof TrendingUp; description: string; color: string }> = {
  trend_following: {
    label: 'Trend Following',
    icon: TrendingUp,
    description: 'Rides established price trends using moving averages and momentum indicators. Best in trending markets.',
    color: 'text-green-400',
  },
  mean_reversion: {
    label: 'Mean Reversion',
    icon: Repeat,
    description: 'Buys when price drops below average and sells when above. Profits from price returning to the mean.',
    color: 'text-blue-400',
  },
  momentum: {
    label: 'Momentum',
    icon: Zap,
    description: 'Enters trades in the direction of strong recent price movement. Catches accelerating moves early.',
    color: 'text-amber-400',
  },
  breakout: {
    label: 'Breakout',
    icon: ArrowUpRight,
    description: 'Enters when price breaks through key support/resistance levels. Captures explosive moves.',
    color: 'text-purple-400',
  },
  arbitrage: {
    label: 'Arbitrage',
    icon: Shuffle,
    description: 'Exploits price differences between markets or exchanges for risk-free profits.',
    color: 'text-cyan-400',
  },
  market_making: {
    label: 'Market Making',
    icon: Store,
    description: 'Places both buy and sell orders to profit from the bid-ask spread. Earns from providing liquidity.',
    color: 'text-pink-400',
  },
};

export function StrategiesPage() {
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);

  const { data: strategiesData, isLoading } = useQuery({
    queryKey: ['strategies'],
    queryFn: () => apiClient.get<{ data: Strategy[] }>('/strategies'),
    refetchInterval: 30_000,
  });
  const strategies = strategiesData?.data ?? [];

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      apiClient.patch(`/strategies/${id}`, { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['strategies'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/strategies/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['strategies'] }),
  });

  const createMutation = useMutation({
    mutationFn: (data: {
      name: string;
      market: string;
      strategyType: string;
      params: Record<string, unknown>;
    }) => apiClient.post('/strategies', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['strategies'] });
      setShowCreateForm(false);
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Lightbulb className="h-6 w-6 text-blue-400" />
          <h1 className="text-2xl font-bold text-slate-100">Strategy Manager</h1>
        </div>
        <button
          onClick={() => setShowCreateForm(true)}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-500"
        >
          <Plus className="h-4 w-4" />
          Create Strategy
        </button>
      </div>

      {/* AI Insight Banner */}
      <div className="card border-blue-500/20 bg-blue-500/5">
        <div className="flex gap-3">
          <Brain className="mt-0.5 h-5 w-5 shrink-0 text-blue-400" />
          <div>
            <h3 className="text-sm font-semibold text-blue-300">AI-Managed Strategies</h3>
            <p className="mt-1 text-sm text-slate-400">
              The AI engine uses your enabled strategies as <span className="text-slate-200">guidelines for its autonomous research</span>.
              Each trading cycle, the Quant Analyst generates signals matching your strategy types, and the Risk Guardian
              enforces the allocation and risk limits you set here. The AI adapts its research focus based on which strategies
              are active.
            </p>
          </div>
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-blue-400" />
        </div>
      )}

      {!isLoading && strategies.length === 0 && (
        <div className="card py-12 text-center">
          <Lightbulb className="mx-auto h-12 w-12 text-slate-600" />
          <h3 className="mt-4 text-lg font-semibold text-slate-300">No Strategies</h3>
          <p className="mt-2 text-sm text-slate-500">
            Create a strategy to tell the AI what types of trades to look for.
          </p>
          <button
            onClick={() => setShowCreateForm(true)}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500"
          >
            <Plus className="h-4 w-4" />
            Create Strategy
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4">
        {strategies.map((strategy) => {
          const isExpanded = expandedId === strategy.id;
          const typeMeta = STRATEGY_TYPES[strategy.strategyType];
          const TypeIcon = typeMeta?.icon ?? Settings2;

          return (
            <div key={strategy.id} className="card">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`h-3 w-3 rounded-full ${strategy.enabled ? 'bg-green-500' : 'bg-slate-600'}`} />
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-slate-200">{strategy.name}</h3>
                      {typeMeta && (
                        <div className={`flex items-center gap-1 ${typeMeta.color}`}>
                          <TypeIcon className="h-3.5 w-3.5" />
                          <span className="text-xs">{typeMeta.label}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <span className="badge-info">{strategy.market?.toUpperCase() ?? 'N/A'}</span>
                      {typeMeta && <span className="text-slate-600">{typeMeta.description.split('.')[0]}</span>}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => toggleMutation.mutate({ id: strategy.id, enabled: !strategy.enabled })}
                    disabled={toggleMutation.isPending}
                    className={`btn-ghost flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs ${
                      strategy.enabled ? 'text-green-400 hover:bg-green-500/10' : 'text-slate-500 hover:bg-slate-700'
                    }`}
                  >
                    {strategy.enabled ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                    {strategy.enabled ? 'Enabled' : 'Disabled'}
                  </button>

                  <button className="btn-ghost flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-blue-400 hover:bg-blue-500/10">
                    <BarChart3 className="h-3.5 w-3.5" />
                    Backtest
                  </button>

                  <button
                    onClick={() => {
                      if (window.confirm(`Delete strategy "${strategy.name}"?`)) {
                        deleteMutation.mutate(strategy.id);
                      }
                    }}
                    className="btn-ghost p-1.5 text-red-400 hover:bg-red-500/10"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>

                  <button onClick={() => setExpandedId(isExpanded ? null : strategy.id)} className="btn-ghost p-1.5">
                    {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* Summary */}
              <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div>
                  <div className="text-xs text-slate-500">Max Allocation</div>
                  <div className="text-sm font-semibold text-slate-200">
                    {strategy.maxAllocation ? `${parseFloat(strategy.maxAllocation) * 100}%` : '--'}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Risk/Trade</div>
                  <div className="text-sm font-semibold text-slate-200">
                    {strategy.riskPerTrade ? `${parseFloat(strategy.riskPerTrade) * 100}%` : '--'}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Min R:R</div>
                  <div className="text-sm font-semibold text-slate-200">
                    {strategy.minRiskReward ? `1:${strategy.minRiskReward}` : '--'}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Created</div>
                  <div className="text-sm text-slate-200">
                    {new Date(strategy.createdAt).toLocaleDateString()}
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
                      {JSON.stringify(strategy.params ?? {}, null, 2)}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Create Strategy Modal */}
      {showCreateForm && (
        <CreateStrategyModal
          onClose={() => setShowCreateForm(false)}
          onSubmit={(data) => createMutation.mutate(data)}
          isPending={createMutation.isPending}
          error={createMutation.error}
        />
      )}
    </div>
  );
}

// ── Create Strategy Modal ──────────────────────────────────────────────

function CreateStrategyModal({
  onClose,
  onSubmit,
  isPending,
  error,
}: {
  onClose: () => void;
  onSubmit: (data: { name: string; market: string; strategyType: string; params: Record<string, unknown> }) => void;
  isPending: boolean;
  error: Error | null;
}) {
  const [name, setName] = useState('');
  const [market, setMarket] = useState('crypto');
  const [strategyType, setStrategyType] = useState('trend_following');
  const [paramsJson, setParamsJson] = useState('{\n  "period": 14,\n  "threshold": 0.5\n}');

  const selectedType = STRATEGY_TYPES[strategyType];

  const handleSubmit = () => {
    if (!name.trim()) return;
    let params: Record<string, unknown> = {};
    try {
      params = JSON.parse(paramsJson);
    } catch {
      // use empty params
    }
    onSubmit({ name: name.trim(), market, strategyType, params });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-xl border border-slate-700 bg-slate-800 p-6 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-100">Create Strategy</h3>
          <button onClick={onClose} className="btn-ghost p-1">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-4 space-y-4">
          <div>
            <label className="text-xs font-medium text-slate-400">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input mt-1 w-full"
              placeholder="My BTC Strategy"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-slate-400">Market</label>
              <select value={market} onChange={(e) => setMarket(e.target.value)} className="input mt-1 w-full">
                <option value="crypto">Crypto</option>
                <option value="equities">Equities</option>
                <option value="prediction">Prediction</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-400">Type</label>
              <select value={strategyType} onChange={(e) => setStrategyType(e.target.value)} className="input mt-1 w-full">
                {Object.entries(STRATEGY_TYPES).map(([key, meta]) => (
                  <option key={key} value={key}>{meta.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Strategy Type Description */}
          {selectedType && (
            <div className="flex items-start gap-2 rounded-lg bg-slate-900/50 p-3">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
              <p className="text-xs text-slate-400">{selectedType.description}</p>
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-slate-400">Parameters (JSON)</label>
            <textarea
              value={paramsJson}
              onChange={(e) => setParamsJson(e.target.value)}
              className="input mt-1 w-full font-mono text-xs"
              rows={4}
            />
          </div>

          {error && (
            <div className="rounded-lg bg-red-500/10 p-3 text-sm text-red-400">
              {error.message || 'Failed to create strategy'}
            </div>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button onClick={onClose} className="btn-ghost px-4 py-2 text-sm">Cancel</button>
          <button
            onClick={handleSubmit}
            disabled={isPending || !name.trim()}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Create Strategy
          </button>
        </div>
      </div>
    </div>
  );
}
