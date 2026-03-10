export interface TradeData {
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

export interface TradesResponse {
  data: TradeData[];
  total: number;
}
