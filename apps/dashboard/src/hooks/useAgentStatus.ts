import { useQuery } from '@tanstack/react-query';
import { useAgentStore, type AgentType, type AgentStatusInfo, type AgentLogEntry, type CycleInfo } from '@/stores/agent-store';
import { apiClient } from '@/lib/api-client';

interface AgentStatusResponse {
  agents: AgentStatusInfo[];
  logs: AgentLogEntry[];
  cycles: CycleInfo[];
}

export function useAgentStatus() {
  const store = useAgentStore();

  const { data, isLoading, error } = useQuery({
    queryKey: ['agents-status'],
    queryFn: () => apiClient.get<AgentStatusResponse>('/portfolio/agents'),
    refetchInterval: 10_000,
    retry: 2,
  });

  if (data) {
    // Convert array to record
    const agentsRecord: Record<AgentType, AgentStatusInfo> = {} as Record<AgentType, AgentStatusInfo>;
    data.agents.forEach(a => {
      agentsRecord[a.agentType] = a;
    });
    return {
      agents: agentsRecord,
      logs: data.logs,
      cycles: data.cycles,
      isLoading,
      error,
    };
  }

  // Fallback to store mock data
  return {
    agents: store.agents,
    logs: store.logs,
    cycles: store.cycles,
    isLoading,
    error,
  };
}
