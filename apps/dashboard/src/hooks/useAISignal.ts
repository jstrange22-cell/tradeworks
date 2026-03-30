import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getCandlesticks } from '@/lib/crypto-api';
import { computeAISignal, type AISignalResult } from '@/lib/ai-signal-engine';
import type { CryptoCandle } from '@/lib/crypto-api';

const HTF_MAP: Record<string, string> = {
  '1m': '5m',
  '5m': '15m',
  '15m': '1h',
  '1h': '4h',
  '4h': '1d',
  '1d': '1w',
};

export function useAISignal(
  candles: CryptoCandle[] | undefined,
  instrument: string,
  timeframe: string,
  enabled: boolean,
): AISignalResult | null {
  const htfTimeframe = HTF_MAP[timeframe] ?? '4h';

  const { data: htfCandles } = useQuery({
    queryKey: ['candles-htf', instrument, htfTimeframe],
    queryFn: () => getCandlesticks(instrument, htfTimeframe),
    enabled: enabled && !!candles && candles.length >= 15,
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: 1,
  });

  return useMemo(() => {
    if (!enabled || !candles || candles.length < 15) return null;
    try {
      return computeAISignal(candles, htfCandles);
    } catch {
      return null;
    }
  }, [candles, htfCandles, enabled]);
}
