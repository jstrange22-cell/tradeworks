import { useMemo } from 'react';
import { TrendingUp } from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import type { TradeData } from '@/types/analytics';

interface SharpeRatioChartProps {
  trades: TradeData[];
}

interface SharpePoint {
  date: string;
  sharpe: number;
}

const ROLLING_WINDOW = 30;
const ANNUALIZATION_FACTOR = Math.sqrt(365);

function computeRollingSharpe(trades: TradeData[]): SharpePoint[] {
  // Aggregate daily returns
  const dailyReturns = new Map<string, number>();
  for (const trade of trades) {
    const dateKey = trade.executedAt.slice(0, 10);
    dailyReturns.set(dateKey, (dailyReturns.get(dateKey) ?? 0) + trade.pnl);
  }

  const sortedDays = Array.from(dailyReturns.entries())
    .sort(([a], [b]) => a.localeCompare(b));

  if (sortedDays.length < ROLLING_WINDOW) return [];

  const points: SharpePoint[] = [];
  for (let idx = ROLLING_WINDOW - 1; idx < sortedDays.length; idx++) {
    const window = sortedDays.slice(idx - ROLLING_WINDOW + 1, idx + 1);
    const returns = window.map(([, pnl]) => pnl);
    const mean = returns.reduce((sum, val) => sum + val, 0) / returns.length;
    const variance = returns.reduce((sum, val) => sum + (val - mean) ** 2, 0) / returns.length;
    const stdDev = Math.sqrt(variance);
    const sharpe = stdDev > 0 ? (mean / stdDev) * ANNUALIZATION_FACTOR : 0;

    const [date] = sortedDays[idx];
    points.push({
      date: new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      sharpe: Number(sharpe.toFixed(2)),
    });
  }

  return points;
}

export function SharpeRatioChart({ trades }: SharpeRatioChartProps) {
  const data = useMemo(() => computeRollingSharpe(trades), [trades]);
  const hasData = data.length > 0;
  const currentSharpe = hasData ? data[data.length - 1].sharpe : 0;

  return (
    <div className="card">
      <div className="card-header flex items-center gap-2">
        <TrendingUp className="h-4 w-4 text-blue-400" />
        Sharpe Ratio (30-Day Rolling)
        {hasData && (
          <span className={`ml-auto text-sm font-bold normal-case tracking-normal ${
            currentSharpe >= 1 ? 'text-green-400' : currentSharpe >= 0 ? 'text-yellow-400' : 'text-red-400'
          }`}>
            {currentSharpe.toFixed(2)}
          </span>
        )}
      </div>

      {!hasData ? (
        <div className="flex h-48 items-center justify-center text-sm text-slate-500">
          Need {ROLLING_WINDOW}+ days of trading data
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
            <XAxis
              dataKey="date"
              tick={{ fill: '#64748b', fontSize: 10 }}
              axisLine={{ stroke: '#334155' }}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fill: '#64748b', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <ReferenceLine y={0} stroke="#475569" strokeDasharray="3 3" />
            <ReferenceLine y={1} stroke="#22c55e" strokeDasharray="4 4" strokeOpacity={0.4} />
            <Tooltip
              contentStyle={{
                backgroundColor: '#1e293b',
                border: '1px solid #334155',
                borderRadius: '8px',
                fontSize: '12px',
                color: '#e2e8f0',
              }}
              formatter={(value: number) => [value.toFixed(2), 'Sharpe Ratio']}
            />
            <Line
              type="monotone"
              dataKey="sharpe"
              stroke="#3b82f6"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: '#3b82f6' }}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
