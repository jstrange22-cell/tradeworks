import { useEffect, useRef, useCallback, useState } from 'react';
import { toast } from 'sonner';
import { wsClient } from '@/lib/ws-client';
import { queryClient } from '@/lib/query-client';
import type { PortfolioPosition, RecentTrade } from '@/stores/portfolio-store';
import { useAgentStore } from '@/stores/agent-store';

interface WSMessage {
  channel: string;
  event: string;
  data: unknown;
  timestamp: string;
}

interface PortfolioQueryData {
  equity: number;
  initialCapital: number;
  dailyPnl: number;
  dailyPnlPercent: number;
  weeklyPnl: number;
  totalPnl: number;
  winRate: number;
  totalTrades: number;
  openPositions: PortfolioPosition[];
  recentTrades: RecentTrade[];
  equityCurve: Array<{ date: string; equity: number }>;
  paperTrading: boolean;
  circuitBreaker: boolean;
}

/**
 * Update TanStack Query cache directly from WebSocket events.
 * This eliminates the dual data source problem — WebSocket events
 * now update the same cache that usePortfolio() reads from.
 */
function patchPortfolioCache(updater: (prev: PortfolioQueryData) => PortfolioQueryData): void {
  queryClient.setQueryData<PortfolioQueryData>(['portfolio'], (prev) => {
    if (!prev) return prev;
    return updater(prev);
  });
}

export function useWebSocket() {
  const [isConnected, setIsConnected] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { setAgentStatus, addLog, addCycle, updateCycle } = useAgentStore();

  const handleMessage = useCallback(
    (message: WSMessage) => {
      const { event } = message;
      const data = message.data as Record<string, unknown>;

      switch (event) {
        // Portfolio events → update TanStack Query cache directly
        case 'portfolio:update':
          patchPortfolioCache((prev) => ({
            ...prev,
            ...(typeof data.totalEquity === 'number' ? { equity: data.totalEquity } : {}),
            ...(typeof data.dailyPnl === 'number' ? { dailyPnl: data.dailyPnl } : {}),
            ...(typeof data.dailyPnlPercent === 'number' ? { dailyPnlPercent: data.dailyPnlPercent } : {}),
          }));
          break;

        case 'trade:executed':
          if (data.trade && typeof data.trade === 'object') {
            const trade = data.trade as RecentTrade;
            patchPortfolioCache((prev) => ({
              ...prev,
              recentTrades: [trade, ...prev.recentTrades.slice(0, 49)],
            }));
            toast.success(`Trade executed: ${trade.side.toUpperCase()} ${trade.instrument}`, {
              description: `${trade.quantity} @ $${trade.price?.toLocaleString() ?? '0'}`,
            });
          }
          break;

        case 'position:updated':
          if (data.position && typeof data.position === 'object') {
            const pos = data.position as PortfolioPosition;
            patchPortfolioCache((prev) => ({
              ...prev,
              openPositions: prev.openPositions.map((p) => p.id === pos.id ? pos : p),
            }));
          }
          break;

        case 'position:closed':
          if (data.position && typeof (data.position as Record<string, unknown>).id === 'string') {
            const id = (data.position as Record<string, unknown>).id as string;
            patchPortfolioCache((prev) => ({
              ...prev,
              openPositions: prev.openPositions.filter((p) => p.id !== id),
            }));
          }
          break;

        case 'circuit_breaker:triggered':
          patchPortfolioCache((prev) => ({ ...prev, circuitBreaker: true }));
          toast.error('Circuit breaker triggered', {
            description: 'All trading halted due to risk limits',
            duration: 10000,
          });
          break;

        case 'circuit_breaker:cleared':
          patchPortfolioCache((prev) => ({ ...prev, circuitBreaker: false }));
          toast.success('Circuit breaker cleared', {
            description: 'Trading resumed',
          });
          break;

        // Agent events → Zustand store (no TanStack Query for agents)
        case 'agent:status':
          if (data.status && typeof data.status === 'object') {
            const status = data.status as Record<string, unknown>;
            if (typeof status.agentType === 'string') {
              setAgentStatus(
                status.agentType as Parameters<typeof setAgentStatus>[0],
                status as Parameters<typeof setAgentStatus>[1],
              );
            }
          }
          break;

        case 'agent:log':
          if (data.log && typeof data.log === 'object') {
            addLog(data.log as Parameters<typeof addLog>[0]);
          }
          break;

        case 'cycle:started':
          if (data.cycle && typeof data.cycle === 'object') {
            addCycle(data.cycle as Parameters<typeof addCycle>[0]);
          }
          break;

        case 'cycle:completed':
          if (data.cycle && typeof (data.cycle as Record<string, unknown>).id === 'string') {
            const cycle = data.cycle as Record<string, unknown>;
            updateCycle(cycle.id as string, cycle as Parameters<typeof updateCycle>[1]);
          }
          break;
      }
    },
    [setAgentStatus, addLog, addCycle, updateCycle],
  );

  useEffect(() => {
    wsClient.connect();

    const unsubscribe = wsClient.onAny(handleMessage);

    wsClient.subscribe('portfolio');
    wsClient.subscribe('agents');
    wsClient.subscribe('risk');
    wsClient.subscribe('trades');

    // Poll connection status
    intervalRef.current = setInterval(() => {
      setIsConnected(wsClient.isConnected);
    }, 2000);

    return () => {
      unsubscribe();
      wsClient.disconnect();
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [handleMessage]);

  return { isConnected };
}
