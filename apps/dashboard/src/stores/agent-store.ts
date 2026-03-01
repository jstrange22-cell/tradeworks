import { create } from 'zustand';

export type AgentType = 'quant' | 'sentiment' | 'macro' | 'risk' | 'execution';
export type AgentStatusValue = 'idle' | 'analyzing' | 'deciding' | 'executing' | 'error';

export interface AgentStatusInfo {
  agentType: AgentType;
  status: AgentStatusValue;
  lastActivityAt: string;
  currentTask: string | null;
  cyclesCompleted: number;
  errorsToday: number;
}

export interface AgentLogEntry {
  id: string;
  agentType: AgentType;
  action: string;
  summary: string;
  decision: string | null;
  durationMs: number | null;
  costUsd: number | null;
  timestamp: string;
}

export interface CycleInfo {
  id: string;
  cycleNumber: number;
  startedAt: string;
  completedAt: string | null;
  status: 'running' | 'completed' | 'error' | 'circuit_breaker';
  ordersPlaced: number;
  totalCostUsd: number | null;
}

interface AgentState {
  agents: Record<AgentType, AgentStatusInfo>;
  logs: AgentLogEntry[];
  cycles: CycleInfo[];

  // Actions
  setAgentStatus: (agentType: AgentType, status: Partial<AgentStatusInfo>) => void;
  addLog: (log: AgentLogEntry) => void;
  setLogs: (logs: AgentLogEntry[]) => void;
  addCycle: (cycle: CycleInfo) => void;
  setCycles: (cycles: CycleInfo[]) => void;
  updateCycle: (id: string, update: Partial<CycleInfo>) => void;
}

const now = new Date().toISOString();

// Clean defaults — no mock data
const initialAgents: Record<AgentType, AgentStatusInfo> = {
  quant: { agentType: 'quant', status: 'idle', lastActivityAt: now, currentTask: null, cyclesCompleted: 0, errorsToday: 0 },
  sentiment: { agentType: 'sentiment', status: 'idle', lastActivityAt: now, currentTask: null, cyclesCompleted: 0, errorsToday: 0 },
  macro: { agentType: 'macro', status: 'idle', lastActivityAt: now, currentTask: null, cyclesCompleted: 0, errorsToday: 0 },
  risk: { agentType: 'risk', status: 'idle', lastActivityAt: now, currentTask: null, cyclesCompleted: 0, errorsToday: 0 },
  execution: { agentType: 'execution', status: 'idle', lastActivityAt: now, currentTask: null, cyclesCompleted: 0, errorsToday: 0 },
};

export const useAgentStore = create<AgentState>((set) => ({
  agents: initialAgents,
  logs: [],
  cycles: [],

  setAgentStatus: (agentType, status) =>
    set((state) => ({
      agents: {
        ...state.agents,
        [agentType]: { ...state.agents[agentType], ...status },
      },
    })),
  addLog: (log) =>
    set((state) => ({
      logs: [log, ...state.logs.slice(0, 99)],
    })),
  setLogs: (logs) => set({ logs }),
  addCycle: (cycle) =>
    set((state) => ({
      cycles: [cycle, ...state.cycles.slice(0, 49)],
    })),
  setCycles: (cycles) => set({ cycles }),
  updateCycle: (id, update) =>
    set((state) => ({
      cycles: state.cycles.map((c) => (c.id === id ? { ...c, ...update } : c)),
    })),
}));
