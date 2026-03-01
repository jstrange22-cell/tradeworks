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
} from 'lucide-react';
import { useAgentStatus } from '@/hooks/useAgentStatus';
import type { AgentType, AgentStatusValue } from '@/stores/agent-store';

const AGENT_META: Record<
  AgentType,
  { label: string; icon: typeof Bot; description: string }
> = {
  quant: {
    label: 'Quant Agent',
    icon: Brain,
    description: 'Technical analysis, indicator signals, pattern detection',
  },
  sentiment: {
    label: 'Sentiment Agent',
    icon: MessageSquare,
    description: 'Social sentiment, news analysis, trending detection',
  },
  macro: {
    label: 'Macro Agent',
    icon: Globe2,
    description: 'Economic events, rate impacts, macro outlook',
  },
  risk: {
    label: 'Risk Agent',
    icon: ShieldCheck,
    description: 'Position sizing, VaR checks, correlation limits',
  },
  execution: {
    label: 'Execution Agent',
    icon: Zap,
    description: 'Order routing, slippage optimization, fill management',
  },
};

const STATUS_STYLES: Record<
  AgentStatusValue,
  { color: string; bg: string; icon: typeof CheckCircle2 }
> = {
  idle: { color: 'text-slate-400', bg: 'bg-slate-500/10', icon: CheckCircle2 },
  analyzing: { color: 'text-blue-400', bg: 'bg-blue-500/10', icon: Loader2 },
  deciding: { color: 'text-amber-400', bg: 'bg-amber-500/10', icon: Loader2 },
  executing: { color: 'text-green-400', bg: 'bg-green-500/10', icon: Loader2 },
  error: { color: 'text-red-400', bg: 'bg-red-500/10', icon: XCircle },
};

function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

export function AgentsPage() {
  const { agents, logs, cycles } = useAgentStatus();

  const agentList = Object.values(agents);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Bot className="h-6 w-6 text-blue-400" />
        <h1 className="text-2xl font-bold text-slate-100">Agent Monitor</h1>
      </div>

      {/* Agent Status Cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        {agentList.map((agent) => {
          const meta = AGENT_META[agent.agentType];
          const style = STATUS_STYLES[agent.status];
          const Icon = meta.icon;
          const StatusIcon = style.icon;
          const isSpinning =
            agent.status === 'analyzing' ||
            agent.status === 'deciding' ||
            agent.status === 'executing';

          return (
            <div key={agent.agentType} className="card">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <Icon className="h-5 w-5 text-blue-400" />
                  <h3 className="text-sm font-semibold text-slate-200">
                    {meta.label}
                  </h3>
                </div>
                <div
                  className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${style.bg} ${style.color}`}
                >
                  <StatusIcon
                    className={`h-3 w-3 ${isSpinning ? 'animate-spin' : ''}`}
                  />
                  {agent.status.toUpperCase()}
                </div>
              </div>

              <p className="mt-2 text-xs text-slate-500">{meta.description}</p>

              {agent.currentTask && (
                <div className="mt-3 rounded bg-slate-700/30 px-2 py-1.5 text-xs text-slate-300">
                  {agent.currentTask}
                </div>
              )}

              <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                <div className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {timeAgo(agent.lastActivityAt)}
                </div>
                <div className="flex items-center gap-3">
                  <span>{agent.cyclesCompleted} cycles</span>
                  {agent.errorsToday > 0 && (
                    <span className="flex items-center gap-0.5 text-red-400">
                      <AlertTriangle className="h-3 w-3" />
                      {agent.errorsToday}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Decision Log */}
        <div className="card">
          <div className="card-header">Recent Decision Log</div>
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
                      {new Date(log.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </td>
                    <td className="py-2 pr-3">
                      <span className="badge-info text-xs">
                        {log.agentType}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-xs text-slate-400">
                      {log.action}
                    </td>
                    <td className="py-2 text-xs text-slate-300">
                      <div>{log.summary}</div>
                      {log.decision && (
                        <div className="mt-0.5 text-blue-400">
                          {log.decision}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Cycle Timeline */}
        <div className="card">
          <div className="card-header">Cycle Timeline</div>
          <div className="max-h-96 space-y-3 overflow-y-auto">
            {cycles.map((cycle) => {
              const duration = cycle.completedAt
                ? Math.round(
                    (new Date(cycle.completedAt).getTime() -
                      new Date(cycle.startedAt).getTime()) /
                      1000,
                  )
                : null;

              return (
                <div
                  key={cycle.id}
                  className="flex items-center gap-4 rounded-lg border border-slate-700/30 bg-slate-800/30 p-3"
                >
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold ${
                      cycle.status === 'completed'
                        ? 'bg-green-500/10 text-green-400'
                        : cycle.status === 'running'
                          ? 'bg-blue-500/10 text-blue-400'
                          : 'bg-red-500/10 text-red-400'
                    }`}
                  >
                    #{cycle.cycleNumber}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-slate-200">
                        Cycle {cycle.cycleNumber}
                      </span>
                      <span
                        className={`text-xs font-medium ${
                          cycle.status === 'completed'
                            ? 'text-green-400'
                            : cycle.status === 'running'
                              ? 'text-blue-400'
                              : 'text-red-400'
                        }`}
                      >
                        {cycle.status.toUpperCase()}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-4 text-xs text-slate-500">
                      <span>
                        {new Date(cycle.startedAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      {duration !== null && <span>{duration}s duration</span>}
                      <span>{cycle.ordersPlaced} orders</span>
                      {cycle.totalCostUsd !== null && (
                        <span>${cycle.totalCostUsd.toFixed(3)} cost</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
