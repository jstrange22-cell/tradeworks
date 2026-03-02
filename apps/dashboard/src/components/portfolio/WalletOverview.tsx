import { Wallet, ExternalLink, AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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

const EXCHANGE_INFO: Record<string, { depositUrl: string; color: string; envLabel: Record<string, string> }> = {
  Coinbase: {
    depositUrl: 'https://www.coinbase.com/portfolio',
    color: 'text-blue-400',
    envLabel: { sandbox: 'Sandbox', production: 'Live' },
  },
  Alpaca: {
    depositUrl: 'https://app.alpaca.markets/paper/dashboard/overview',
    color: 'text-green-400',
    envLabel: { sandbox: 'Paper', production: 'Live' },
  },
  Polymarket: {
    depositUrl: 'https://polymarket.com/wallet',
    color: 'text-purple-400',
    envLabel: { sandbox: 'Testnet', production: 'Live' },
  },
};

function formatUsd(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `$${value.toFixed(2)}`;
}

function formatAmount(amount: number, symbol: string): string {
  if (['USD', 'USDC', 'USDT', 'DAI'].includes(symbol)) {
    return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  if (amount >= 1000) return amount.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (amount >= 1) return amount.toFixed(4);
  return amount.toFixed(8);
}

export function WalletOverview() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery<BalancesResponse>({
    queryKey: ['portfolio-balances'],
    queryFn: () => apiClient.get<BalancesResponse>('/portfolio/balances'),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const exchanges = data?.data ?? [];
  const connectedExchanges = exchanges.filter((e) => e.connected);
  const disconnectedExchanges = exchanges.filter((e) => !e.connected);

  // Don't render anything if no exchanges are connected
  if (!isLoading && connectedExchanges.length === 0) {
    return null;
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <div className="card-header flex items-center gap-2">
          <Wallet className="h-4 w-4 text-blue-400" />
          Exchange Balances
          {data && (
            <span className="ml-2 text-lg font-bold text-slate-100">
              {formatUsd(data.totalValueUsd)}
            </span>
          )}
        </div>
        <button
          onClick={() => queryClient.invalidateQueries({ queryKey: ['portfolio-balances'] })}
          className="btn-ghost p-1.5"
          title="Refresh balances"
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-blue-400" />
          <span className="ml-2 text-sm text-slate-400">Loading balances...</span>
        </div>
      )}

      {error && (
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-red-500/10 p-3 text-sm text-red-400">
          <AlertCircle className="h-4 w-4 shrink-0" />
          Failed to load balances. Check your connection.
        </div>
      )}

      {!isLoading && connectedExchanges.length > 0 && (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {connectedExchanges.map((exchange) => {
            const info = EXCHANGE_INFO[exchange.exchange];
            const envLabel = info?.envLabel[exchange.environment] ?? exchange.environment;

            return (
              <div
                key={exchange.exchange}
                className="rounded-lg border border-slate-700/50 bg-slate-800/50 p-4"
              >
                {/* Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-semibold ${info?.color ?? 'text-slate-200'}`}>
                      {exchange.exchange}
                    </span>
                    <span className="rounded bg-slate-700/50 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">
                      {envLabel}
                    </span>
                  </div>
                  {info && (
                    <a
                      href={info.depositUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-slate-500 transition-colors hover:text-slate-300"
                      title={`Open ${exchange.exchange}`}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>

                {/* Total Value */}
                <div className="mt-2 text-lg font-bold text-slate-100">
                  {formatUsd(exchange.totalValueUsd)}
                </div>

                {/* Error */}
                {exchange.error && (
                  <div className="mt-2 text-xs text-red-400">{exchange.error}</div>
                )}

                {/* Asset List */}
                {exchange.assets.length > 0 && (
                  <div className="mt-3 space-y-1.5">
                    {exchange.assets.slice(0, 6).map((asset) => (
                      <div key={asset.symbol} className="flex items-center justify-between text-xs">
                        <span className="font-medium text-slate-300">{asset.symbol}</span>
                        <div className="text-right">
                          <span className="text-slate-300">
                            {formatAmount(asset.available, asset.symbol)}
                          </span>
                          {asset.valueUsd > 0 && !['USD', 'USDC', 'USDT', 'DAI'].includes(asset.symbol) && (
                            <span className="ml-1 text-slate-500">
                              ({formatUsd(asset.valueUsd)})
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                    {exchange.assets.length > 6 && (
                      <div className="text-[10px] text-slate-500">
                        +{exchange.assets.length - 6} more assets
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Disconnected exchanges hint */}
      {disconnectedExchanges.length > 0 && connectedExchanges.length > 0 && (
        <div className="mt-3 text-xs text-slate-500">
          Not connected:{' '}
          {disconnectedExchanges.map((e, i) => (
            <span key={e.exchange}>
              {i > 0 && ', '}
              <a href="/settings" className="text-blue-400 hover:text-blue-300">{e.exchange}</a>
            </span>
          ))}
          {' — '}
          <a href="/settings" className="text-blue-400 hover:text-blue-300">
            Add keys in Settings
          </a>
        </div>
      )}

      {/* Info message */}
      <div className="mt-3 text-[10px] text-slate-600">
        Deposits and withdrawals are managed directly on each exchange.
      </div>
    </div>
  );
}
