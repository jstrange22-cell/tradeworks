import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { PortfolioPosition } from '@/stores/portfolio-store';

const PIE_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6'];

interface AssetAllocationChartProps {
  openPositions: PortfolioPosition[];
  equity: number;
}

function computeAllocationData(openPositions: PortfolioPosition[]) {
  const byMarket: Record<string, number> = {};
  openPositions.forEach((pos) => {
    const value = Math.abs(pos.quantity * pos.currentPrice);
    byMarket[pos.market] = (byMarket[pos.market] || 0) + value;
  });
  return Object.entries(byMarket).map(([name, value]) => ({
    name: name.charAt(0).toUpperCase() + name.slice(1),
    value: Math.round(value),
  }));
}

function computePortfolioHeat(openPositions: PortfolioPosition[], equity: number): number {
  if (equity <= 0) return 0;
  return openPositions.reduce((sum, p) => sum + Math.abs(p.unrealizedPnl), 0) / equity;
}

export function AssetAllocationChart({ openPositions, equity }: AssetAllocationChartProps) {
  const allocationData = computeAllocationData(openPositions);
  const portfolioHeat = computePortfolioHeat(openPositions, equity);

  return (
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
  );
}
