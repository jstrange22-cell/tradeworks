import {
  Bot,
  Brain,
  MessageSquare,
  Globe2,
  ShieldCheck,
  Zap,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  XCircle,
  Play,
  Square,
  RefreshCw,
  Info,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { AgentActivityFeed } from '@/components/agents/AgentActivityFeed';
import { StrategyEvolutionView } from '@/components/agents/StrategyEvolutionView';

// ── Types ──────────────────────────────────────────────────────────────

type AgentStatusValue = 'idle' | 'analyzing' | 'deciding' | 'executing' | 'error';

interface AgentStatusInfo {
  name: string;
  model: string;
  status: AgentStatusValue;
  lastRunAt: string | null;
  lastDurationMs: number | null;
  totalRuns: number;
  errorCount: number;
  tools: string[];
}

interface EngineStatus {
  status: 'running' | 'stopped' | 'starting' | 'stopping';
  startedAt: string | null;
  cycleCount: number;
  lastCycleAt: string | null;
  uptime: number;
  config: {
    cycleIntervalMs: number;
    markets: string[];
    paperMode: boolean;
  };
}

// ── Constants ──────────────────────────────────────────────────────────

const AGENT_DESCRIPTIONS = [
  {
    name: 'Quant Analyst',
    icon: Brain,
    color: 'text-purple-400',
    bg: 'bg-purple-500/10',
    description: 'Studies price patterns, technical indicators, and Smart Money Concepts across multiple timeframes to find high-probability trade setups.',
    model: 'Claude Sonnet 4',
  },
  {
    name: 'Sentiment Analyst',
    icon: MessageSquare,
    color: 'text-cyan-400',
    bg: 'bg-cyan-500/10',
    description: 'Reads market mood from news, social media, on-chain data, and the Fear & Greed Index to detect crowd psychology shifts.',
    model: 'Claude Sonnet 4',
  },
  {
    name: 'Macro Analyst',
    icon: Globe2,
    color: 'text-amber-400',
    bg: 'bg-amber-500/10',
    description: 'Evaluates economic conditions — Fed policy, GDP, inflation, yield curves — to classify the current regime as risk-on or risk-off.',
    model: 'Claude Haiku 4.5',
  },
  {
    name: 'Risk Guardian',
    icon: ShieldCheck,
    color: 'text-green-400',
    bg: 'bg-green-500/10',
    description: 'Enforces hard risk limits: max 1% per trade, 3% daily cap, 6% total heat. Has veto power over every trade decision.',
    model: 'Deterministic',
  },
  {
    name: 'Execution Specialist',
    icon: Zap,
    color: 'text-blue-400',
    bg: 'bg-blue-500/10',
    description: 'Routes approved trades to the right exchange (Coinbase, Alpaca, Polymarket) with optimal order type and minimal slippage.',
    model: 'Deterministic',
  },
];

const STATUS_STYLES: Record<AgentStatusValue, { color: string; bg: string; icon: typeof CheckCircle2 }> = {
  idle: { color: 'text-slate-400', bg: 'bg-slate-500/10', icon: CheckCircle2 },
  analyzing: { color: 'text-blue-400', bg: 'bg-blue-500/10', icon: Loader2 },
  deciding: { color: 'text-amber-400', bg: 'bg-amber-500/10', icon: Loader2 },
  executing: { color: 'text-green-400', bg: 'bg-green-500/10', icon: Loader2 },
  error: { color: 'text-red-400', bg: 'bg-red-500/10', icon: XCircle },
};

function timeAgo(iso: string | null): string {
  if (!iso) return 'never';
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

function formatUptime(ms: number): string {
  if (ms <= 0) return '0s';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

// ── Component ──────────────────────────────────────────────────────────

export function AgentsPage() {
  const queryClient = useQueryClient();

  const { data: engineData } = useQuery({
    queryKey: ['engine-status'],
    queryFn: () => apiClient.get<{ data: EngineStatus }>('/engine/status'),
    refetchInterval: 5_000,
  });
  const engine = engineData?.data;

  const { data: agentData } = useQuery({
    queryKey: ['agents-status-api'],
    queryFn: () => apiClient.get<{ data: AgentStatusInfo[] }>('/agents/status'),
    refetchInterval: 10_000,
  });
  const agents = agentData?.data ?? [];

  const startMutation = useMutation({
    mutationFn: () => apiClient.post('/engine/start', {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['engine-status'] });
      queryClient.invalidateQueries({ queryKey: ['engine-cycles'] });
    },
  });

  const stopMutation = useMutation({
    mutationFn: () => apiClient.post('/engine/stop', {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['engine-status'] }),
  });

  const isRunning = engine?.status === 'running';

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Bot className="h-6 w-6 text-blue-400" />
        <h1 className="text-2xl font-bold text-slate-100">AI Trading Engine</h1>
      </div>

      {/* Hero Explanation */}
      <div className="card border-blue-500/20 bg-blue-500/5">
        <div className="flex gap-3">
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-blue-400" />
          <div>
            <h2 className="text-sm font-semibold text-blue-300">How the AI Engine Works</h2>
            <p className="mt-1 text-sm leading-relaxed text-slate-400">
              When you start the engine, <span className="text-slate-200">5 AI agents work together in automated research-and-trade cycles</span>.
              Each cycle: the Quant Analyst studies patterns → the Sentiment Analyst reads market mood → the Macro Analyst
              evaluates conditions → the Risk Guardian enforces your limits → the Execution Specialist routes approved trades.
              Cycles repeat every {((engine?.config?.cycleIntervalMs ?? 300000) / 60000).toFixed(0)} minutes.
            </p>
          </div>
        </div>
      </div>

      {/* Engine Control Banner */}
      <div className={`card flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 ${
        isRunning ? 'border-green-500/30 bg-green-500/5' : 'border-slate-700/30'
      }`}>
        <div className="flex items-center gap-4">
          <div className={`flex h-12 w-12 items-center justify-center rounded-full ${
            isRunning ? 'bg-green-500/20' : 'bg-slate-700/50'
          }`}>
            {isRunning ? (
              <RefreshCw className="h-6 w-6 animate-spin text-green-400" style={{ animationDuration: '3s' }} />
            ) : (
              <Square className="h-6 w-6 text-slate-500" />
            )}
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-100">
              Engine:{' '}
              <span className={isRunning ? 'text-green-400' : 'text-slate-500'}>
                {engine?.status?.toUpperCase() ?? 'STOPPED'}
              </span>
            </h2>
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
              {isRunning && engine?.startedAt && (
                <span>Uptime: {formatUptime(engine.uptime)}</span>
              )}
              <span>Cycles: {engine?.cycleCount ?? 0}</span>
              <span>Interval: {((engine?.config?.cycleIntervalMs ?? 300000) / 1000)}s</span>
              <span className={`rounded-full px-2 py-0.5 ${
                engine?.config?.paperMode !== false
                  ? 'bg-amber-500/20 text-amber-400'
                  : 'bg-green-500/20 text-green-400'
              }`}>
                {engine?.config?.paperMode !== false ? 'PAPER' : 'LIVE'}
              </span>
            </div>
          </div>
        </div>

        <button
          onClick={() => isRunning ? stopMutation.mutate() : startMutation.mutate()}
          disabled={startMutation.isPending || stopMutation.isPending}
          className={`flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition-colors ${
            isRunning
              ? 'bg-red-600 text-white hover:bg-red-500'
              : 'bg-green-600 text-white hover:bg-green-500'
          } disabled:opacity-50`}
        >
          {(startMutation.isPending || stopMutation.isPending) ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : isRunning ? (
            <Square className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          {isRunning ? 'Stop Engine' : 'Start Engine'}
        </button>
      </div>

      {/* Agent Cards with Descriptions */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        {AGENT_DESCRIPTIONS.map((agentDef) => {
          const liveAgent = agents.find((a) => a.name === agentDef.name);
          const status: AgentStatusValue = liveAgent?.status ?? 'idle';
          const style = STATUS_STYLES[status];
          const Icon = agentDef.icon;
          const StatusIcon = style.icon;
          const isSpinning = status === 'analyzing' || status === 'deciding' || status === 'executing';

          return (
            <div key={agentDef.name} className="card">
              <div className="flex items-start justify-between">
                <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${agentDef.bg}`}>
                  <Icon className={`h-5 w-5 ${agentDef.color}`} />
                </div>
                <div className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${style.bg} ${style.color}`}>
                  <StatusIcon className={`h-3 w-3 ${isSpinning ? 'animate-spin' : ''}`} />
                  {status.toUpperCase()}
                </div>
              </div>
              <h3 className="mt-2 text-sm font-semibold text-slate-200">{agentDef.name}</h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">{agentDef.description}</p>
              <div className="mt-3 flex items-center justify-between text-[10px] text-slate-600">
                <span>{agentDef.model}</span>
                {liveAgent && (
                  <div className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {timeAgo(liveAgent.lastRunAt)}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Agent Activity Feed */}
      <AgentActivityFeed />

      {/* Strategy Evolution Insights */}
      <StrategyEvolutionView />
    </div>
  );
}
