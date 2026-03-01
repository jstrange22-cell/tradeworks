import { useState } from 'react';
import { Globe, TrendingUp, TrendingDown } from 'lucide-react';
import {
  LineChart,
  Line,
  ResponsiveContainer,
} from 'recharts';

type TabType = 'crypto' | 'prediction' | 'equity';

interface MarketInstrument {
  instrument: string;
  market: TabType;
  price: number;
  change24h: number;
  changePercent24h: number;
  volume24h: number;
  high24h: number;
  low24h: number;
  sparkline: number[];
}

function generateSparkline(base: number, points: number = 24): number[] {
  let current = base;
  return Array.from({ length: points }, () => {
    current += (Math.random() - 0.48) * (base * 0.005);
    return parseFloat(current.toFixed(2));
  });
}

const mockInstruments: MarketInstrument[] = [
  // Crypto
  { instrument: 'BTC-USD', market: 'crypto', price: 96480, change24h: 1230, changePercent24h: 1.29, volume24h: 28_500_000_000, high24h: 97100, low24h: 94850, sparkline: generateSparkline(96480) },
  { instrument: 'ETH-USD', market: 'crypto', price: 3385, change24h: -45, changePercent24h: -1.31, volume24h: 14_200_000_000, high24h: 3450, low24h: 3350, sparkline: generateSparkline(3385) },
  { instrument: 'SOL-USD', market: 'crypto', price: 185.2, change24h: 4.8, changePercent24h: 2.66, volume24h: 3_800_000_000, high24h: 188, low24h: 179, sparkline: generateSparkline(185.2) },
  { instrument: 'AVAX-USD', market: 'crypto', price: 42.8, change24h: -0.6, changePercent24h: -1.38, volume24h: 890_000_000, high24h: 44.1, low24h: 41.9, sparkline: generateSparkline(42.8) },
  { instrument: 'LINK-USD', market: 'crypto', price: 18.45, change24h: 0.32, changePercent24h: 1.77, volume24h: 520_000_000, high24h: 18.8, low24h: 17.9, sparkline: generateSparkline(18.45) },
  { instrument: 'UNI-USD', market: 'crypto', price: 12.85, change24h: -0.15, changePercent24h: -1.15, volume24h: 310_000_000, high24h: 13.2, low24h: 12.6, sparkline: generateSparkline(12.85) },
  { instrument: 'AAVE-USD', market: 'crypto', price: 285.4, change24h: 8.2, changePercent24h: 2.96, volume24h: 420_000_000, high24h: 290, low24h: 275, sparkline: generateSparkline(285.4) },
  // Equity
  { instrument: 'AAPL', market: 'equity', price: 242.3, change24h: 1.5, changePercent24h: 0.62, volume24h: 58_000_000, high24h: 243.8, low24h: 240.1, sparkline: generateSparkline(242.3) },
  { instrument: 'MSFT', market: 'equity', price: 420.1, change24h: -2.3, changePercent24h: -0.54, volume24h: 22_000_000, high24h: 423, low24h: 418, sparkline: generateSparkline(420.1) },
  { instrument: 'NVDA', market: 'equity', price: 875.4, change24h: 12.6, changePercent24h: 1.46, volume24h: 42_000_000, high24h: 882, low24h: 860, sparkline: generateSparkline(875.4) },
  { instrument: 'SPY', market: 'equity', price: 602.3, change24h: 3.2, changePercent24h: 0.53, volume24h: 78_000_000, high24h: 604, low24h: 598, sparkline: generateSparkline(602.3) },
  { instrument: 'QQQ', market: 'equity', price: 510.2, change24h: 4.5, changePercent24h: 0.89, volume24h: 45_000_000, high24h: 512, low24h: 505, sparkline: generateSparkline(510.2) },
  // Prediction
  { instrument: 'POLY-ELECTION', market: 'prediction', price: 0.62, change24h: 0.03, changePercent24h: 5.08, volume24h: 2_400_000, high24h: 0.65, low24h: 0.58, sparkline: generateSparkline(0.62) },
  { instrument: 'POLY-FED-RATE', market: 'prediction', price: 0.45, change24h: -0.02, changePercent24h: -4.26, volume24h: 1_800_000, high24h: 0.48, low24h: 0.43, sparkline: generateSparkline(0.45) },
  { instrument: 'POLY-BTC-100K', market: 'prediction', price: 0.78, change24h: 0.04, changePercent24h: 5.41, volume24h: 3_200_000, high24h: 0.80, low24h: 0.73, sparkline: generateSparkline(0.78) },
];

function formatVolume(v: number): string {
  if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  return `$${(v / 1000).toFixed(0)}K`;
}

export function MarketsPage() {
  const [tab, setTab] = useState<TabType>('crypto');
  const tabs: TabType[] = ['crypto', 'prediction', 'equity'];

  const filtered = mockInstruments.filter((i) => i.market === tab);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Globe className="h-6 w-6 text-blue-400" />
        <h1 className="text-2xl font-bold text-slate-100">Market Overview</h1>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg bg-slate-800/50 p-1">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              tab === t
                ? 'bg-blue-600 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* Market Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {filtered.map((inst) => {
          const isPositive = inst.change24h >= 0;
          const sparkData = inst.sparkline.map((v, i) => ({ x: i, y: v }));

          return (
            <div
              key={inst.instrument}
              className="card transition-all hover:border-slate-600/50"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-slate-200">
                    {inst.instrument}
                  </h3>
                  <div className="mt-1 text-xl font-bold text-slate-100">
                    {inst.market === 'prediction'
                      ? `$${inst.price.toFixed(2)}`
                      : inst.price >= 1000
                        ? `$${inst.price.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
                        : `$${inst.price.toFixed(2)}`}
                  </div>
                </div>
                <div
                  className={`flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-medium ${
                    isPositive
                      ? 'bg-green-500/10 text-green-400'
                      : 'bg-red-500/10 text-red-400'
                  }`}
                >
                  {isPositive ? (
                    <TrendingUp className="h-3 w-3" />
                  ) : (
                    <TrendingDown className="h-3 w-3" />
                  )}
                  {isPositive ? '+' : ''}
                  {inst.changePercent24h.toFixed(2)}%
                </div>
              </div>

              {/* Mini sparkline */}
              <div className="my-3 h-12">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={sparkData}>
                    <Line
                      type="monotone"
                      dataKey="y"
                      stroke={isPositive ? '#22c55e' : '#ef4444'}
                      strokeWidth={1.5}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Details */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-slate-500">24h Vol</span>
                  <div className="font-medium text-slate-300">
                    {formatVolume(inst.volume24h)}
                  </div>
                </div>
                <div>
                  <span className="text-slate-500">24h Change</span>
                  <div
                    className={`font-medium ${
                      isPositive ? 'text-green-400' : 'text-red-400'
                    }`}
                  >
                    {isPositive ? '+' : ''}
                    {inst.market === 'prediction'
                      ? `$${inst.change24h.toFixed(2)}`
                      : `$${inst.change24h.toLocaleString('en-US', {
                          minimumFractionDigits: 2,
                        })}`}
                  </div>
                </div>
                <div>
                  <span className="text-slate-500">24h High</span>
                  <div className="font-medium text-slate-300">
                    ${inst.high24h.toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                    })}
                  </div>
                </div>
                <div>
                  <span className="text-slate-500">24h Low</span>
                  <div className="font-medium text-slate-300">
                    ${inst.low24h.toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                    })}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
