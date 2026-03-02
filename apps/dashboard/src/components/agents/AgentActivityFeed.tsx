import { useState } from 'react';
import {
  Brain,
  MessageSquare,
  Globe2,
  ShieldCheck,
  Zap,
  ChevronDown,
  ChevronUp,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CycleResult {
  id: string;
  cycleNumber: number;
  timestamp: string;
  status: 'completed' | 'no_signals' | 'circuit_breaker' | 'error';
  durationMs: number;
  agents: {
    quantBias: 'bullish' | 'bearish' | 'neutral';
    quantConfidence: number;
    quantSignals: Array<{
      instrument: string;
      direction: 'long' | 'short';
      indicator: string;
      confidence: number;
    }>;
    sentimentScore: number;
    sentimentLabel: string;
    macroRegime: string;
    macroRiskLevel: string;
  };
  decisions: Array<{
    instrument: string;
    direction: string;
    confidence: number;
    approved: boolean;
    rejectionReason?: string;
  }>;
  riskAssessment: {
    portfolioHeat: number;
    drawdownPercent: number;
    approved: number;
    rejected: number;
  };
  executions: Array<{
    instrument: string;
    side: string;
    quantity: number;
    price: number;
    status: string;
    slippage?: number;
  }>;
  summary: string;
}

interface CyclesResponse {
  data: CycleResult[];
  total: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, string> = {
  completed: 'bg-green-500/10 text-green-400 border-green-500/20',
  no_signals: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
  circuit_breaker: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  error: 'bg-red-500/10 text-red-400 border-red-500/20',
};

const BIAS_ICONS = {
  bullish: TrendingUp,
  bearish: TrendingDown,
  neutral: Minus,
};

function timeStr(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AgentActivityFeed() {
  const [expandedCycle, setExpandedCycle] = useState<string | null>(null);

  const { data } = useQuery<CyclesResponse>({
    queryKey: ['engine-cycles'],
    queryFn: () => apiClient.get<CyclesResponse>('/engine/cycles', { limit: 30 }),
    refetchInterval: 10_000,
  });

  const cycles = data?.data ?? [];

  if (cycles.length === 0) {
    return (
      <div className="card py-8 text-center">
        <Brain className="mx-auto h-8 w-8 text-slate-600" />
        <p className="mt-2 text-sm text-slate-500">
          No cycles yet. Start the engine to see AI agent activity.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-300">Agent Activity Feed</h3>
        <span className="text-xs text-slate-500">{cycles.length} cycles</span>
      </div>

      <div className="max-h-[500px] space-y-2 overflow-y-auto pr-1">
        {cycles.map((cycle) => {
          const isExpanded = expandedCycle === cycle.id;
          const BiasIcon = BIAS_ICONS[cycle.agents.quantBias] ?? Minus;
          const statusClass = STATUS_COLORS[cycle.status] ?? STATUS_COLORS.error;

          return (
            <div key={cycle.id} className={`rounded-lg border p-3 ${statusClass}`}>
              {/* Cycle Header */}
              <button
                onClick={() => setExpandedCycle(isExpanded ? null : cycle.id)}
                className="flex w-full items-start justify-between text-left"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold">#{cycle.cycleNumber}</span>
                    <span className="text-xs opacity-70">{timeStr(cycle.timestamp)}</span>
                    <span className="text-xs opacity-50">{cycle.durationMs}ms</span>
                  </div>
                  <p className="mt-1 text-sm leading-snug">{cycle.summary}</p>
                </div>
                <div className="ml-2 shrink-0">
                  {isExpanded ? <ChevronUp className="h-4 w-4 opacity-50" /> : <ChevronDown className="h-4 w-4 opacity-50" />}
                </div>
              </button>

              {/* Expanded Details */}
              {isExpanded && (
                <div className="mt-3 space-y-3 border-t border-current/10 pt-3">
                  {/* Agent Outputs */}
                  <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-md bg-black/20 p-2">
                      <div className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide opacity-70">
                        <Brain className="h-3 w-3" /> Quant
                      </div>
                      <div className="mt-1 flex items-center gap-1">
                        <BiasIcon className="h-3.5 w-3.5" />
                        <span className="text-sm font-semibold capitalize">{cycle.agents.quantBias}</span>
                      </div>
                      <div className="text-xs opacity-70">{(cycle.agents.quantConfidence * 100).toFixed(0)}% confidence</div>
                    </div>

                    <div className="rounded-md bg-black/20 p-2">
                      <div className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide opacity-70">
                        <MessageSquare className="h-3 w-3" /> Sentiment
                      </div>
                      <div className="mt-1 text-sm font-semibold">
                        {cycle.agents.sentimentScore > 0 ? '+' : ''}{cycle.agents.sentimentScore.toFixed(2)}
                      </div>
                      <div className="text-xs capitalize opacity-70">{cycle.agents.sentimentLabel}</div>
                    </div>

                    <div className="rounded-md bg-black/20 p-2">
                      <div className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide opacity-70">
                        <Globe2 className="h-3 w-3" /> Macro
                      </div>
                      <div className="mt-1 text-sm font-semibold capitalize">{cycle.agents.macroRegime}</div>
                      <div className="text-xs capitalize opacity-70">Risk: {cycle.agents.macroRiskLevel}</div>
                    </div>
                  </div>

                  {/* Signals */}
                  {cycle.agents.quantSignals.length > 0 && (
                    <div>
                      <div className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide opacity-70">
                        <Zap className="h-3 w-3" /> Signals
                      </div>
                      <div className="mt-1 space-y-1">
                        {cycle.agents.quantSignals.map((sig, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs">
                            <span className={sig.direction === 'long' ? 'text-green-400' : 'text-red-400'}>
                              {sig.direction.toUpperCase()}
                            </span>
                            <span className="font-medium">{sig.instrument}</span>
                            <span className="opacity-50">via {sig.indicator}</span>
                            <span className="ml-auto opacity-70">{(sig.confidence * 100).toFixed(0)}%</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Risk Assessment */}
                  <div className="flex items-center gap-4 text-xs">
                    <div className="flex items-center gap-1">
                      <ShieldCheck className="h-3 w-3 opacity-70" />
                      <span>Heat: {cycle.riskAssessment.portfolioHeat.toFixed(1)}%</span>
                    </div>
                    <span>DD: {cycle.riskAssessment.drawdownPercent.toFixed(1)}%</span>
                    <span className="text-green-400">{cycle.riskAssessment.approved} approved</span>
                    {cycle.riskAssessment.rejected > 0 && (
                      <span className="text-red-400">{cycle.riskAssessment.rejected} rejected</span>
                    )}
                  </div>

                  {/* Rejections */}
                  {cycle.decisions.filter(d => !d.approved).map((d, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-red-400/80">
                      <AlertTriangle className="h-3 w-3" />
                      <span>{d.instrument} {d.direction} — {d.rejectionReason}</span>
                    </div>
                  ))}

                  {/* Executions */}
                  {cycle.executions.length > 0 && (
                    <div>
                      <div className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide opacity-70">
                        <Zap className="h-3 w-3" /> Executions
                      </div>
                      {cycle.executions.map((exec, i) => (
                        <div key={i} className="mt-1 flex items-center gap-2 text-xs">
                          <span className={exec.side === 'buy' ? 'text-green-400' : 'text-red-400'}>
                            {exec.side.toUpperCase()}
                          </span>
                          <span>{exec.quantity}</span>
                          <span className="font-medium">{exec.instrument}</span>
                          <span className="opacity-70">@ ${exec.price.toLocaleString()}</span>
                          {exec.slippage !== undefined && (
                            <span className="opacity-50">{exec.slippage.toFixed(1)} bps slip</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
