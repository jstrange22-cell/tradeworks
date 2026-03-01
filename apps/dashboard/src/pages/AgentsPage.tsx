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
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

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

interface AgentLogEntry {
  id: string;
  agentType: string;
  action: string;
  summary: string;
  decision: string | null;
  durationMs: number | null;
  costUsd: number | null;
  createdAt: string;
}

interface CycleInfo {
  id: string;
  cycleNumber: number;
  startedAt: string;
  completedAt: string | null;
  status: string;
  ordersPlaced: number;
  totalCostUsd: number | null;
}

// ── Constants ──────────────────────────────────────────────────────────

const AGENT_META: Record<string, { label: string; icon: typeof Bot }> = {
  'Quant Analyst': { label: 'Quant Agent', icon: Brain },
  'Sentiment Analyst': { label: 'Sentiment Agent', icon: MessageSquare },
  'Macro Analyst': { label: 'Macro Agent', icon: Globe2 },
  'Risk Guardian': { label: 'Risk Agent', icon: ShieldCheck },
  'Execution Specialist': { label: 'Execution Agent', icon: Zap },
};

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

  // Engine status
  const { data: engineData } = useQuery({
    queryKey: ['engine-status'],
    queryFn: () => apiClient.get<{ data: EngineStatus }>('/engine/status'),
    refetchInterval: 5_000,
  });
  const engine = engineData?.data;

  // Agent status
  const { data: agentData } = useQuery({
    queryKey: ['agents-status-api'],
    queryFn: () => apiClient.get<{ data: AgentStatusInfo[] }>('/agents/status'),
    refetchInterval: 10_000,
  });
  const agents = agentData?.data ?? [];

  // Agent logs
  const { data: logsData } = useQuery({
    queryKey: ['agents-logs'],
    queryFn: () => apiClient.get<{ data: AgentLogEntry[] }>('/agents/logs?limit=20'),
    refetchInterval: 10_000,
  });
  const logs = logsData?.data ?? [];

  // Cycles
  const { data: cyclesData } = useQuery({
    queryKey: ['agents-cycles'],
    queryFn: () => apiClient.get<{ data: CycleInfo[] }>('/agents/cycles?limit=10'),
    refetchInterval: 10_000,
  });
  const cycles = cyclesData?.data ?? [];

  // Start/Stop mutations
  const startMutation = useMutation({
    mutationFn: () => apiClient.post('/engine/start', {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['engine-status'] }),
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
        <h1 className="text-2xl font-bold text-slate-100">Agent Monitor</h1>
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
              Trading Engine:{' '}
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

      {/* Agent Status Cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        {agents.length > 0 ? agents.map((agent) => {
          const meta = AGENT_META[agent.name] ?? { label: agent.name, icon: Bot };
          const style = STATUS_STYLES[agent.status] ?? STATUS_STYLES.idle;
          const Icon = meta.icon;
          const StatusIcon = style.icon;
          const isSpinning = agent.status === 'analyzing' || agent.status === 'deciding' || agent.status === 'executing';

          return (
            <div key={agent.name} className="card">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <Icon className="h-5 w-5 text-blue-400" />
                  <h3 className="text-sm font-semibold text-slate-200">{meta.label}</h3>
                </div>
                <div className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${style.bg} ${style.color}`}>
                  <StatusIcon className={`h-3 w-3 ${isSpinning ? 'animate-spin' : ''}`} />
                  {agent.status.toUpperCase()}
                </div>
              </div>

              <p className="mt-2 text-xs text-slate-500">{agent.model} model</p>

              <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                <div className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {timeAgo(agent.lastRunAt)}
                </div>
                <div className="flex items-center gap-3">
                  <span>{agent.totalRuns} runs</span>
                  {agent.errorCount > 0 && (
                    <span className="flex items-center gap-0.5 text-red-400">
                      <AlertTriangle className="h-3 w-3" />
                      {agent.errorCount}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        }) : (
          <div className="col-span-full card text-center text-sm text-slate-500 py-8">
            No agent data available. Start the engine to see agent activity.
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Decision Log */}
        <div className="card">
          <div className="card-header">Recent Decision Log</div>
          {logs.length > 0 ? (
            <div className="max-h-96 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-800/90 backdrop-blur-sm">
                  <tr className="border-b border-slate-700/50 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                    <th className="pb-2 pr-3">Time</th>
                    <th className="pb-2 pr-3">Agent</th>
                    <th className="pb-2 pr-3">Action</th>
                    <th className="pb-2">Summary</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id} className="table-row">
                      <td className="py-2 pr-3 text-xs text-slate-500">
                        {new Date(log.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </td>
                      <td className="py-2 pr-3">
                        <span className="badge-info text-xs">{log.agentType}</span>
                      </td>
                      <td className="py-2 pr-3 text-xs text-slate-400">{log.action}</td>
                      <td className="py-2 text-xs text-slate-300">
                        <div>{log.summary}</div>
                        {log.decision && <div className="mt-0.5 text-blue-400">{log.decision}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="py-8 text-center text-sm text-slate-500">
              No agent logs yet. Start the engine to see decisions.
            </p>
          )}
        </div>

        {/* Cycle Timeline */}
        <div className="card">
          <div className="card-header">Cycle Timeline</div>
          {cycles.length > 0 ? (
            <div className="max-h-96 space-y-3 overflow-y-auto">
              {cycles.map((cycle) => {
                const duration = cycle.completedAt
                  ? Math.round((new Date(cycle.completedAt).getTime() - new Date(cycle.startedAt).getTime()) / 1000)
                  : null;

                return (
                  <div key={cycle.id} className="flex items-center gap-4 rounded-lg border border-slate-700/30 bg-slate-800/30 p-3">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold ${
                      cycle.status === 'completed' ? 'bg-green-500/10 text-green-400'
                        : cycle.status === 'running' ? 'bg-blue-500/10 text-blue-400'
                        : 'bg-red-500/10 text-red-400'
                    }`}>
                      #{cycle.cycleNumber}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-slate-200">Cycle {cycle.cycleNumber}</span>
                        <span className={`text-xs font-medium ${
                          cycle.status === 'completed' ? 'text-green-400'
                            : cycle.status === 'running' ? 'text-blue-400'
                            : 'text-red-400'
                        }`}>
                          {cycle.status.toUpperCase()}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-4 text-xs text-slate-500">
                        <span>{new Date(cycle.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        {duration !== null && <span>{duration}s</span>}
                        <span>{cycle.ordersPlaced} orders</span>
                        {cycle.totalCostUsd !== null && <span>${cycle.totalCostUsd.toFixed(3)}</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="py-8 text-center text-sm text-slate-500">
              No cycles yet. Start the engine to begin trading cycles.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
