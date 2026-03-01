import { useEffect, useRef, useCallback, useState } from 'react';
import { wsClient } from '@/lib/ws-client';
import { usePortfolioStore } from '@/stores/portfolio-store';
import { useAgentStore } from '@/stores/agent-store';

interface WSMessage {
  channel: string;
  event: string;
  data: Record<string, unknown>;
  timestamp: string;
}

export function useWebSocket() {
  const [isConnected, setIsConnected] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const {
    setEquity,
    setDailyPnl,
    setCircuitBreaker,
    addTrade,
    updatePosition,
    removePosition,
  } = usePortfolioStore();

  const { setAgentStatus, addLog, addCycle, updateCycle } = useAgentStore();

  const handleMessage = useCallback(
    (message: WSMessage) => {
      const { event, data } = message;

      switch (event) {
        case 'portfolio:update':
          if (typeof data.totalEquity === 'number') setEquity(data.totalEquity);
          if (typeof data.dailyPnl === 'number' && typeof data.dailyPnlPercent === 'number') {
            setDailyPnl(data.dailyPnl, data.dailyPnlPercent);
          }
          break;

        case 'trade:executed':
          if (data.trade && typeof data.trade === 'object') {
            addTrade(data.trade as Parameters<typeof addTrade>[0]);
          }
          break;

        case 'position:updated':
          if (data.position && typeof data.position === 'object') {
            updatePosition(data.position as Parameters<typeof updatePosition>[0]);
          }
          break;

        case 'position:closed':
          if (data.position && typeof (data.position as Record<string, unknown>).id === 'string') {
            removePosition((data.position as Record<string, unknown>).id as string);
          }
          break;

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

        case 'circuit_breaker:triggered':
          setCircuitBreaker(true);
          break;

        case 'circuit_breaker:cleared':
          setCircuitBreaker(false);
          break;
      }
    },
    [setEquity, setDailyPnl, setCircuitBreaker, addTrade, updatePosition, removePosition, setAgentStatus, addLog, addCycle, updateCycle],
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
