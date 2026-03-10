import { useQuery } from '@tanstack/react-query';
import { ArrowRightLeft } from 'lucide-react';
import { apiClient } from '../../lib/api-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ArbitrageOpportunity {
  id: string;
  instrument: string;
  buyExchange: string;
  sellExchange: string;
  buyPrice: number;
  sellPrice: number;
  spreadPercent: number;
  estimatedProfit: number;
  fees: number;
  netProfit: number;
  timestamp: string;
  confidence: 'high' | 'medium' | 'low';
}

interface ScanResponse {
  data: ArbitrageOpportunity[];
  total: number;
  scannedAt: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CONFIDENCE_STYLES = {
  high: 'bg-green-500/10 text-green-400',
  medium: 'bg-amber-500/10 text-amber-400',
  low: 'bg-red-500/10 text-red-400',
} as const;

function formatUsd(value: number): string {
  return value >= 1
    ? `$${value.toFixed(2)}`
    : `$${value.toFixed(4)}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ArbitrageAlerts() {
  const { data, isLoading, isError } = useQuery<ScanResponse>({
    queryKey: ['arbitrage', 'scan'],
    queryFn: () => apiClient.get<ScanResponse>('/arbitrage/scan'),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });

  const opportunities = data?.data ?? [];

  return (
    <div className="card">
      <div className="card-header flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ArrowRightLeft className="h-4 w-4 text-cyan-400" />
          <span>Cross-Exchange Arbitrage</span>
        </div>
        {data?.scannedAt && (
          <span className="text-[10px] text-slate-500">
            {new Date(data.scannedAt).toLocaleTimeString()}
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2 py-2">
          {Array.from({ length: 3 }).map((_, idx) => (
            <div
              key={idx}
              className="h-10 animate-pulse rounded-lg bg-slate-800/50"
            />
          ))}
        </div>
      ) : isError ? (
        <p className="py-4 text-center text-xs text-red-400">
          Failed to load arbitrage data
        </p>
      ) : opportunities.length === 0 ? (
        <p className="py-4 text-center text-xs text-slate-500">
          No arbitrage opportunities detected
        </p>
      ) : (
        <div className="space-y-2">
          {opportunities.slice(0, 8).map((opp) => (
            <div
              key={opp.id}
              className="flex items-center justify-between rounded-lg bg-slate-800/50 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="font-medium text-slate-200">
                    {opp.instrument}
                  </span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${CONFIDENCE_STYLES[opp.confidence]}`}
                  >
                    {opp.confidence}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-xs text-slate-500">
                  Buy {opp.buyExchange} {formatUsd(opp.buyPrice)}
                  {' \u2192 '}
                  Sell {opp.sellExchange} {formatUsd(opp.sellPrice)}
                </p>
              </div>

              <div className="flex flex-col items-end gap-0.5 pl-3">
                <span className="text-sm font-bold text-green-400">
                  +{formatUsd(opp.netProfit)}
                </span>
                <span className="text-[10px] text-slate-400">
                  {opp.spreadPercent.toFixed(2)}% spread
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
