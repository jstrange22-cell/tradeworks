import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { BarChart3 } from 'lucide-react';
import type { EquityCurvePoint } from '@/stores/portfolio-store';

interface EquityCurveChartProps {
  equityCurve: EquityCurvePoint[];
}

export function EquityCurveChart({ equityCurve }: EquityCurveChartProps) {
  return (
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
  );
}
