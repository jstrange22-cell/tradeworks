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

const initialAgents: Record<AgentType, AgentStatusInfo> = {
  quant: {
    agentType: 'quant',
    status: 'idle',
    lastActivityAt: new Date(Date.now() - 120000).toISOString(),
    currentTask: null,
    cyclesCompleted: 42,
    errorsToday: 0,
  },
  sentiment: {
    agentType: 'sentiment',
    status: 'analyzing',
    lastActivityAt: now,
    currentTask: 'Scanning BTC-USD social sentiment',
    cyclesCompleted: 41,
    errorsToday: 1,
  },
  macro: {
    agentType: 'macro',
    status: 'idle',
    lastActivityAt: new Date(Date.now() - 300000).toISOString(),
    currentTask: null,
    cyclesCompleted: 42,
    errorsToday: 0,
  },
  risk: {
    agentType: 'risk',
    status: 'idle',
    lastActivityAt: new Date(Date.now() - 60000).toISOString(),
    currentTask: null,
    cyclesCompleted: 42,
    errorsToday: 0,
  },
  execution: {
    agentType: 'execution',
    status: 'idle',
    lastActivityAt: new Date(Date.now() - 180000).toISOString(),
    currentTask: null,
    cyclesCompleted: 38,
    errorsToday: 0,
  },
};

const mockLogs: AgentLogEntry[] = [
  { id: 'l1', agentType: 'quant', action: 'analyze', summary: 'BTC-USD trend analysis: bullish continuation, RSI 58.3', decision: 'BUY signal confidence 0.72', durationMs: 3200, costUsd: 0.004, timestamp: new Date(Date.now() - 120000).toISOString() },
  { id: 'l2', agentType: 'sentiment', action: 'scan', summary: 'Social sentiment scan across 4 sources', decision: 'Neutral-positive (0.23)', durationMs: 5100, costUsd: 0.006, timestamp: new Date(Date.now() - 180000).toISOString() },
  { id: 'l3', agentType: 'macro', action: 'evaluate', summary: 'No upcoming high-impact events in 48h', decision: null, durationMs: 2800, costUsd: 0.003, timestamp: new Date(Date.now() - 300000).toISOString() },
  { id: 'l4', agentType: 'risk', action: 'assess', summary: 'Portfolio heat 3.2%, VaR95 within limits', decision: 'Trade approved: BTC-USD long 0.5', durationMs: 450, costUsd: 0.001, timestamp: new Date(Date.now() - 320000).toISOString() },
  { id: 'l5', agentType: 'execution', action: 'execute', summary: 'Market order BTC-USD 0.5 @ $94,250', decision: 'Filled with 0.02% slippage', durationMs: 890, costUsd: 0.0, timestamp: new Date(Date.now() - 340000).toISOString() },
  { id: 'l6', agentType: 'quant', action: 'analyze', summary: 'ETH-USD mean reversion setup detected', decision: 'BUY signal confidence 0.65', durationMs: 2900, costUsd: 0.004, timestamp: new Date(Date.now() - 600000).toISOString() },
  { id: 'l7', agentType: 'risk', action: 'assess', summary: 'Correlation check: ETH/BTC 0.78 - within limits', decision: 'Trade approved with reduced size', durationMs: 380, costUsd: 0.001, timestamp: new Date(Date.now() - 620000).toISOString() },
  { id: 'l8', agentType: 'execution', action: 'execute', summary: 'Market order ETH-USD 5 @ $3,420', decision: 'Filled with 0.01% slippage', durationMs: 720, costUsd: 0.0, timestamp: new Date(Date.now() - 640000).toISOString() },
];

const mockCycles: CycleInfo[] = [
  { id: 'c1', cycleNumber: 42, startedAt: new Date(Date.now() - 120000).toISOString(), completedAt: new Date(Date.now() - 60000).toISOString(), status: 'completed', ordersPlaced: 1, totalCostUsd: 0.014 },
  { id: 'c2', cycleNumber: 41, startedAt: new Date(Date.now() - 720000).toISOString(), completedAt: new Date(Date.now() - 600000).toISOString(), status: 'completed', ordersPlaced: 1, totalCostUsd: 0.009 },
  { id: 'c3', cycleNumber: 40, startedAt: new Date(Date.now() - 1320000).toISOString(), completedAt: new Date(Date.now() - 1200000).toISOString(), status: 'completed', ordersPlaced: 0, totalCostUsd: 0.011 },
  { id: 'c4', cycleNumber: 39, startedAt: new Date(Date.now() - 1920000).toISOString(), completedAt: new Date(Date.now() - 1800000).toISOString(), status: 'completed', ordersPlaced: 2, totalCostUsd: 0.018 },
  { id: 'c5', cycleNumber: 38, startedAt: new Date(Date.now() - 2520000).toISOString(), completedAt: new Date(Date.now() - 2400000).toISOString(), status: 'error', ordersPlaced: 0, totalCostUsd: 0.005 },
];

export const useAgentStore = create<AgentState>((set) => ({
  agents: initialAgents,
  logs: mockLogs,
  cycles: mockCycles,

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
