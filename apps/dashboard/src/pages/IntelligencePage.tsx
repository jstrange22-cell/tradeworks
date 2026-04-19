import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

interface AgentResult {
  agent: string;
  status: 'success' | 'error' | 'skipped';
  durationMs: number;
  findings: number;
  summary: string;
}

interface ActionItem {
  priority: 'high' | 'medium' | 'low';
  market: string;
  action: string;
  details: string;
}

interface MacroSignal {
  name: string;
  value: number;
  interpretation: 'bullish' | 'bearish' | 'neutral';
  weight: number;
}

interface Briefing {
  regime: {
    regime: string;
    confidence: number;
    positionSizeMultiplier: number;
    summary: string;
    signals: MacroSignal[];
  };
  allocation: {
    allocations: Array<{
      market: string;
      allocationPercent: number;
      allocationUsd: number;
      reasoning: string;
      riskLevel: string;
      status: string;
    }>;
    cashReserve: number;
    cashReservePercent: number;
    totalCapital: number;
  };
  agentResults: AgentResult[];
  learningReport: {
    insights: Array<{
      parameter: string;
      currentValue: number;
      suggestedValue: number;
      reason: string;
      confidence: number;
    }>;
    overallWinRate: number;
    avgPnlPerTrade: number;
    bestExitType: string;
    worstExitType: string;
  } | null;
  totalOpportunities: number;
  actionItems: ActionItem[];
  durationMs: number;
  generatedAt: string;
}

const regimeColors: Record<string, string> = {
  risk_on: 'bg-green-500/20 text-green-400 border-green-500/30',
  risk_off: 'bg-red-500/20 text-red-400 border-red-500/30',
  transitioning: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  crisis: 'bg-red-700/20 text-red-300 border-red-700/30',
};

const priorityColors: Record<string, string> = {
  high: 'border-l-red-500',
  medium: 'border-l-yellow-500',
  low: 'border-l-blue-500',
};

const signalColors: Record<string, string> = {
  bullish: 'text-green-400',
  bearish: 'text-red-400',
  neutral: 'text-gray-400',
};

export function IntelligencePage() {
  const [tab, setTab] = useState<'briefing' | 'learning' | 'allocation'>('briefing');

  const { data: briefing, isLoading, refetch } = useQuery<{ data: Briefing }>({
    queryKey: ['intel-briefing'],
    queryFn: () => apiClient.get('/intel/briefing'),
    refetchInterval: 300_000,
  });

  const scanMutation = useMutation({
    mutationFn: () => apiClient.get('/intel/scan'),
    onSuccess: () => refetch(),
  });

  const b = briefing?.data;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">APEX Intelligence</h1>
          <p className="text-sm text-gray-400">
            Multi-market agent swarm — crypto, stocks, predictions, sports
          </p>
        </div>
        <button
          onClick={() => scanMutation.mutate()}
          disabled={scanMutation.isPending}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {scanMutation.isPending ? 'Scanning...' : 'Run Scan'}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg bg-gray-800 p-1">
        {(['briefing', 'learning', 'allocation'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-md px-3 py-2 text-sm font-medium capitalize transition-colors ${
              tab === t ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
        </div>
      ) : !b ? (
        <div className="rounded-lg bg-gray-800 p-8 text-center text-gray-400">
          No briefing available. Click "Run Scan" to generate one.
        </div>
      ) : (
        <>
          {tab === 'briefing' && (
            <div className="space-y-4">
              {/* Macro Regime */}
              <div className={`rounded-lg border p-4 ${regimeColors[b.regime.regime] ?? regimeColors.transitioning}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-semibold uppercase tracking-wider opacity-70">Macro Regime</span>
                    <h2 className="text-xl font-bold capitalize">{b.regime.regime.replace('_', ' ')}</h2>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold">{b.regime.confidence}%</div>
                    <div className="text-xs opacity-70">confidence</div>
                  </div>
                </div>
                <p className="mt-2 text-sm opacity-80">{b.regime.summary}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {b.regime.signals.map((s) => (
                    <span
                      key={s.name}
                      className={`rounded-full bg-black/20 px-2 py-0.5 text-xs ${signalColors[s.interpretation]}`}
                    >
                      {s.name}: {typeof s.value === 'number' ? s.value.toFixed(1) : s.value}
                    </span>
                  ))}
                </div>
              </div>

              {/* Agent Results */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {b.agentResults.map((a) => (
                  <div key={a.agent} className="rounded-lg bg-gray-800 p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-white">{a.agent}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs ${
                        a.status === 'success' ? 'bg-green-500/20 text-green-400' :
                        a.status === 'error' ? 'bg-red-500/20 text-red-400' :
                        'bg-gray-600/20 text-gray-400'
                      }`}>
                        {a.status}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-gray-400">{a.summary}</p>
                    <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
                      <span>{a.findings} findings</span>
                      <span>{a.durationMs}ms</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Action Items */}
              {b.actionItems.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-white">Action Items</h3>
                  {b.actionItems.map((item, i) => (
                    <div
                      key={i}
                      className={`rounded-lg border-l-4 bg-gray-800 p-3 ${priorityColors[item.priority]}`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-gray-700 px-1.5 py-0.5 text-[10px] uppercase text-gray-300">
                          {item.market}
                        </span>
                        <span className="text-sm font-medium text-white">{item.action}</span>
                      </div>
                      <p className="mt-1 text-xs text-gray-400">{item.details}</p>
                    </div>
                  ))}
                </div>
              )}

              <div className="text-xs text-gray-500">
                Scan completed in {b.durationMs}ms at {new Date(b.generatedAt).toLocaleString()}
              </div>
            </div>
          )}

          {tab === 'learning' && b.learningReport && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-lg bg-gray-800 p-3 text-center">
                  <div className="text-2xl font-bold text-white">{b.learningReport.overallWinRate.toFixed(1)}%</div>
                  <div className="text-xs text-gray-400">Win Rate</div>
                </div>
                <div className="rounded-lg bg-gray-800 p-3 text-center">
                  <div className={`text-2xl font-bold ${b.learningReport.avgPnlPerTrade >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {b.learningReport.avgPnlPerTrade >= 0 ? '+' : ''}{b.learningReport.avgPnlPerTrade.toFixed(4)}
                  </div>
                  <div className="text-xs text-gray-400">Avg P&L/Trade (SOL)</div>
                </div>
                <div className="rounded-lg bg-gray-800 p-3 text-center">
                  <div className="text-2xl font-bold text-green-400">{b.learningReport.bestExitType}</div>
                  <div className="text-xs text-gray-400">Best Exit</div>
                </div>
                <div className="rounded-lg bg-gray-800 p-3 text-center">
                  <div className="text-2xl font-bold text-red-400">{b.learningReport.worstExitType}</div>
                  <div className="text-xs text-gray-400">Worst Exit</div>
                </div>
              </div>

              {b.learningReport.insights.length > 0 ? (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-white">Optimization Insights</h3>
                  {b.learningReport.insights.map((insight, i) => (
                    <div key={i} className="rounded-lg bg-gray-800 p-3">
                      <div className="flex items-center justify-between">
                        <code className="text-sm text-indigo-400">{insight.parameter}</code>
                        <span className={`rounded-full px-2 py-0.5 text-xs ${
                          insight.confidence >= 70 ? 'bg-green-500/20 text-green-400' :
                          insight.confidence >= 50 ? 'bg-yellow-500/20 text-yellow-400' :
                          'bg-gray-600/20 text-gray-400'
                        }`}>
                          {insight.confidence}% confidence
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-xs">
                        <span className="text-gray-400">Current: {insight.currentValue}</span>
                        <span className="text-gray-500">&rarr;</span>
                        <span className="text-white font-medium">Suggested: {insight.suggestedValue}</span>
                      </div>
                      <p className="mt-1 text-xs text-gray-400">{insight.reason}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg bg-gray-800 p-6 text-center text-gray-400">
                  Not enough trade data for insights yet. Need 20+ trades per strategy.
                </div>
              )}
            </div>
          )}

          {tab === 'learning' && !b.learningReport && (
            <div className="rounded-lg bg-gray-800 p-8 text-center text-gray-400">
              Self-learning needs trade history. Will activate after 20+ completed trades.
            </div>
          )}

          {tab === 'allocation' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                {b.allocation.allocations.map((a) => (
                  <div key={a.market} className="rounded-lg bg-gray-800 p-3">
                    <div className="text-xs uppercase text-gray-400">{a.market}</div>
                    <div className="text-xl font-bold text-white">{a.allocationPercent}%</div>
                    <div className="text-xs text-gray-500">${a.allocationUsd.toFixed(0)}</div>
                    <span className={`mt-1 inline-block rounded-full px-1.5 py-0.5 text-[10px] ${
                      a.status === 'active' ? 'bg-green-500/20 text-green-400' : 'bg-gray-600/20 text-gray-500'
                    }`}>
                      {a.status}
                    </span>
                  </div>
                ))}
                <div className="rounded-lg bg-gray-800 p-3">
                  <div className="text-xs uppercase text-gray-400">Cash</div>
                  <div className="text-xl font-bold text-white">{b.allocation.cashReservePercent}%</div>
                  <div className="text-xs text-gray-500">${b.allocation.cashReserve.toFixed(0)}</div>
                </div>
              </div>
              <div className="space-y-2">
                {b.allocation.allocations.map((a) => (
                  <div key={a.market} className="rounded-lg bg-gray-800 p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium capitalize text-white">{a.market}</span>
                      <span className={`text-xs ${
                        a.riskLevel === 'extreme' ? 'text-red-400' :
                        a.riskLevel === 'high' ? 'text-orange-400' :
                        a.riskLevel === 'medium' ? 'text-yellow-400' :
                        'text-green-400'
                      }`}>
                        {a.riskLevel} risk
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-gray-400">{a.reasoning}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
