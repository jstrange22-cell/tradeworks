import { useQuery } from '@tanstack/react-query';
import { useAgentStore, type AgentType, type AgentStatusInfo, type AgentLogEntry, type CycleInfo } from '@/stores/agent-store';
import { apiClient } from '@/lib/api-client';

interface AgentStatusResponse {
  agents: Record<AgentType, AgentStatusInfo>;
  recentLogs: AgentLogEntry[];
  recentCycles: CycleInfo[];
}

export function useAgentStatus() {
  const store = useAgentStore();

  const query = useQuery({
    queryKey: ['agents'],
    queryFn: () => apiClient.get<AgentStatusResponse>('/agents/status'),
    enabled: false, // Disabled until API is available; using mock data from store
    refetchInterval: 10_000,
  });

  return {
    agents: store.agents,
    logs: store.logs,
    cycles: store.cycles,
    isLoading: query.isLoading,
    error: query.error,
  };
}
