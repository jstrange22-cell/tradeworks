import {
  ShieldAlert,
  Zap,
  ZapOff,
  AlertTriangle,
  TrendingDown,
  Gauge,
  Loader2,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
} from 'recharts';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { usePortfolioStore } from '@/stores/portfolio-store';
import { useUIStore } from '@/stores/ui-store';

interface RiskMetricsResponse {
  timestamp: string;
  portfolio: {
    equity: number;
    cash: number;
    marginUsed: number;
    marginAvailable: number;
    buyingPower: number;
  };
  risk: {
    portfolioHeat: number;
    portfolioHeatLimit: number;
    dailyPnl: number;
    dailyPnlPercent: number;
    dailyLossLimit: number;
    maxDrawdown: number;
    maxDrawdownLimit: number;
    valueAtRisk1Day: number;
    valueAtRisk5Day: number;
    sharpeRatio: number;
    sortinoRatio: number;
  };
  positions: {
    totalOpen: number;
    totalValue: number;
    unrealizedPnl: number;
    biggestWinner: string | null;
    biggestLoser: string | null;
  };
  circuitBreaker: {
    tripped: boolean;
    reason: string | null;
    trippedAt: string | null;
    canResumeAt: string | null;
  };
  exposure: {
    crypto: number;
    equities: number;
    predictions: number;
    cash: number;
  };
}

interface RiskHistoryEntry {
  timestamp: string;
  maxDrawdown: number;
  var95: number;
  portfolioHeat: number;
}

export function RiskPage() {
  const storeCircuitBreaker = usePortfolioStore((s) => s.circuitBreaker);
  const theme = useUIStore((s) => s.theme);

  const { data: metricsResp, isLoading } = useQuery({
    queryKey: ['risk-metrics'],
    queryFn: () => apiClient.get<{ data: RiskMetricsResponse }>('/risk/metrics'),
    refetchInterval: 15_000,
    retry: 2,
  });

  const { data: historyResp } = useQuery({
    queryKey: ['risk-history'],
    queryFn: () => apiClient.get<{ data: RiskHistoryEntry[] }>('/risk/history?period=30d&interval=1d'),
    refetchInterval: 60_000,
    retry: 2,
  });

  const metrics = metricsResp?.data;
  const history = historyResp?.data ?? [];

  const circuitBreaker = metrics?.circuitBreaker.tripped ?? storeCircuitBreaker;
  const var95 = metrics?.risk.valueAtRisk1Day ?? 0;
  const var99 = metrics?.risk.valueAtRisk5Day ?? 0;
  const portfolioHeat = metrics?.risk.portfolioHeat ?? 0;
  const equity = metrics?.portfolio.equity ?? 0;

  // Build risk limits from real data
  const riskLimits = [
    { metric: 'Daily Loss', current: Math.abs(metrics?.risk.dailyPnlPercent ?? 0), limit: metrics?.risk.dailyLossLimit ?? 3.0, unit: '%' },
    { metric: 'Portfolio Heat', current: portfolioHeat, limit: metrics?.risk.portfolioHeatLimit ?? 6.0, unit: '%' },
    { metric: 'Max Drawdown', current: Math.abs(metrics?.risk.maxDrawdown ?? 0), limit: metrics?.risk.maxDrawdownLimit ?? 10.0, unit: '%' },
    { metric: 'Sharpe Ratio (30d)', current: metrics?.risk.sharpeRatio ?? 0, limit: 0, unit: '' },
  ];

  // Build exposure from real data
  const exposureByMarket = equity > 0
    ? [
        { market: 'Crypto', exposure: Number(((metrics?.exposure.crypto ?? 0) / equity * 100).toFixed(1)), limit: 40 },
        { market: 'Equities', exposure: Number(((metrics?.exposure.equities ?? 0) / equity * 100).toFixed(1)), limit: 40 },
        { market: 'Predictions', exposure: Number(((metrics?.exposure.predictions ?? 0) / equity * 100).toFixed(1)), limit: 30 },
      ]
    : [
        { market: 'Crypto', exposure: 0, limit: 40 },
        { market: 'Equities', exposure: 0, limit: 40 },
        { market: 'Predictions', exposure: 0, limit: 30 },
      ];

  // Build drawdown history from real data
  const drawdownHistory = history.map((entry) => ({
    date: entry.timestamp.split('T')[0],
    drawdown: -(Math.abs(entry.maxDrawdown)),
  }));

  // Chart theming
  const gridStroke = theme === 'dark' ? '#334155' : '#e2e8f0';
  const axisStroke = theme === 'dark' ? '#64748b' : '#94a3b8';
  const tickFill = theme === 'dark' ? '#64748b' : '#6b7280';
  const tooltipBg = theme === 'dark' ? '#1e293b' : '#ffffff';
  const tooltipBorder = theme === 'dark' ? '#334155' : '#e5e7eb';
  const tooltipColor = theme === 'dark' ? '#f1f5f9' : '#111827';
  const barLimitFill = theme === 'dark' ? '#334155' : '#d1d5db';

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <ShieldAlert className="h-6 w-6 text-blue-400" />
        <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Risk Dashboard</h1>
        {isLoading && <Loader2 className="h-4 w-4 animate-spin text-blue-400" />}
      </div>

      {/* Circuit Breaker */}
      <div
        className={`card flex items-center gap-4 border-2 ${
          circuitBreaker
            ? 'border-red-500/50 bg-red-500/5'
            : 'border-green-500/30 bg-green-500/5'
        }`}
      >
        <div
          className={`flex h-14 w-14 items-center justify-center rounded-full ${
            circuitBreaker ? 'bg-red-500/20' : 'bg-green-500/20'
          }`}
        >
          {circuitBreaker ? (
            <ZapOff className="h-7 w-7 text-red-400" />
          ) : (
            <Zap className="h-7 w-7 text-green-400" />
          )}
        </div>
        <div>
          <div className={`text-lg font-bold ${circuitBreaker ? 'text-red-400' : 'text-green-400'}`}>
            Circuit Breaker: {circuitBreaker ? 'TRIGGERED' : 'NORMAL'}
          </div>
          <div className="text-sm text-gray-500 dark:text-slate-400">
            {circuitBreaker
              ? 'All trading halted. Manual review required.'
              : 'All systems operating within risk parameters.'}
          </div>
        </div>
      </div>

      {/* VaR + Heat gauges */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="card">
          <div className="card-header flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            Value at Risk (95%)
          </div>
          <div className="stat-value text-amber-400">
            ${var95.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </div>
          <div className="mt-2">
            <div className="relative h-3 overflow-hidden rounded-full bg-gray-200 dark:bg-slate-700">
              <div className="h-full rounded-full bg-amber-500 transition-all" style={{ width: `${equity > 0 ? Math.min((var95 / equity) * 100, 100) : 0}%` }} />
            </div>
            <div className="mt-1 flex justify-between text-xs text-gray-500 dark:text-slate-500"><span>$0</span><span>{equity > 0 ? `$${equity.toLocaleString()} equity` : 'No equity'}</span></div>
          </div>
        </div>

        <div className="card">
          <div className="card-header flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            Value at Risk (99%)
          </div>
          <div className="stat-value text-red-400">
            ${var99.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </div>
          <div className="mt-2">
            <div className="relative h-3 overflow-hidden rounded-full bg-gray-200 dark:bg-slate-700">
              <div className="h-full rounded-full bg-red-500 transition-all" style={{ width: `${equity > 0 ? Math.min((var99 / equity) * 100, 100) : 0}%` }} />
            </div>
            <div className="mt-1 flex justify-between text-xs text-gray-500 dark:text-slate-500"><span>$0</span><span>{equity > 0 ? `$${equity.toLocaleString()} equity` : 'No equity'}</span></div>
          </div>
        </div>

        <div className="card">
          <div className="card-header flex items-center gap-2">
            <Gauge className="h-4 w-4" />
            Portfolio Heat
          </div>
          <div className={`stat-value ${portfolioHeat > 5 ? 'text-red-400' : portfolioHeat > 3 ? 'text-amber-400' : 'text-green-400'}`}>
            {portfolioHeat.toFixed(1)}%
          </div>
          <div className="mt-2">
            <div className="relative h-3 overflow-hidden rounded-full bg-gray-200 dark:bg-slate-700">
              <div
                className={`h-full rounded-full transition-all ${portfolioHeat > 5 ? 'bg-red-500' : portfolioHeat > 3 ? 'bg-amber-500' : 'bg-green-500'}`}
                style={{ width: `${Math.min((portfolioHeat / 6) * 100, 100)}%` }}
              />
            </div>
            <div className="mt-1 flex justify-between text-xs text-gray-500 dark:text-slate-500"><span>0%</span><span>6% limit</span></div>
          </div>
        </div>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="card">
          <div className="card-header flex items-center gap-2">
            <TrendingDown className="h-4 w-4" />
            Drawdown Over Time
          </div>
          <div className="h-56">
            {drawdownHistory.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={drawdownHistory}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                  <XAxis dataKey="date" stroke={axisStroke} tick={{ fill: tickFill, fontSize: 11 }} tickFormatter={(v: string) => v.slice(5)} />
                  <YAxis stroke={axisStroke} tick={{ fill: tickFill, fontSize: 11 }} tickFormatter={(v: number) => `${v.toFixed(1)}%`} />
                  <Tooltip contentStyle={{ backgroundColor: tooltipBg, border: `1px solid ${tooltipBorder}`, borderRadius: '8px', color: tooltipColor }} formatter={(value: number) => [`${value.toFixed(2)}%`, 'Drawdown']} />
                  <Area type="monotone" dataKey="drawdown" stroke="#ef4444" fill="#ef4444" fillOpacity={0.1} strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-gray-400 dark:text-slate-500">
                No drawdown history available
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">Exposure by Market</div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={exposureByMarket} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} horizontal={false} />
                <XAxis type="number" stroke={axisStroke} tick={{ fill: tickFill, fontSize: 11 }} tickFormatter={(v: number) => `${v}%`} domain={[0, 50]} />
                <YAxis type="category" dataKey="market" stroke={axisStroke} tick={{ fill: tickFill, fontSize: 12 }} width={80} />
                <Tooltip contentStyle={{ backgroundColor: tooltipBg, border: `1px solid ${tooltipBorder}`, borderRadius: '8px', color: tooltipColor }} formatter={(value: number, name: string) => [`${value}%`, name === 'exposure' ? 'Current' : 'Limit']} />
                <Bar dataKey="exposure" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                <Bar dataKey="limit" fill={barLimitFill} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Risk Limits Table */}
      <div className="card">
        <div className="card-header">Risk Limits Status</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-slate-700/50 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-500">
                <th className="pb-3 pr-4">Metric</th>
                <th className="pb-3 pr-4 text-right">Current</th>
                <th className="pb-3 pr-4 text-right">Limit</th>
                <th className="pb-3 pr-4">Utilization</th>
                <th className="pb-3 text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {riskLimits.map((row) => {
                // Sharpe ratio doesn't have a limit
                if (row.limit === 0) {
                  return (
                    <tr key={row.metric} className="table-row">
                      <td className="py-2.5 pr-4 font-medium text-gray-800 dark:text-slate-200">{row.metric}</td>
                      <td className="py-2.5 pr-4 text-right text-gray-600 dark:text-slate-300">{row.current.toFixed(2)}{row.unit}</td>
                      <td className="py-2.5 pr-4 text-right text-gray-400 dark:text-slate-500">—</td>
                      <td className="py-2.5 pr-4">—</td>
                      <td className="py-2.5 text-right">
                        <span className="badge-neutral">INFO</span>
                      </td>
                    </tr>
                  );
                }

                const utilization = (row.current / row.limit) * 100;
                const isOk = row.current <= row.limit;
                const isWarning = utilization > 70;

                return (
                  <tr key={row.metric} className="table-row">
                    <td className="py-2.5 pr-4 font-medium text-gray-800 dark:text-slate-200">{row.metric}</td>
                    <td className="py-2.5 pr-4 text-right text-gray-600 dark:text-slate-300">{row.current.toFixed(2)}{row.unit}</td>
                    <td className="py-2.5 pr-4 text-right text-gray-400 dark:text-slate-500">{row.limit}{row.unit}</td>
                    <td className="py-2.5 pr-4">
                      <div className="relative h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-slate-700">
                        <div className={`h-full rounded-full transition-all ${!isOk ? 'bg-red-500' : isWarning ? 'bg-amber-500' : 'bg-green-500'}`} style={{ width: `${Math.min(utilization, 100)}%` }} />
                      </div>
                    </td>
                    <td className="py-2.5 text-right">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${!isOk ? 'bg-red-500/10 text-red-400' : isWarning ? 'bg-amber-500/10 text-amber-400' : 'bg-green-500/10 text-green-400'}`}>
                        {!isOk ? 'BREACH' : isWarning ? 'WARNING' : 'OK'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
