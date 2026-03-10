import { useMemo } from 'react';
import { Clock } from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import type { TradeData } from '@/types/analytics';

interface TradeFrequencyChartProps {
  trades: TradeData[];
}

interface HourBucket {
  hour: string;
  count: number;
  label: string;
}

function formatHourLabel(hour: number): string {
  if (hour === 0) return '12a';
  if (hour < 12) return `${hour}a`;
  if (hour === 12) return '12p';
  return `${hour - 12}p`;
}

export function TradeFrequencyChart({ trades }: TradeFrequencyChartProps) {
  const data = useMemo((): HourBucket[] => {
    const hourCounts = new Array<number>(24).fill(0);

    for (const trade of trades) {
      const hour = new Date(trade.executedAt).getHours();
      hourCounts[hour]++;
    }

    return hourCounts.map((count, hour) => ({
      hour: String(hour).padStart(2, '0'),
      count,
      label: formatHourLabel(hour),
    }));
  }, [trades]);

  const maxCount = Math.max(1, ...data.map((d) => d.count));
  const hasData = data.some((d) => d.count > 0);
  const peakHour = data.reduce((max, d) => (d.count > max.count ? d : max), data[0]);

  return (
    <div className="card">
      <div className="card-header flex items-center gap-2">
        <Clock className="h-4 w-4 text-blue-400" />
        Trade Frequency by Hour
        {hasData && (
          <span className="ml-auto text-xs normal-case tracking-normal text-slate-500">
            Peak: {peakHour.label} ({peakHour.count} trades)
          </span>
        )}
      </div>

      {!hasData ? (
        <div className="flex h-48 items-center justify-center text-sm text-slate-500">
          No trade data available
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
            <XAxis
              dataKey="label"
              tick={{ fill: '#64748b', fontSize: 10 }}
              axisLine={{ stroke: '#334155' }}
              tickLine={false}
              interval={2}
            />
            <YAxis
              tick={{ fill: '#64748b', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#1e293b',
                border: '1px solid #334155',
                borderRadius: '8px',
                fontSize: '12px',
                color: '#e2e8f0',
              }}
              formatter={(value: number) => [value, 'Trades']}
              labelFormatter={(label: string) => `Hour: ${label}`}
            />
            <Bar dataKey="count" radius={[3, 3, 0, 0]} maxBarSize={20}>
              {data.map((entry, index) => (
                <Cell
                  key={index}
                  fill="#3b82f6"
                  fillOpacity={0.3 + (entry.count / maxCount) * 0.7}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
