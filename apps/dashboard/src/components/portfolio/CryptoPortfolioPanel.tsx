import { useState } from 'react';
import { PieChart, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

interface AssetBalance {
  symbol: string;
  available: number;
  total: number;
  valueUsd: number;
}

interface ExchangeBalance {
  exchange: string;
  environment: string;
  connected: boolean;
  error?: string;
  assets: AssetBalance[];
  totalValueUsd: number;
}

interface BalancesResponse {
  data: ExchangeBalance[];
  totalValueUsd: number;
  message: string;
}

interface AggregatedHolding {
  symbol: string;
  totalAmount: number;
  totalValueUsd: number;
  exchanges: Array<{ name: string; amount: number; valueUsd: number }>;
  allocationPercent: number;
}

const CASH_SYMBOLS = new Set(['USD', 'USDC', 'USDT', 'DAI']);

function formatUsd(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `$${value.toFixed(2)}`;
}

function formatAmount(amount: number): string {
  if (amount >= 1000) return amount.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (amount >= 1) return amount.toFixed(4);
  if (amount >= 0.0001) return amount.toFixed(6);
  return amount.toFixed(8);
}

function aggregateHoldings(exchanges: ExchangeBalance[]): AggregatedHolding[] {
  const connected = exchanges.filter((e) => e.connected);
  const map = new Map<string, AggregatedHolding>();

  for (const exchange of connected) {
    for (const asset of exchange.assets) {
      if (CASH_SYMBOLS.has(asset.symbol)) continue;
      const existing = map.get(asset.symbol);
      if (existing) {
        existing.totalAmount += asset.available;
        existing.totalValueUsd += asset.valueUsd;
        existing.exchanges.push({ name: exchange.exchange, amount: asset.available, valueUsd: asset.valueUsd });
      } else {
        map.set(asset.symbol, {
          symbol: asset.symbol,
          totalAmount: asset.available,
          totalValueUsd: asset.valueUsd,
          exchanges: [{ name: exchange.exchange, amount: asset.available, valueUsd: asset.valueUsd }],
          allocationPercent: 0,
        });
      }
    }
  }

  const holdings = [...map.values()].sort((a, b) => b.totalValueUsd - a.totalValueUsd);
  const totalCrypto = holdings.reduce((sum, h) => sum + h.totalValueUsd, 0);

  for (const holding of holdings) {
    holding.allocationPercent = totalCrypto > 0 ? (holding.totalValueUsd / totalCrypto) * 100 : 0;
  }

  return holdings;
}

export function CryptoPortfolioPanel() {
  const [showAll, setShowAll] = useState(false);

  const { data, isLoading } = useQuery<BalancesResponse>({
    queryKey: ['portfolio-balances'],
    queryFn: () => apiClient.get<BalancesResponse>('/portfolio/balances'),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const exchanges = data?.data ?? [];
  const connected = exchanges.filter((e) => e.connected);
  if (!isLoading && connected.length === 0) return null;

  const holdings = aggregateHoldings(exchanges);
  if (holdings.length === 0) return null;

  const totalCryptoValue = holdings.reduce((sum, h) => sum + h.totalValueUsd, 0);
  const visibleHoldings = showAll ? holdings : holdings.slice(0, 8);
  const hasMore = holdings.length > 8;

  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <div className="card-header flex items-center gap-2">
          <PieChart className="h-4 w-4 text-purple-400" />
          Crypto Portfolio
          <span className="ml-2 text-lg font-bold text-slate-100">
            {formatUsd(totalCryptoValue)}
          </span>
        </div>
        <span className="text-xs text-slate-500">
          {holdings.length} asset{holdings.length !== 1 ? 's' : ''} across {connected.length} exchange{connected.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Holdings table */}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-700/50 text-[10px] uppercase tracking-wider text-slate-500">
              <th className="pb-2 text-left font-medium">Asset</th>
              <th className="pb-2 text-right font-medium">Amount</th>
              <th className="pb-2 text-right font-medium">Value</th>
              <th className="hidden pb-2 text-right font-medium sm:table-cell">Allocation</th>
              <th className="hidden pb-2 text-left font-medium md:table-cell">Exchanges</th>
              <th className="pb-2 text-center font-medium">Chart</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/30">
            {visibleHoldings.map((holding) => (
              <tr key={holding.symbol} className="group">
                <td className="py-2 font-semibold text-slate-200">{holding.symbol}</td>
                <td className="py-2 text-right text-slate-300">{formatAmount(holding.totalAmount)}</td>
                <td className="py-2 text-right font-medium text-slate-200">{formatUsd(holding.totalValueUsd)}</td>
                <td className="hidden py-2 text-right sm:table-cell">
                  <div className="flex items-center justify-end gap-2">
                    <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-700/50">
                      <div
                        className="h-full rounded-full bg-purple-500"
                        style={{ width: `${Math.min(holding.allocationPercent, 100)}%` }}
                      />
                    </div>
                    <span className="w-10 text-right text-slate-400">
                      {holding.allocationPercent.toFixed(1)}%
                    </span>
                  </div>
                </td>
                <td className="hidden py-2 md:table-cell">
                  <div className="flex flex-wrap gap-1">
                    {holding.exchanges.map((ex) => (
                      <span
                        key={ex.name}
                        className="rounded bg-slate-700/50 px-1.5 py-0.5 text-[10px] text-slate-400"
                        title={`${formatAmount(ex.amount)} on ${ex.name}`}
                      >
                        {ex.name}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="py-2 text-center">
                  <button
                    onClick={() => window.open(`https://dexscreener.com/search?q=${holding.symbol}`, '_blank', 'noopener,noreferrer')}
                    className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] text-blue-400 transition hover:bg-blue-500/10 hover:text-blue-300"
                    title={`View ${holding.symbol} on DexScreener`}
                  >
                    <ExternalLink className="h-3 w-3" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Show more toggle */}
      {hasMore && (
        <button
          onClick={() => setShowAll((prev) => !prev)}
          className="mt-2 flex w-full items-center justify-center gap-1 rounded py-1.5 text-[10px] text-blue-400 transition-colors hover:bg-slate-700/30 hover:text-blue-300"
        >
          {showAll ? (
            <>Show less <ChevronUp className="h-3 w-3" /></>
          ) : (
            <>+{holdings.length - 8} more assets <ChevronDown className="h-3 w-3" /></>
          )}
        </button>
      )}
    </div>
  );
}
