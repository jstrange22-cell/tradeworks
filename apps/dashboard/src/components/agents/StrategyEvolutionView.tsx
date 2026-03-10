import { useMemo } from 'react';
import { BarChart3, Target, Activity } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

interface CycleResult {
  agents: {
    quantBias: string;
    quantConfidence: number;
    quantSignals: Array<{ instrument: string; direction: string; indicator: string; confidence: number }>;
    sentimentScore: number;
    macroRegime: string;
  };
  decisions: Array<{ instrument: string; direction: string; confidence: number; approved: boolean }>;
  executions: Array<{ instrument: string; side: string; quantity: number; price: number }>;
  status: string;
}

interface CyclesResponse {
  data: CycleResult[];
  total: number;
}

export function StrategyEvolutionView() {
  const { data } = useQuery<CyclesResponse>({
    queryKey: ['engine-cycles'],
    queryFn: () => apiClient.get<CyclesResponse>('/engine/cycles', { limit: 50 }),
    refetchInterval: 60_000,
  });

  const cycles = data?.data ?? [];

  const insights = useMemo(() => {
    if (cycles.length === 0) return null;

    // Signal type breakdown
    const indicatorCounts: Record<string, number> = {};
    const instrumentCounts: Record<string, number> = {};
    let totalSignals = 0;
    let totalApproved = 0;
    let totalRejected = 0;
    let bullishCycles = 0;
    let bearishCycles = 0;
    let neutralCycles = 0;
    let sentimentSum = 0;
    const regimeCounts: Record<string, number> = {};

    for (const cycle of cycles) {
      // Count indicators
      for (const sig of cycle.agents.quantSignals) {
        indicatorCounts[sig.indicator] = (indicatorCounts[sig.indicator] ?? 0) + 1;
        totalSignals++;
      }

      // Count traded instruments
      for (const exec of cycle.executions) {
        instrumentCounts[exec.instrument] = (instrumentCounts[exec.instrument] ?? 0) + 1;
      }

      // Count decisions
      for (const d of cycle.decisions) {
        if (d.approved) totalApproved++;
        else totalRejected++;
      }

      // Bias
      if (cycle.agents.quantBias === 'bullish') bullishCycles++;
      else if (cycle.agents.quantBias === 'bearish') bearishCycles++;
      else neutralCycles++;

      // Sentiment
      sentimentSum += cycle.agents.sentimentScore;

      // Macro
      regimeCounts[cycle.agents.macroRegime] = (regimeCounts[cycle.agents.macroRegime] ?? 0) + 1;
    }

    const topIndicators = Object.entries(indicatorCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    const topInstruments = Object.entries(instrumentCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    const topRegime = Object.entries(regimeCounts).sort((a, b) => b[1] - a[1])[0];

    const approvalRate = totalApproved + totalRejected > 0
      ? Math.round((totalApproved / (totalApproved + totalRejected)) * 100)
      : 0;

    return {
      totalCycles: cycles.length,
      totalSignals,
      topIndicators,
      topInstruments,
      approvalRate,
      totalApproved,
      totalRejected,
      bullishCycles,
      bearishCycles,
      neutralCycles,
      avgSentiment: cycles.length > 0 ? sentimentSum / cycles.length : 0,
      dominantRegime: topRegime?.[0] ?? 'neutral',
      dominantRegimeCount: topRegime?.[1] ?? 0,
    };
  }, [cycles]);

  if (!insights || insights.totalCycles === 0) {
    return null;
  }

  return (
    <div className="card">
      <div className="card-header flex items-center gap-2">
        <Activity className="h-4 w-4 text-blue-400" />
        AI Strategy Insights
        <span className="ml-auto text-xs text-slate-500">Last {insights.totalCycles} cycles</span>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {/* Market Bias */}
        <div className="rounded-lg bg-slate-800/50 p-3">
          <div className="text-xs text-slate-500">Market Bias</div>
          <div className="mt-1 flex items-center gap-2">
            <div className="flex gap-1">
              <span className="text-green-400 text-sm font-bold">{insights.bullishCycles}</span>
              <span className="text-slate-600">/</span>
              <span className="text-red-400 text-sm font-bold">{insights.bearishCycles}</span>
              <span className="text-slate-600">/</span>
              <span className="text-slate-400 text-sm font-bold">{insights.neutralCycles}</span>
            </div>
          </div>
          <div className="mt-1 flex gap-0.5">
            {insights.bullishCycles > 0 && (
              <div className="h-1.5 rounded-full bg-green-500" style={{ width: `${(insights.bullishCycles / insights.totalCycles) * 100}%` }} />
            )}
            {insights.bearishCycles > 0 && (
              <div className="h-1.5 rounded-full bg-red-500" style={{ width: `${(insights.bearishCycles / insights.totalCycles) * 100}%` }} />
            )}
            {insights.neutralCycles > 0 && (
              <div className="h-1.5 rounded-full bg-slate-600" style={{ width: `${(insights.neutralCycles / insights.totalCycles) * 100}%` }} />
            )}
          </div>
          <div className="mt-1 text-[10px] text-slate-600">Bull / Bear / Neutral</div>
        </div>

        {/* Approval Rate */}
        <div className="rounded-lg bg-slate-800/50 p-3">
          <div className="text-xs text-slate-500">Risk Approval</div>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="text-lg font-bold text-slate-100">{insights.approvalRate}%</span>
            <span className="text-xs text-slate-500">pass rate</span>
          </div>
          <div className="mt-1 text-xs text-slate-600">
            {insights.totalApproved} approved · {insights.totalRejected} rejected
          </div>
        </div>

        {/* Avg Sentiment */}
        <div className="rounded-lg bg-slate-800/50 p-3">
          <div className="text-xs text-slate-500">Avg Sentiment</div>
          <div className={`mt-1 text-lg font-bold ${
            insights.avgSentiment > 0.1 ? 'text-green-400' : insights.avgSentiment < -0.1 ? 'text-red-400' : 'text-slate-300'
          }`}>
            {insights.avgSentiment > 0 ? '+' : ''}{insights.avgSentiment.toFixed(2)}
          </div>
          <div className="mt-1 text-xs text-slate-600">
            {insights.avgSentiment > 0.2 ? 'Greed zone' : insights.avgSentiment < -0.2 ? 'Fear zone' : 'Neutral'}
          </div>
        </div>

        {/* Dominant Regime */}
        <div className="rounded-lg bg-slate-800/50 p-3">
          <div className="text-xs text-slate-500">Macro Regime</div>
          <div className="mt-1 text-sm font-bold capitalize text-slate-100">
            {insights.dominantRegime}
          </div>
          <div className="mt-1 text-xs text-slate-600">
            {insights.dominantRegimeCount} of {insights.totalCycles} cycles
          </div>
        </div>
      </div>

      {/* Signal Types & Top Instruments */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {insights.topIndicators.length > 0 && (
          <div>
            <div className="flex items-center gap-1 text-xs font-medium text-slate-400">
              <BarChart3 className="h-3.5 w-3.5" />
              Top Signal Sources
            </div>
            <div className="mt-2 space-y-1.5">
              {insights.topIndicators.map(([name, count]) => (
                <div key={name} className="flex items-center gap-2">
                  <div className="h-1.5 rounded-full bg-blue-500" style={{ width: `${(count / insights.totalSignals) * 100}%`, minWidth: '8px' }} />
                  <span className="text-xs text-slate-300">{name}</span>
                  <span className="ml-auto text-xs text-slate-600">{count}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {insights.topInstruments.length > 0 && (
          <div>
            <div className="flex items-center gap-1 text-xs font-medium text-slate-400">
              <Target className="h-3.5 w-3.5" />
              Most Traded
            </div>
            <div className="mt-2 space-y-1.5">
              {insights.topInstruments.map(([name, count]) => (
                <div key={name} className="flex items-center gap-2">
                  <div className="h-1.5 rounded-full bg-green-500" style={{ width: `${Math.min(count * 20, 100)}%`, minWidth: '8px' }} />
                  <span className="text-xs font-medium text-slate-300">{name}</span>
                  <span className="ml-auto text-xs text-slate-600">{count} trades</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
