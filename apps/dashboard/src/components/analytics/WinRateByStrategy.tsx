import { useMemo } from 'react';
import { Target } from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from 'recharts';
import type { TradeData } from '@/types/analytics';

interface WinRateByStrategyProps {
  trades: TradeData[];
}

interface StrategyStats {
  strategy: string;
  winRate: number;
  totalTrades: number;
  wins: number;
}

export function WinRateByStrategy({ trades }: WinRateByStrategyProps) {
  const data = useMemo((): StrategyStats[] => {
    const stratMap = new Map<string, { wins: number; total: number }>();
    for (const trade of trades) {
      const stratId = trade.strategyId || 'Manual';
      const entry = stratMap.get(stratId) ?? { wins: 0, total: 0 };
      entry.total++;
      if (trade.pnl > 0) entry.wins++;
      stratMap.set(stratId, entry);
    }

    return Array.from(stratMap.entries())
      .map(([strategy, { wins, total }]) => ({
        strategy: strategy.length > 12 ? `${strategy.slice(0, 12)}...` : strategy,
        winRate: total > 0 ? Math.round((wins / total) * 100) : 0,
        totalTrades: total,
        wins,
      }))
      .sort((a, b) => b.winRate - a.winRate)
      .slice(0, 8);
  }, [trades]);

  const hasData = data.length > 0;

  return (
    <div className="card">
      <div className="card-header flex items-center gap-2">
        <Target className="h-4 w-4 text-blue-400" />
        Win Rate by Strategy
      </div>

      {!hasData ? (
        <div className="flex h-48 items-center justify-center text-sm text-slate-500">
          No trade data available
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
            <XAxis
              dataKey="strategy"
              tick={{ fill: '#94a3b8', fontSize: 11 }}
              axisLine={{ stroke: '#334155' }}
              tickLine={false}
            />
            <YAxis
              domain={[0, 100]}
              tick={{ fill: '#64748b', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(val: number) => `${val}%`}
            />
            <ReferenceLine y={50} stroke="#475569" strokeDasharray="3 3" />
            <Tooltip
              contentStyle={{
                backgroundColor: '#1e293b',
                border: '1px solid #334155',
                borderRadius: '8px',
                fontSize: '12px',
                color: '#e2e8f0',
              }}
              formatter={(value: number, _name: string, entry) => {
                const payload = entry.payload as StrategyStats;
                return [`${value}% (${payload.wins}/${payload.totalTrades})`, 'Win Rate'];
              }}
            />
            <Bar dataKey="winRate" radius={[4, 4, 0, 0]} maxBarSize={36}>
              {data.map((entry, index) => (
                <Cell
                  key={index}
                  fill={entry.winRate >= 50 ? '#22c55e' : '#ef4444'}
                  fillOpacity={0.7}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
