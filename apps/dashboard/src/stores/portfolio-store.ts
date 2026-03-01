import { create } from 'zustand';

export interface PortfolioPosition {
  id: string;
  instrument: string;
  market: 'crypto' | 'prediction' | 'equity';
  side: 'long' | 'short';
  quantity: number;
  averageEntry: number;
  currentPrice: number;
  unrealizedPnl: number;
  realizedPnl: number;
  strategyId: string | null;
}

export interface RecentTrade {
  id: string;
  instrument: string;
  market: 'crypto' | 'prediction' | 'equity';
  side: 'buy' | 'sell';
  quantity: number;
  price: number;
  pnl: number;
  strategyId: string;
  executedAt: string;
}

export interface EquityCurvePoint {
  date: string;
  equity: number;
}

interface PortfolioState {
  equity: number;
  initialCapital: number;
  dailyPnl: number;
  dailyPnlPercent: number;
  weeklyPnl: number;
  totalPnl: number;
  winRate: number;
  totalTrades: number;
  openPositions: PortfolioPosition[];
  recentTrades: RecentTrade[];
  equityCurve: EquityCurvePoint[];
  paperTrading: boolean;
  circuitBreaker: boolean;

  // Actions
  setEquity: (equity: number) => void;
  setDailyPnl: (pnl: number, percent: number) => void;
  setPositions: (positions: PortfolioPosition[]) => void;
  addTrade: (trade: RecentTrade) => void;
  setRecentTrades: (trades: RecentTrade[]) => void;
  setEquityCurve: (curve: EquityCurvePoint[]) => void;
  setPaperTrading: (paper: boolean) => void;
  setCircuitBreaker: (triggered: boolean) => void;
  updatePosition: (position: PortfolioPosition) => void;
  removePosition: (id: string) => void;
}

// Mock data for initial state
const mockEquityCurve: EquityCurvePoint[] = Array.from({ length: 30 }, (_, i) => {
  const date = new Date();
  date.setDate(date.getDate() - (29 - i));
  const base = 100000;
  const noise = Math.sin(i * 0.3) * 2000 + Math.random() * 1500;
  const trend = i * 150;
  return {
    date: date.toISOString().split('T')[0],
    equity: base + trend + noise,
  };
});

const mockPositions: PortfolioPosition[] = [
  {
    id: '1',
    instrument: 'BTC-USD',
    market: 'crypto',
    side: 'long',
    quantity: 0.5,
    averageEntry: 94250,
    currentPrice: 96480,
    unrealizedPnl: 1115,
    realizedPnl: 0,
    strategyId: 'trend-following-btc',
  },
  {
    id: '2',
    instrument: 'ETH-USD',
    market: 'crypto',
    side: 'long',
    quantity: 5,
    averageEntry: 3420,
    currentPrice: 3385,
    unrealizedPnl: -175,
    realizedPnl: 0,
    strategyId: 'mean-reversion-eth',
  },
  {
    id: '3',
    instrument: 'SPY',
    market: 'equity',
    side: 'long',
    quantity: 20,
    averageEntry: 598.5,
    currentPrice: 602.3,
    unrealizedPnl: 76,
    realizedPnl: 0,
    strategyId: 'momentum-spy',
  },
];

const mockTrades: RecentTrade[] = [
  { id: 't1', instrument: 'BTC-USD', market: 'crypto', side: 'buy', quantity: 0.5, price: 94250, pnl: 0, strategyId: 'trend-following-btc', executedAt: new Date(Date.now() - 3600000).toISOString() },
  { id: 't2', instrument: 'SOL-USD', market: 'crypto', side: 'sell', quantity: 50, price: 185.2, pnl: 342.5, strategyId: 'breakout-sol', executedAt: new Date(Date.now() - 7200000).toISOString() },
  { id: 't3', instrument: 'ETH-USD', market: 'crypto', side: 'buy', quantity: 5, price: 3420, pnl: 0, strategyId: 'mean-reversion-eth', executedAt: new Date(Date.now() - 10800000).toISOString() },
  { id: 't4', instrument: 'NVDA', market: 'equity', side: 'sell', quantity: 10, price: 875.4, pnl: 215.0, strategyId: 'momentum-nvda', executedAt: new Date(Date.now() - 14400000).toISOString() },
  { id: 't5', instrument: 'SPY', market: 'equity', side: 'buy', quantity: 20, price: 598.5, pnl: 0, strategyId: 'momentum-spy', executedAt: new Date(Date.now() - 18000000).toISOString() },
  { id: 't6', instrument: 'AAPL', market: 'equity', side: 'sell', quantity: 15, price: 242.3, pnl: -89.5, strategyId: 'mean-reversion-aapl', executedAt: new Date(Date.now() - 21600000).toISOString() },
  { id: 't7', instrument: 'BTC-USD', market: 'crypto', side: 'sell', quantity: 0.3, price: 95100, pnl: 480.0, strategyId: 'trend-following-btc', executedAt: new Date(Date.now() - 25200000).toISOString() },
  { id: 't8', instrument: 'LINK-USD', market: 'crypto', side: 'buy', quantity: 200, price: 18.45, pnl: 0, strategyId: 'breakout-link', executedAt: new Date(Date.now() - 28800000).toISOString() },
  { id: 't9', instrument: 'QQQ', market: 'equity', side: 'sell', quantity: 8, price: 510.2, pnl: 156.0, strategyId: 'momentum-qqq', executedAt: new Date(Date.now() - 32400000).toISOString() },
  { id: 't10', instrument: 'AVAX-USD', market: 'crypto', side: 'sell', quantity: 100, price: 42.8, pnl: -62.0, strategyId: 'mean-reversion-avax', executedAt: new Date(Date.now() - 36000000).toISOString() },
];

export const usePortfolioStore = create<PortfolioState>((set) => ({
  equity: 104520.75,
  initialCapital: 100000,
  dailyPnl: 1247.32,
  dailyPnlPercent: 1.21,
  weeklyPnl: 3215.80,
  totalPnl: 4520.75,
  winRate: 64.3,
  totalTrades: 187,
  openPositions: mockPositions,
  recentTrades: mockTrades,
  equityCurve: mockEquityCurve,
  paperTrading: true,
  circuitBreaker: false,

  setEquity: (equity) => set({ equity }),
  setDailyPnl: (dailyPnl, dailyPnlPercent) => set({ dailyPnl, dailyPnlPercent }),
  setPositions: (openPositions) => set({ openPositions }),
  addTrade: (trade) =>
    set((state) => ({
      recentTrades: [trade, ...state.recentTrades.slice(0, 49)],
    })),
  setRecentTrades: (recentTrades) => set({ recentTrades }),
  setEquityCurve: (equityCurve) => set({ equityCurve }),
  setPaperTrading: (paperTrading) => set({ paperTrading }),
  setCircuitBreaker: (circuitBreaker) => set({ circuitBreaker }),
  updatePosition: (position) =>
    set((state) => ({
      openPositions: state.openPositions.map((p) =>
        p.id === position.id ? position : p,
      ),
    })),
  removePosition: (id) =>
    set((state) => ({
      openPositions: state.openPositions.filter((p) => p.id !== id),
    })),
}));
