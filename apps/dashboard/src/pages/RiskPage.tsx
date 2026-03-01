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

interface RiskData {
  equity: number;
  cash: number;
  portfolioHeat: number;
  var95: number;
  var99: number;
  maxDrawdown: number;
  dailyLossUsed: number;
  weeklyLossUsed: number;
  circuitBreakerActive: boolean;
  riskLimits: Array<{ metric: string; current: number; limit: number; unit: string }>;
  exposureByMarket: Array<{ market: string; exposure: number; limit: number }>;
  drawdownHistory: Array<{ date: string; drawdown: number }>;
}

// Fallback mock data
const fallbackDrawdown = Array.from({ length: 30 }, (_, i) => {
  const date = new Date();
  date.setDate(date.getDate() - (29 - i));
  return { date: date.toISOString().split('T')[0], drawdown: -(Math.random() * 3 + Math.sin(i * 0.4) * 1.5) };
});

const fallbackExposure = [
  { market: 'Crypto', exposure: 34.2, limit: 40 },
  { market: 'Prediction', exposure: 12.5, limit: 30 },
  { market: 'Equity', exposure: 22.8, limit: 40 },
];

const fallbackLimits = [
  { metric: 'Risk per Trade', current: 0.8, limit: 1.0, unit: '%' },
  { metric: 'Daily Loss', current: 1.2, limit: 3.0, unit: '%' },
  { metric: 'Weekly Loss', current: 2.1, limit: 7.0, unit: '%' },
  { metric: 'Portfolio Heat', current: 3.2, limit: 6.0, unit: '%' },
  { metric: 'Max Correlation', current: 28, limit: 40, unit: '%' },
  { metric: 'Min Risk/Reward', current: 3.2, limit: 3.0, unit: ':1' },
];

export function RiskPage() {
  const storeCircuitBreaker = usePortfolioStore((s) => s.circuitBreaker);

  const { data, isLoading } = useQuery({
    queryKey: ['risk-metrics'],
    queryFn: () => apiClient.get<RiskData>('/portfolio/risk'),
    refetchInterval: 15_000,
    retry: 2,
  });

  const circuitBreaker = data?.circuitBreakerActive ?? storeCircuitBreaker;
  const var95 = data?.var95 ?? 2847.5;
  const var99 = data?.var99 ?? 4215.3;
  const portfolioHeat = data?.portfolioHeat ?? 3.2;
  const riskLimits = data?.riskLimits ?? fallbackLimits;
  const exposureByMarket = data?.exposureByMarket ?? fallbackExposure;
  const drawdownHistory = data?.drawdownHistory ?? fallbackDrawdown;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <ShieldAlert className="h-6 w-6 text-blue-400" />
        <h1 className="text-2xl font-bold text-slate-100">Risk Dashboard</h1>
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
          <div className="text-sm text-slate-400">
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
            <div className="relative h-3 overflow-hidden rounded-full bg-slate-700">
              <div className="h-full rounded-full bg-amber-500 transition-all" style={{ width: `${Math.min((var95 / 5000) * 100, 100)}%` }} />
            </div>
            <div className="mt-1 flex justify-between text-xs text-slate-500"><span>$0</span><span>$5,000 limit</span></div>
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
            <div className="relative h-3 overflow-hidden rounded-full bg-slate-700">
              <div className="h-full rounded-full bg-red-500 transition-all" style={{ width: `${Math.min((var99 / 8000) * 100, 100)}%` }} />
            </div>
            <div className="mt-1 flex justify-between text-xs text-slate-500"><span>$0</span><span>$8,000 limit</span></div>
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
            <div className="relative h-3 overflow-hidden rounded-full bg-slate-700">
              <div
                className={`h-full rounded-full transition-all ${portfolioHeat > 5 ? 'bg-red-500' : portfolioHeat > 3 ? 'bg-amber-500' : 'bg-green-500'}`}
                style={{ width: `${Math.min((portfolioHeat / 6) * 100, 100)}%` }}
              />
            </div>
            <div className="mt-1 flex justify-between text-xs text-slate-500"><span>0%</span><span>6% limit</span></div>
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
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={drawdownHistory}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="date" stroke="#64748b" tick={{ fill: '#64748b', fontSize: 11 }} tickFormatter={(v: string) => v.slice(5)} />
                <YAxis stroke="#64748b" tick={{ fill: '#64748b', fontSize: 11 }} tickFormatter={(v: number) => `${v.toFixed(1)}%`} />
                <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', color: '#f1f5f9' }} formatter={(value: number) => [`${value.toFixed(2)}%`, 'Drawdown']} />
                <Area type="monotone" dataKey="drawdown" stroke="#ef4444" fill="#ef4444" fillOpacity={0.1} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <div className="card-header">Exposure by Market</div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={exposureByMarket} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
                <XAxis type="number" stroke="#64748b" tick={{ fill: '#64748b', fontSize: 11 }} tickFormatter={(v: number) => `${v}%`} domain={[0, 50]} />
                <YAxis type="category" dataKey="market" stroke="#64748b" tick={{ fill: '#94a3b8', fontSize: 12 }} width={80} />
                <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', color: '#f1f5f9' }} formatter={(value: number, name: string) => [`${value}%`, name === 'exposure' ? 'Current' : 'Limit']} />
                <Bar dataKey="exposure" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                <Bar dataKey="limit" fill="#334155" radius={[0, 4, 4, 0]} />
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
              <tr className="border-b border-slate-700/50 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                <th className="pb-3 pr-4">Metric</th>
                <th className="pb-3 pr-4 text-right">Current</th>
                <th className="pb-3 pr-4 text-right">Limit</th>
                <th className="pb-3 pr-4">Utilization</th>
                <th className="pb-3 text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {riskLimits.map((row) => {
                const utilization = row.metric === 'Min Risk/Reward' ? (row.limit / row.current) * 100 : (row.current / row.limit) * 100;
                const isOk = row.metric === 'Min Risk/Reward' ? row.current >= row.limit : row.current <= row.limit;
                const isWarning = row.metric === 'Min Risk/Reward' ? row.current < row.limit * 1.2 : utilization > 70;

                return (
                  <tr key={row.metric} className="table-row">
                    <td className="py-2.5 pr-4 font-medium text-slate-200">{row.metric}</td>
                    <td className="py-2.5 pr-4 text-right text-slate-300">{row.current}{row.unit}</td>
                    <td className="py-2.5 pr-4 text-right text-slate-500">{row.limit}{row.unit}</td>
                    <td className="py-2.5 pr-4">
                      <div className="relative h-2 w-full overflow-hidden rounded-full bg-slate-700">
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
