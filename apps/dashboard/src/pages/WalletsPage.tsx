import { useQuery } from '@tanstack/react-query';
import {
  Wallet, ExternalLink,
  RefreshCcw, AlertCircle,
} from 'lucide-react';
import { apiClient } from '@/lib/api-client';

// ── Types ──────────────────────────────────────────────────────────────

interface ExchangeAsset {
  symbol: string;
  name: string;
  amount: number;
  valueUsd: number;
}

interface ExchangeBalance {
  exchange: string;
  totalUsd: number;
  assets: ExchangeAsset[];
  connected: boolean;
  error?: string;
}

interface BalancesResponse {
  exchanges: ExchangeBalance[];
  totalUsd: number;
}

interface SolanaToken {
  mint: string;
  symbol: string;
  name: string;
  balance: number;
  valueUsd: number;
  logoUri?: string | null;
}

interface SolanaBalanceData {
  address: string;
  sol: number;
  solValueUsd: number;
  tokens: SolanaToken[];
  totalValueUsd: number;
}

// ── Component ──────────────────────────────────────────────────────────

export function WalletsPage() {
  const portfolioQuery = useQuery<BalancesResponse>({
    queryKey: ['portfolio-balances'],
    queryFn: () => apiClient.get<BalancesResponse>('/portfolio/balances'),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const solanaQuery = useQuery<{ data: SolanaBalanceData }>({
    queryKey: ['solana-balances'],
    queryFn: () => apiClient.get<{ data: SolanaBalanceData }>('/solana/balances'),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  const portfolioData = portfolioQuery.data;
  const solanaData = solanaQuery.data?.data;
  const isLoading = portfolioQuery.isLoading || solanaQuery.isLoading;

  const solanaTotal = solanaData?.totalValueUsd ?? 0;
  const exchangeTotal = portfolioData?.totalUsd ?? 0;
  const grandTotal = exchangeTotal + solanaTotal;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Wallet className="h-6 w-6 text-blue-400" />
          <div>
            <h1 className="text-xl font-bold text-slate-100">Crypto Wallets</h1>
            <p className="text-xs text-slate-500">Unified view of all connected wallets</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-500">Total Portfolio</p>
          <p className="text-2xl font-bold text-slate-100">
            {isLoading ? '--' : `$${grandTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          </p>
        </div>
      </div>

      {/* Wallet Cards */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Solana Bot Wallet */}
        <WalletCard
          name="Solana Bot Wallet"
          icon="🟣"
          total={solanaTotal}
          isLoading={solanaQuery.isLoading}
          error={solanaQuery.error ? 'Failed to load Solana balances' : undefined}
          onRefresh={() => solanaQuery.refetch()}
          address={solanaData?.address}
        >
          {solanaData && (
            <>
              <AssetRow
                symbol="SOL"
                name="Solana"
                amount={solanaData.sol}
                valueUsd={solanaData.solValueUsd}
              />
              {solanaData.tokens
                .filter(t => t.balance > 0)
                .sort((a, b) => b.valueUsd - a.valueUsd)
                .map(t => (
                  <AssetRow
                    key={t.mint}
                    symbol={t.symbol}
                    name={t.name}
                    amount={t.balance}
                    valueUsd={t.valueUsd}
                    logoUri={t.logoUri}
                  />
                ))}
            </>
          )}
        </WalletCard>

        {/* Exchange Wallets */}
        {portfolioData?.exchanges
          ?.filter(ex => ex.connected)
          .map(ex => (
            <WalletCard
              key={ex.exchange}
              name={ex.exchange}
              icon={exchangeIcon(ex.exchange)}
              total={ex.totalUsd}
              isLoading={portfolioQuery.isLoading}
              error={ex.error}
              onRefresh={() => portfolioQuery.refetch()}
            >
              {ex.assets
                .filter(a => a.amount > 0)
                .sort((a, b) => b.valueUsd - a.valueUsd)
                .map(a => (
                  <AssetRow
                    key={a.symbol}
                    symbol={a.symbol}
                    name={a.name}
                    amount={a.amount}
                    valueUsd={a.valueUsd}
                  />
                ))}
            </WalletCard>
          ))}

        {/* Disconnected exchanges */}
        {portfolioData?.exchanges
          ?.filter(ex => !ex.connected)
          .map(ex => (
            <div
              key={ex.exchange}
              className="rounded-xl border border-dashed border-slate-700/50 bg-slate-800/30 p-4"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{exchangeIcon(ex.exchange)}</span>
                  <span className="text-sm font-medium text-slate-500">{ex.exchange}</span>
                </div>
                <a
                  href="/settings"
                  className="flex items-center gap-1 rounded-lg bg-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-600 transition-colors"
                >
                  Connect <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────

function WalletCard({
  name, icon, total, isLoading, error, onRefresh, address, children,
}: {
  name: string;
  icon: string;
  total: number;
  isLoading: boolean;
  error?: string;
  onRefresh: () => void;
  address?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 overflow-hidden">
      {/* Card header */}
      <div className="flex items-center justify-between border-b border-slate-700/30 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">{icon}</span>
          <div>
            <h3 className="text-sm font-semibold text-slate-200">{name}</h3>
            {address && (
              <p className="text-[10px] font-mono text-slate-500">
                {address.slice(0, 6)}...{address.slice(-4)}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-slate-100">
            {isLoading ? '--' : `$${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          </span>
          <button
            onClick={onRefresh}
            className="rounded-md p-1 text-slate-500 hover:bg-slate-700 hover:text-slate-300 transition-colors"
            aria-label={`Refresh ${name}`}
          >
            <RefreshCcw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="flex items-center gap-2 bg-red-900/20 px-4 py-2 text-xs text-red-400">
          <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Asset list */}
      <div className="divide-y divide-slate-700/30">
        {isLoading ? (
          <div className="px-4 py-6 text-center text-xs text-slate-500">Loading...</div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

function AssetRow({
  symbol, name, amount, valueUsd, logoUri,
}: {
  symbol: string;
  name: string;
  amount: number;
  valueUsd: number;
  logoUri?: string | null;
}) {
  const isPositive = valueUsd > 0;

  return (
    <div className="flex items-center justify-between px-4 py-2.5 hover:bg-slate-700/20 transition-colors">
      <div className="flex items-center gap-2.5">
        {logoUri ? (
          <img src={logoUri} alt={symbol} className="h-6 w-6 rounded-full" />
        ) : (
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-700 text-[10px] font-bold text-slate-300">
            {symbol.slice(0, 2)}
          </div>
        )}
        <div>
          <p className="text-xs font-medium text-slate-200">{symbol}</p>
          <p className="text-[10px] text-slate-500 truncate max-w-[120px]">{name}</p>
        </div>
      </div>
      <div className="text-right">
        <p className="text-xs font-mono text-slate-200">
          {amount < 0.001 ? amount.toExponential(2) : amount.toLocaleString('en-US', { maximumFractionDigits: 4 })}
        </p>
        <p className={`text-[10px] font-mono ${isPositive ? 'text-green-400' : 'text-slate-500'}`}>
          ${valueUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </p>
      </div>
    </div>
  );
}

function exchangeIcon(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes('coinbase')) return '🟠';
  if (lower.includes('robinhood')) return '🪶';
  if (lower.includes('phantom')) return '👻';
  if (lower.includes('alpaca')) return '🦙';
  return '💱';
}
