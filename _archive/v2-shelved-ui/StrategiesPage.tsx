import { useState } from 'react';
import {
  Lightbulb,
  Play,
  Pause,
  Settings2,
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
  Sparkles,
  CheckCircle2,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

// ── Types ──────────────────────────────────────────────────────────────

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

interface StrategyTemplate {
  id: string;
  name: string;
  description: string;
  type: string;
  strategyType: string;
  market: string;
  instruments: string[];
  timeframes: string[];
  parameters: Record<string, unknown>;
  riskOverrides: { maxRiskPercent: number; maxPositionSize: number };
  difficulty: 'beginner' | 'intermediate' | 'advanced';
}

// ── Constants ──────────────────────────────────────────────────────────

const STRATEGY_TYPES: Record<string, { label: string; icon: typeof TrendingUp; description: string; color: string; bg: string }> = {
  trend_following: {
    label: 'Trend Following',
    icon: TrendingUp,
    description: 'Rides established price trends using moving averages and momentum indicators.',
    color: 'text-green-400',
    bg: 'bg-green-500/10',
  },
  mean_reversion: {
    label: 'Mean Reversion',
    icon: Repeat,
    description: 'Buys when price drops below average and sells when above.',
    color: 'text-blue-400',
    bg: 'bg-blue-500/10',
  },
  momentum: {
    label: 'Momentum',
    icon: Zap,
    description: 'Enters trades in the direction of strong recent price movement.',
    color: 'text-amber-400',
    bg: 'bg-amber-500/10',
  },
  breakout: {
    label: 'Breakout',
    icon: ArrowUpRight,
    description: 'Enters when price breaks through key support/resistance levels.',
    color: 'text-purple-400',
    bg: 'bg-purple-500/10',
  },
  custom: {
    label: 'Custom',
    icon: Settings2,
    description: 'Multi-strategy or custom approach defined by parameters.',
    color: 'text-cyan-400',
    bg: 'bg-cyan-500/10',
  },
  arbitrage: {
    label: 'Arbitrage',
    icon: Shuffle,
    description: 'Exploits price differences between markets.',
    color: 'text-cyan-400',
    bg: 'bg-cyan-500/10',
  },
  market_making: {
    label: 'Market Making',
    icon: Store,
    description: 'Places both buy and sell orders to profit from the spread.',
    color: 'text-pink-400',
    bg: 'bg-pink-500/10',
  },
  ml_signal: {
    label: 'ML Signal',
    icon: Brain,
    description: 'Uses machine learning models for signal generation.',
    color: 'text-violet-400',
    bg: 'bg-violet-500/10',
  },
};

const TEMPLATE_ICONS: Record<string, typeof TrendingUp> = {
  momentum: Zap,
  mean_reversion: Repeat,
  custom: Shuffle,
  breakout: ArrowUpRight,
};

const DIFFICULTY_STYLES = {
  beginner: 'bg-green-500/10 text-green-400',
  intermediate: 'bg-amber-500/10 text-amber-400',
  advanced: 'bg-red-500/10 text-red-400',
};

const MARKET_STYLES: Record<string, string> = {
  crypto: 'bg-amber-500/10 text-amber-400',
  equities: 'bg-blue-500/10 text-blue-400',
  all: 'bg-purple-500/10 text-purple-400',
};

// ── Main Component ─────────────────────────────────────────────────────

export function StrategiesPage() {
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showTemplates, setShowTemplates] = useState(true);

  // Fetch user strategies
  const { data: strategiesData, isLoading } = useQuery({
    queryKey: ['strategies'],
    queryFn: () => apiClient.get<{ data: Strategy[] }>('/strategies'),
    staleTime: 30_000,
  });
  const strategies = strategiesData?.data ?? [];

  // Fetch templates
  const { data: templatesData } = useQuery({
    queryKey: ['strategy-templates'],
    queryFn: () => apiClient.get<{ data: StrategyTemplate[] }>('/strategies/templates'),
    staleTime: 300_000,
  });
  const templates = templatesData?.data ?? [];

  // Mutations
  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      apiClient.patch(`/strategies/${id}`, { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['strategies'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/strategies/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['strategies'] }),
  });

  const fromTemplateMutation = useMutation({
    mutationFn: (templateId: string) =>
      apiClient.post('/strategies/from-template', { templateId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['strategies'] });
    },
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

  const hasStrategies = strategies.length > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Lightbulb className="h-6 w-6 text-blue-400" />
          <h1 className="text-2xl font-bold text-slate-100">Strategy Manager</h1>
        </div>
        <div className="flex items-center gap-2">
          {hasStrategies && (
            <button
              onClick={() => setShowTemplates(!showTemplates)}
              className="flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 transition-colors hover:bg-slate-800"
            >
              <Sparkles className="h-4 w-4 text-amber-400" />
              Templates
            </button>
          )}
          <button
            onClick={() => setShowCreateForm(true)}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-500"
          >
            <Plus className="h-4 w-4" />
            Custom Strategy
          </button>
        </div>
      </div>

      {/* AI Insight Banner */}
      <div className="card border-blue-500/20 bg-blue-500/5">
        <div className="flex gap-3">
          <Brain className="mt-0.5 h-5 w-5 shrink-0 text-blue-400" />
          <div>
            <h3 className="text-sm font-semibold text-blue-300">AI-Managed Strategies</h3>
            <p className="mt-1 text-sm text-slate-400">
              The AI engine uses your enabled strategies as{' '}
              <span className="text-slate-200">guidelines for its autonomous research</span>.
              Each cycle, signals are generated matching your strategy types. The Risk Guardian
              enforces the limits you set. Pick a template below to get started in one click.
            </p>
          </div>
        </div>
      </div>

      {/* ── Template Gallery ─────────────────────────────────────── */}
      {(showTemplates || !hasStrategies) && templates.length > 0 && (
        <div>
          <div className="mb-3 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-400" />
            <h2 className="text-sm font-semibold text-slate-300">
              {hasStrategies ? 'Add Another Strategy' : 'Choose a Strategy to Get Started'}
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {templates.map((tpl) => {
              const Icon = TEMPLATE_ICONS[tpl.type] ?? TEMPLATE_ICONS[tpl.strategyType] ?? Settings2;
              const marketStyle = MARKET_STYLES[tpl.market] ?? MARKET_STYLES.crypto;
              const diffStyle = DIFFICULTY_STYLES[tpl.difficulty];
              const alreadyAdded = strategies.some(
                (s) => (s.params as Record<string, unknown>)?.templateId === tpl.id
              );

              return (
                <div
                  key={tpl.id}
                  className={`card transition-all hover:border-slate-600/50 ${
                    alreadyAdded ? 'opacity-60' : ''
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-800">
                      <Icon className="h-5 w-5 text-amber-400" />
                    </div>
                    <div className="flex gap-1.5">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${marketStyle}`}>
                        {tpl.market.toUpperCase()}
                      </span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${diffStyle}`}>
                        {tpl.difficulty}
                      </span>
                    </div>
                  </div>

                  <h3 className="mt-3 text-sm font-semibold text-slate-200">{tpl.name}</h3>
                  <p className="mt-1 text-xs leading-relaxed text-slate-500">
                    {tpl.description}
                  </p>

                  <div className="mt-3 flex flex-wrap gap-1">
                    {tpl.instruments.slice(0, 4).map((inst) => (
                      <span key={inst} className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
                        {inst}
                      </span>
                    ))}
                    {tpl.instruments.length > 4 && (
                      <span className="text-[10px] text-slate-600">+{tpl.instruments.length - 4}</span>
                    )}
                  </div>

                  <div className="mt-2 flex items-center gap-3 text-[10px] text-slate-600">
                    <span>Risk: {tpl.riskOverrides.maxRiskPercent}%/trade</span>
                    <span>TF: {tpl.timeframes.join(', ')}</span>
                  </div>

                  <button
                    onClick={() => fromTemplateMutation.mutate(tpl.id)}
                    disabled={fromTemplateMutation.isPending || alreadyAdded}
                    className={`mt-3 flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                      alreadyAdded
                        ? 'bg-green-500/10 text-green-400 cursor-default'
                        : 'bg-blue-600 text-white hover:bg-blue-500'
                    } disabled:opacity-50`}
                  >
                    {alreadyAdded ? (
                      <>
                        <CheckCircle2 className="h-4 w-4" />
                        Added
                      </>
                    ) : fromTemplateMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <Plus className="h-4 w-4" />
                        Use This Strategy
                      </>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Loading ──────────────────────────────────────────────── */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-blue-400" />
        </div>
      )}

      {/* ── Active Strategies ────────────────────────────────────── */}
      {hasStrategies && (
        <div>
          <h2 className="mb-3 text-sm font-semibold text-slate-300">
            Your Strategies ({strategies.length})
          </h2>
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
                          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px]">
                            {strategy.market?.toUpperCase() ?? 'N/A'}
                          </span>
                          {typeMeta && (
                            <span className="text-slate-600">{typeMeta.description.split('.')[0]}</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() =>
                          toggleMutation.mutate({
                            id: strategy.id,
                            enabled: !strategy.enabled,
                          })
                        }
                        disabled={toggleMutation.isPending}
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

                      <button
                        onClick={() => setExpandedId(isExpanded ? null : strategy.id)}
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

                  {/* Summary Row */}
                  <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                    <div>
                      <div className="text-xs text-slate-500">Risk/Trade</div>
                      <div className="text-sm font-semibold text-slate-200">
                        {strategy.riskPerTrade
                          ? `${parseFloat(strategy.riskPerTrade)}%`
                          : '--'}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500">Max Allocation</div>
                      <div className="text-sm font-semibold text-slate-200">
                        {strategy.maxAllocation
                          ? `${parseFloat(strategy.maxAllocation) * 100}%`
                          : '--'}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500">Instruments</div>
                      <div className="text-sm text-slate-200">
                        {((strategy.params as Record<string, unknown>)?.instruments as string[])
                          ?.slice(0, 3)
                          .join(', ') ?? '--'}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500">Created</div>
                      <div className="text-sm text-slate-200">
                        {new Date(strategy.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                  </div>

                  {/* Expanded: Parameters */}
                  {isExpanded && (
                    <div className="mt-4 border-t border-slate-700/50 pt-4">
                      <div className="flex items-center gap-2 text-xs font-medium text-slate-400">
                        <Settings2 className="h-4 w-4" />
                        Strategy Parameters
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                        {Object.entries(strategy.params ?? {}).map(([key, value]) => {
                          if (key === 'templateId' || key === 'zodType' || key === 'description') return null;
                          return (
                            <div key={key} className="rounded-lg bg-slate-900/50 p-2.5">
                              <div className="text-[10px] font-medium uppercase text-slate-600">
                                {key.replace(/([A-Z])/g, ' $1').trim()}
                              </div>
                              <div className="mt-0.5 text-sm text-slate-300">
                                {Array.isArray(value) ? value.join(', ') : String(value)}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

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
  const [strategyType, setStrategyType] = useState('momentum');
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
          <h3 className="text-lg font-semibold text-slate-100">Create Custom Strategy</h3>
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
