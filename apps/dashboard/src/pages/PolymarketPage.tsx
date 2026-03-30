import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TrendingUp, DollarSign, BarChart3, ClipboardList, Loader2 } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { SetupPanel } from '@/components/polymarket/SetupPanel';
import { MarketsTab } from '@/components/polymarket/MarketsTab';
import { PositionsTab } from '@/components/polymarket/PositionsTab';
import { OrdersTab } from '@/components/polymarket/OrdersTab';

// ── Types ──────────────────────────────────────────────────────────────

interface StatusResponse {
  data: { connected: boolean; funderAddress?: string };
}

interface BalanceResponse {
  data: { usdc: number; funderAddress?: string };
}

interface PositionsResponse {
  data: Array<{ currentValue?: number; value?: number }>;
}

type PageTab = 'markets' | 'positions' | 'orders';

const TABS: ReadonlyArray<{ key: PageTab; label: string; icon: React.ReactNode }> = [
  { key: 'markets', label: 'Markets', icon: <TrendingUp className="h-4 w-4" /> },
  { key: 'positions', label: 'Positions', icon: <BarChart3 className="h-4 w-4" /> },
  { key: 'orders', label: 'Orders', icon: <ClipboardList className="h-4 w-4" /> },
] as const;

// ── Stat card ──────────────────────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: string;
  icon: React.ReactNode;
  sub?: string;
}

function StatCard({ label, value, icon, sub }: StatCardProps) {
  return (
    <div className="card p-4 flex items-start gap-4">
      <div className="rounded-lg bg-blue-600/10 p-2.5 text-blue-400 flex-shrink-0">{icon}</div>
      <div className="min-w-0">
        <p className="text-xs text-slate-400 uppercase tracking-wide">{label}</p>
        <p className="text-xl font-bold text-slate-100 mt-0.5 truncate">{value}</p>
        {sub && <p className="text-xs text-slate-500 mt-0.5 truncate">{sub}</p>}
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────

export function PolymarketPage() {
  const [activeTab, setActiveTab] = useState<PageTab>('markets');

  const statusQuery = useQuery({
    queryKey: ['polymarket-status'],
    queryFn: () => apiClient.get<StatusResponse>('/polymarket/status'),
    refetchInterval: 30_000,
  });

  const isConnected = statusQuery.data?.data?.connected ?? false;
  const funderAddress = statusQuery.data?.data?.funderAddress ?? '';

  const balanceQuery = useQuery({
    queryKey: ['polymarket-balance'],
    queryFn: () => apiClient.get<BalanceResponse>('/polymarket/balance'),
    enabled: isConnected,
    refetchInterval: 30_000,
  });

  const positionsQuery = useQuery({
    queryKey: ['polymarket-positions'],
    queryFn: () => apiClient.get<PositionsResponse>('/polymarket/positions'),
    enabled: isConnected,
    refetchInterval: 30_000,
  });

  const usdc = balanceQuery.data?.data?.usdc ?? 0;
  const positions = positionsQuery.data?.data ?? [];
  const positionValue = positions.reduce((sum, p) => {
    const val = p.currentValue ?? p.value ?? 0;
    return sum + (typeof val === 'number' ? val : 0);
  }, 0);
  const totalValue = usdc + positionValue;

  // While status is loading, show spinner
  if (statusQuery.isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
      </div>
    );
  }

  // Not connected — show setup flow
  if (!isConnected) {
    return (
      <div className="p-6">
        <div className="flex items-center gap-3 mb-8">
          <TrendingUp className="h-6 w-6 text-blue-400" />
          <h1 className="text-2xl font-bold text-slate-100">Polymarket</h1>
        </div>
        <SetupPanel />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <TrendingUp className="h-6 w-6 text-blue-400" />
          <div>
            <h1 className="text-2xl font-bold text-slate-100">Polymarket</h1>
            <p className="text-xs text-slate-500 font-mono truncate max-w-xs">
              {funderAddress}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />
          <span className="text-xs text-green-400 font-medium">Connected</span>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="USDC Cash"
          value={balanceQuery.isLoading ? '…' : `$${usdc.toFixed(2)}`}
          icon={<DollarSign className="h-5 w-5" />}
          sub="Available to trade"
        />
        <StatCard
          label="Position Value"
          value={positionsQuery.isLoading ? '…' : `$${positionValue.toFixed(2)}`}
          icon={<BarChart3 className="h-5 w-5" />}
          sub={`${positions.length} open position${positions.length !== 1 ? 's' : ''}`}
        />
        <StatCard
          label="Total Portfolio"
          value={(balanceQuery.isLoading || positionsQuery.isLoading) ? '…' : `$${totalValue.toFixed(2)}`}
          icon={<TrendingUp className="h-5 w-5" />}
          sub="Cash + positions"
        />
      </div>

      {/* Tab navigation */}
      <div className="flex gap-1 rounded-lg bg-slate-800 p-1">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? 'bg-blue-600 text-white'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700'
            }`}
          >
            {tab.icon}
            <span className="hidden sm:inline">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div>
        {activeTab === 'markets' && <MarketsTab />}
        {activeTab === 'positions' && <PositionsTab />}
        {activeTab === 'orders' && <OrdersTab />}
      </div>
    </div>
  );
}
