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

// Clean defaults — no mock data, zeros and empty arrays
export const usePortfolioStore = create<PortfolioState>((set) => ({
  equity: 0,
  initialCapital: 0,
  dailyPnl: 0,
  dailyPnlPercent: 0,
  weeklyPnl: 0,
  totalPnl: 0,
  winRate: 0,
  totalTrades: 0,
  openPositions: [],
  recentTrades: [],
  equityCurve: [],
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
