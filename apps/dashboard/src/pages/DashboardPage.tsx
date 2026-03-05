import { useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  BarChart3,
  Target,
  Briefcase,
  Rocket,
  Crosshair,
  Eye,
  Brain,
  Activity,
  ExternalLink,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePortfolio } from '@/hooks/usePortfolio';
import { apiClient } from '@/lib/api-client';
import { GettingStartedWizard } from '@/components/onboarding/GettingStartedWizard';
import { WalletOverview } from '@/components/portfolio/WalletOverview';

interface ApiKeysResponse {
  data: Array<{ id: string; service: string; keyName: string; maskedKey: string; environment: string; createdAt: string }>;
  total: number;
}

const PIE_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6'];

export function DashboardPage() {
  const {
    equity,
    initialCapital,
    dailyPnl,
    dailyPnlPercent,
    totalPnl,
    winRate,
    totalTrades,
    openPositions,
    recentTrades,
    equityCurve,
  } = usePortfolio();

  const [onboardingComplete, setOnboardingComplete] = useState(
    () => localStorage.getItem('tradeworks_onboarding_complete') === 'true'
  );
  const [addKeyService, setAddKeyService] = useState<string | undefined>(undefined);
  const [showAddKeyModal, setShowAddKeyModal] = useState(false);

  // Fetch API keys to check connection status
  const { data: apiKeysData } = useQuery<ApiKeysResponse>({
    queryKey: ['api-keys'],
    queryFn: () => apiClient.get<ApiKeysResponse>('/settings/api-keys'),
  });
  const queryClient = useQueryClient();

  const connectedExchanges = (apiKeysData?.data ?? []).map((k) => k.service);
  const hasNoKeys = connectedExchanges.length === 0;
  const hasSolana = connectedExchanges.includes('solana');

  // ── Solana data queries ──────────────────────────────────────────────
  const { data: solBalanceData } = useQuery<{ data: { sol: number; usd: number; tokens: unknown[] } }>({
    queryKey: ['sol-balance-dash'],
    queryFn: () => apiClient.get('/solana/balances/wallet'),
    enabled: hasSolana,
    refetchInterval: 30_000,
  });

  const { data: sniperStatus } = useQuery<{ running: boolean; totalSnipes: number; successfulSnipes: number; dailySpentSol: number; openPositions: number }>({
    queryKey: ['sniper-status-dash'],
    queryFn: () => apiClient.get('/solana/sniper/status'),
    enabled: hasSolana,
    refetchInterval: 15_000,
  });

  const { data: whaleMonitor } = useQuery<{ running: boolean; trackedWhales: number; totalActivities: number }>({
    queryKey: ['whale-monitor-dash'],
    queryFn: () => apiClient.get('/solana/whales/monitor/status'),
    enabled: hasSolana,
    refetchInterval: 15_000,
  });

  const { data: moonshotAlerts } = useQuery<{ data: Array<{ mint: string; symbol: string; name: string; score: number; recommendation: string; rugRisk: string }> }>({
    queryKey: ['moonshot-alerts-dash'],
    queryFn: () => apiClient.get('/solana/moonshot/alerts'),
    enabled: hasSolana,
    refetchInterval: 30_000,
  });

  const { data: pumpfunStatus } = useQuery<{ running: boolean; totalDetected: number; recentLaunches: Array<{ mint: string; symbol: string; name: string; usdMarketCap: number; bondingCurveProgress: number }> }>({
    queryKey: ['pumpfun-status-dash'],
    queryFn: () => apiClient.get('/solana/pumpfun/monitor/status'),
    enabled: hasSolana,
    refetchInterval: 15_000,
  });

  const solBalance = solBalanceData?.data;
  const topAlerts = moonshotAlerts?.data?.slice(0, 3) ?? [];
  const recentPumpLaunches = pumpfunStatus?.recentLaunches?.slice(0, 5) ?? [];

  const totalReturn = initialCapital > 0 ? ((equity - initialCapital) / initialCapital) * 100 : 0;
  const isEmpty = equity === 0 && totalTrades === 0 && openPositions.length === 0;
  const showWizard = isEmpty && hasNoKeys && !onboardingComplete;

  const handleOnboardingComplete = () => {
    localStorage.setItem('tradeworks_onboarding_complete', 'true');
    setOnboardingComplete(true);
  };

  // Compute allocation by market
  const allocationData = (() => {
    const byMarket: Record<string, number> = {};
    openPositions.forEach((pos) => {
      const value = Math.abs(pos.quantity * pos.currentPrice);
      byMarket[pos.market] = (byMarket[pos.market] || 0) + value;
    });
    return Object.entries(byMarket).map(([name, value]) => ({
      name: name.charAt(0).toUpperCase() + name.slice(1),
      value: Math.round(value),
    }));
  })();

  // Portfolio heat (sum of unrealized P&L as % of equity)
  const portfolioHeat = equity > 0
    ? openPositions.reduce((sum, p) => sum + Math.abs(p.unrealizedPnl), 0) / equity
    : 0;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-100">Portfolio Overview</h1>

      {showWizard && (
        <GettingStartedWizard
          onComplete={handleOnboardingComplete}
          onOpenAddKey={(service) => {
            // Navigate to settings with service pre-selected
            window.location.href = `/settings?addKey=${service}`;
          }}
          connectedExchanges={connectedExchanges}
        />
      )}

      {isEmpty && !showWizard && (
        <div className="card border-blue-500/30 bg-blue-500/5 py-8 text-center">
          <h2 className="text-lg font-semibold text-slate-200">Welcome to TradeWorks</h2>
          <p className="mt-2 text-sm text-slate-400">
            {hasNoKeys ? (
              <>
                Add your exchange API keys in{' '}
                <a href="/settings" className="text-blue-400 underline hover:text-blue-300">Settings</a>{' '}
                to get started with trading.
              </>
            ) : (
              <>
                Your exchanges are connected! Start the{' '}
                <a href="/agents" className="text-blue-400 underline hover:text-blue-300">AI Engine</a>{' '}
                or place a manual trade from{' '}
                <a href="/charts" className="text-blue-400 underline hover:text-blue-300">Charts</a>.
              </>
            )}
          </p>
        </div>
      )}

      {/* Top stats cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Total Equity */}
        <div className="card">
          <div className="card-header flex items-center gap-2">
            <DollarSign className="h-4 w-4" />
            Total Equity
          </div>
          <div className="stat-value-lg text-slate-100">
            ${equity.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </div>
          <div
            className={`mt-1 text-sm font-medium ${
              totalReturn >= 0 ? 'text-green-400' : 'text-red-400'
            }`}
          >
            {totalReturn >= 0 ? '+' : ''}
            {totalReturn.toFixed(2)}% all time
          </div>
        </div>

        {/* Daily P&L */}
        <div className="card">
          <div className="card-header flex items-center gap-2">
            {dailyPnl >= 0 ? (
              <TrendingUp className="h-4 w-4 text-green-400" />
            ) : (
              <TrendingDown className="h-4 w-4 text-red-400" />
            )}
            Daily P&L
          </div>
          <div
            className={`stat-value ${
              dailyPnl >= 0 ? 'text-green-400' : 'text-red-400'
            }`}
          >
            {dailyPnl >= 0 ? '+' : ''}$
            {Math.abs(dailyPnl).toLocaleString('en-US', {
              minimumFractionDigits: 2,
            })}
          </div>
          <div
            className={`mt-1 text-sm ${
              dailyPnlPercent >= 0 ? 'text-green-400/70' : 'text-red-400/70'
            }`}
          >
            {dailyPnlPercent >= 0 ? '+' : ''}
            {dailyPnlPercent.toFixed(2)}%
          </div>
        </div>

        {/* Open Positions */}
        <div className="card">
          <div className="card-header flex items-center gap-2">
            <Briefcase className="h-4 w-4" />
            Open Positions
          </div>
          <div className="stat-value text-slate-100">{openPositions.length}</div>
          <div className="mt-1 text-sm text-slate-500">
            across {new Set(openPositions.map((p) => p.market)).size} markets
          </div>
        </div>

        {/* Win Rate */}
        <div className="card">
          <div className="card-header flex items-center gap-2">
            <Target className="h-4 w-4" />
            Win Rate
          </div>
          <div className="stat-value text-slate-100">{winRate.toFixed(1)}%</div>
          <div className="mt-1 text-sm text-slate-500">
            {totalTrades} total trades
          </div>
        </div>
      </div>

      {/* Exchange Balances */}
      <WalletOverview />

      {/* ── Solana Meme Trading Overview ──────────────────────────────── */}
      {hasSolana && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-100">
              <Rocket className="h-5 w-5 text-purple-400" />
              Solana Meme Trading
            </h2>
            <a
              href="/solana"
              className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300"
            >
              Full Dashboard <ExternalLink className="h-3 w-3" />
            </a>
          </div>

          {/* Solana Status Cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {/* SOL Balance */}
            <div className="card">
              <div className="card-header flex items-center gap-2 text-xs">
                <DollarSign className="h-3.5 w-3.5 text-purple-400" />
                SOL Balance
              </div>
              <div className="text-lg font-bold text-slate-100">
                {solBalance ? `${solBalance.sol.toFixed(3)}` : '--'}
              </div>
              <div className="text-xs text-slate-500">
                {solBalance ? `≈ $${solBalance.usd.toFixed(2)}` : 'Loading...'}
              </div>
            </div>

            {/* Sniper Engine */}
            <div className="card">
              <div className="card-header flex items-center gap-2 text-xs">
                <Crosshair className="h-3.5 w-3.5 text-amber-400" />
                Sniper Engine
              </div>
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${sniperStatus?.running ? 'bg-green-400 animate-pulse' : 'bg-slate-600'}`} />
                <span className="text-sm font-medium text-slate-200">
                  {sniperStatus?.running ? 'Active' : 'Stopped'}
                </span>
              </div>
              <div className="text-xs text-slate-500">
                {sniperStatus ? `${sniperStatus.successfulSnipes}/${sniperStatus.totalSnipes} snipes · ${sniperStatus.openPositions} open` : '--'}
              </div>
            </div>

            {/* Whale Monitor */}
            <div className="card">
              <div className="card-header flex items-center gap-2 text-xs">
                <Eye className="h-3.5 w-3.5 text-cyan-400" />
                Whale Tracker
              </div>
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${whaleMonitor?.running ? 'bg-green-400 animate-pulse' : 'bg-slate-600'}`} />
                <span className="text-sm font-medium text-slate-200">
                  {whaleMonitor?.running ? 'Monitoring' : 'Stopped'}
                </span>
              </div>
              <div className="text-xs text-slate-500">
                {whaleMonitor ? `${whaleMonitor.trackedWhales} whales · ${whaleMonitor.totalActivities} txns` : '--'}
              </div>
            </div>

            {/* pump.fun Monitor */}
            <div className="card">
              <div className="card-header flex items-center gap-2 text-xs">
                <Activity className="h-3.5 w-3.5 text-pink-400" />
                pump.fun
              </div>
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${pumpfunStatus?.running ? 'bg-green-400 animate-pulse' : 'bg-slate-600'}`} />
                <span className="text-sm font-medium text-slate-200">
                  {pumpfunStatus?.running ? 'Live' : 'Stopped'}
                </span>
              </div>
              <div className="text-xs text-slate-500">
                {pumpfunStatus ? `${pumpfunStatus.totalDetected} launches detected` : '--'}
              </div>
            </div>
          </div>

          {/* Bottom row: Moonshot Alerts + Recent pump.fun Launches */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Moonshot AI Alerts */}
            <div className="card">
              <div className="card-header flex items-center gap-2">
                <Brain className="h-4 w-4 text-yellow-400" />
                Moonshot Alerts
              </div>
              {topAlerts.length === 0 ? (
                <p className="py-4 text-center text-xs text-slate-500">No high-score tokens detected</p>
              ) : (
                <div className="space-y-2">
                  {topAlerts.map((alert) => (
                    <div key={alert.mint} className="flex items-center justify-between rounded-lg bg-slate-800/50 px-3 py-2">
                      <div>
                        <span className="font-medium text-slate-200">{alert.symbol}</span>
                        <span className="ml-2 text-xs text-slate-500">{alert.name}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                          alert.rugRisk === 'low' ? 'bg-green-500/10 text-green-400' :
                          alert.rugRisk === 'medium' ? 'bg-amber-500/10 text-amber-400' :
                          'bg-red-500/10 text-red-400'
                        }`}>
                          {alert.rugRisk}
                        </span>
                        <span className={`text-sm font-bold ${
                          alert.score >= 70 ? 'text-green-400' :
                          alert.score >= 50 ? 'text-amber-400' : 'text-slate-400'
                        }`}>
                          {alert.score}/100
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Recent pump.fun Launches */}
            <div className="card">
              <div className="card-header flex items-center gap-2">
                <Rocket className="h-4 w-4 text-pink-400" />
                Recent pump.fun Launches
              </div>
              {recentPumpLaunches.length === 0 ? (
                <p className="py-4 text-center text-xs text-slate-500">Start the pump.fun monitor to detect launches</p>
              ) : (
                <div className="space-y-2">
                  {recentPumpLaunches.map((token) => (
                    <div key={token.mint} className="flex items-center justify-between rounded-lg bg-slate-800/50 px-3 py-2">
                      <div>
                        <span className="font-medium text-slate-200">{token.symbol}</span>
                        <span className="ml-2 text-xs text-slate-500 truncate max-w-[120px] inline-block align-bottom">{token.name}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="w-16">
                          <div className="h-1.5 rounded-full bg-slate-700">
                            <div
                              className="h-1.5 rounded-full bg-gradient-to-r from-pink-500 to-purple-500"
                              style={{ width: `${Math.min(token.bondingCurveProgress, 100)}%` }}
                            />
                          </div>
                        </div>
                        <span className="text-xs text-slate-400 w-16 text-right">
                          ${token.usdMarketCap >= 1000 ? `${(token.usdMarketCap / 1000).toFixed(0)}k` : token.usdMarketCap.toFixed(0)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Charts row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Equity Curve */}
        <div className="card lg:col-span-2">
          <div className="card-header flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            Equity Curve
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={equityCurve}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis
                  dataKey="date"
                  stroke="#64748b"
                  tick={{ fill: '#64748b', fontSize: 11 }}
                  tickFormatter={(v: string) => v.slice(5)}
                />
                <YAxis
                  stroke="#64748b"
                  tick={{ fill: '#64748b', fontSize: 11 }}
                  tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
                  domain={['auto', 'auto']}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#1e293b',
                    border: '1px solid #334155',
                    borderRadius: '8px',
                    color: '#f1f5f9',
                  }}
                  labelStyle={{ color: '#94a3b8' }}
                  formatter={(value: number) => [
                    `$${value.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
                    'Equity',
                  ]}
                />
                <Line
                  type="monotone"
                  dataKey="equity"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, fill: '#3b82f6' }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Right column: Allocation + Heat */}
        <div className="space-y-6">
          {/* Allocation Pie */}
          <div className="card">
            <div className="card-header">Asset Allocation</div>
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={allocationData}
                    cx="50%"
                    cy="50%"
                    innerRadius={40}
                    outerRadius={65}
                    dataKey="value"
                    paddingAngle={3}
                    stroke="none"
                  >
                    {allocationData.map((_, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={PIE_COLORS[index % PIE_COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#1e293b',
                      border: '1px solid #334155',
                      borderRadius: '8px',
                      color: '#f1f5f9',
                    }}
                    formatter={(value: number) => [
                      `$${value.toLocaleString()}`,
                    ]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 flex flex-wrap gap-3">
              {allocationData.map((item, index) => (
                <div key={item.name} className="flex items-center gap-1.5 text-xs">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{
                      backgroundColor: PIE_COLORS[index % PIE_COLORS.length],
                    }}
                  />
                  <span className="text-slate-400">{item.name}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Portfolio Heat */}
          <div className="card">
            <div className="card-header">Portfolio Heat</div>
            <div className="relative h-4 overflow-hidden rounded-full bg-slate-700">
              <div
                className={`h-full rounded-full transition-all ${
                  portfolioHeat > 0.06
                    ? 'bg-red-500'
                    : portfolioHeat > 0.04
                      ? 'bg-amber-500'
                      : 'bg-green-500'
                }`}
                style={{ width: `${Math.min(portfolioHeat * 100 * 10, 100)}%` }}
              />
            </div>
            <div className="mt-2 flex justify-between text-xs text-slate-500">
              <span>{(portfolioHeat * 100).toFixed(2)}%</span>
              <span>Limit: 6.00%</span>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Trades Table */}
      <div className="card">
        <div className="card-header">Recent Trades</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700/50 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                <th className="pb-3 pr-4">Time</th>
                <th className="pb-3 pr-4">Instrument</th>
                <th className="pb-3 pr-4">Side</th>
                <th className="pb-3 pr-4 text-right">Qty</th>
                <th className="pb-3 pr-4 text-right">Price</th>
                <th className="pb-3 pr-4 text-right">P&L</th>
                <th className="pb-3">Strategy</th>
              </tr>
            </thead>
            <tbody>
              {recentTrades.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-sm text-slate-500">
                    No trades yet. Place your first trade from the Charts page.
                  </td>
                </tr>
              )}
              {recentTrades.slice(0, 10).map((trade) => (
                <tr key={trade.id} className="table-row">
                  <td className="py-2.5 pr-4 text-slate-400">
                    {new Date(trade.executedAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                  <td className="py-2.5 pr-4 font-medium text-slate-200">
                    {trade.instrument}
                  </td>
                  <td className="py-2.5 pr-4">
                    <span
                      className={`inline-flex rounded px-1.5 py-0.5 text-xs font-medium ${
                        trade.side === 'buy'
                          ? 'bg-green-500/10 text-green-400'
                          : 'bg-red-500/10 text-red-400'
                      }`}
                    >
                      {trade.side.toUpperCase()}
                    </span>
                  </td>
                  <td className="py-2.5 pr-4 text-right text-slate-300">
                    {trade.quantity}
                  </td>
                  <td className="py-2.5 pr-4 text-right text-slate-300">
                    ${trade.price.toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                    })}
                  </td>
                  <td
                    className={`py-2.5 pr-4 text-right font-medium ${
                      trade.pnl > 0
                        ? 'text-green-400'
                        : trade.pnl < 0
                          ? 'text-red-400'
                          : 'text-slate-500'
                    }`}
                  >
                    {trade.pnl !== 0
                      ? `${trade.pnl > 0 ? '+' : ''}$${trade.pnl.toFixed(2)}`
                      : '--'}
                  </td>
                  <td className="py-2.5 text-slate-500">{trade.strategyId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Open Positions */}
      <div className="card">
        <div className="card-header">Open Positions</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700/50 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                <th className="pb-3 pr-4">Instrument</th>
                <th className="pb-3 pr-4">Market</th>
                <th className="pb-3 pr-4">Side</th>
                <th className="pb-3 pr-4 text-right">Qty</th>
                <th className="pb-3 pr-4 text-right">Entry</th>
                <th className="pb-3 pr-4 text-right">Current</th>
                <th className="pb-3 text-right">Unrealized P&L</th>
              </tr>
            </thead>
            <tbody>
              {openPositions.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-sm text-slate-500">
                    No open positions.
                  </td>
                </tr>
              )}
              {openPositions.map((pos) => (
                <tr key={pos.id} className="table-row">
                  <td className="py-2.5 pr-4 font-medium text-slate-200">
                    {pos.instrument}
                  </td>
                  <td className="py-2.5 pr-4">
                    <span className="badge-info">
                      {pos.market.toUpperCase()}
                    </span>
                  </td>
                  <td className="py-2.5 pr-4">
                    <span
                      className={`inline-flex rounded px-1.5 py-0.5 text-xs font-medium ${
                        pos.side === 'long'
                          ? 'bg-green-500/10 text-green-400'
                          : 'bg-red-500/10 text-red-400'
                      }`}
                    >
                      {pos.side.toUpperCase()}
                    </span>
                  </td>
                  <td className="py-2.5 pr-4 text-right text-slate-300">
                    {pos.quantity}
                  </td>
                  <td className="py-2.5 pr-4 text-right text-slate-300">
                    ${pos.averageEntry.toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                    })}
                  </td>
                  <td className="py-2.5 pr-4 text-right text-slate-300">
                    ${pos.currentPrice.toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                    })}
                  </td>
                  <td
                    className={`py-2.5 text-right font-medium ${
                      pos.unrealizedPnl >= 0 ? 'text-green-400' : 'text-red-400'
                    }`}
                  >
                    {pos.unrealizedPnl >= 0 ? '+' : ''}$
                    {Math.abs(pos.unrealizedPnl).toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
