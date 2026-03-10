import type { OrderBook, Tick } from '@tradeworks/shared';

export interface OrderFlowAnalysis {
  bidAskRatio: number;
  buyVolume: number;
  sellVolume: number;
  largeOrderCount: number;
  flowDirection: 'bullish' | 'bearish' | 'neutral';
  flowScore: number; // -1 to 1
  whaleActivity: boolean;
  reasoning: string;
}

const WHALE_THRESHOLD_MULTIPLIER = 5;
const NEUTRAL_THRESHOLD = 0.15;

/**
 * Calculate aggregate volume for one side of the order book.
 */
function sumBookVolume(levels: ReadonlyArray<{ price: number; quantity: number }>): number {
  return levels.reduce((sum, level) => sum + level.price * level.quantity, 0);
}

/**
 * Detect large (whale) orders from recent trades.
 * A trade is considered a whale order if its notional value exceeds
 * WHALE_THRESHOLD_MULTIPLIER times the average notional.
 */
function detectWhaleOrders(trades: readonly Tick[]): {
  count: number;
  detected: boolean;
} {
  if (trades.length === 0) {
    return { count: 0, detected: false };
  }

  const notionalValues = trades.map((trade) => trade.price * trade.quantity);
  const avgNotional =
    notionalValues.reduce((sum, val) => sum + val, 0) / notionalValues.length;
  const threshold = avgNotional * WHALE_THRESHOLD_MULTIPLIER;

  const whaleOrders = notionalValues.filter((val) => val >= threshold);
  return { count: whaleOrders.length, detected: whaleOrders.length > 0 };
}

/**
 * Calculate buy and sell volume from recent trades.
 */
function calculateVolumeSplit(trades: readonly Tick[]): {
  buyVolume: number;
  sellVolume: number;
} {
  let buyVolume = 0;
  let sellVolume = 0;

  for (const trade of trades) {
    const notional = trade.price * trade.quantity;
    if (trade.side === 'buy') {
      buyVolume += notional;
    } else if (trade.side === 'sell') {
      sellVolume += notional;
    } else {
      // Unknown side: split evenly
      buyVolume += notional / 2;
      sellVolume += notional / 2;
    }
  }

  return { buyVolume, sellVolume };
}

/**
 * Derive a flow score from -1 (pure sell pressure) to 1 (pure buy pressure)
 * using both order book imbalance and trade flow.
 */
function calculateFlowScore(
  bidAskRatio: number,
  buyVolume: number,
  sellVolume: number
): number {
  // Order book imbalance component: normalized around 1.0
  const bookImbalance = Math.max(-1, Math.min(1, (bidAskRatio - 1) / bidAskRatio));

  // Trade flow component: net buy as fraction of total
  const totalVolume = buyVolume + sellVolume;
  const tradeImbalance =
    totalVolume > 0 ? (buyVolume - sellVolume) / totalVolume : 0;

  // Weighted average: 40% book, 60% trades (trades are more actionable)
  const rawScore = bookImbalance * 0.4 + tradeImbalance * 0.6;
  return Math.max(-1, Math.min(1, rawScore));
}

/**
 * Determine flow direction from the flow score.
 */
function classifyDirection(flowScore: number): 'bullish' | 'bearish' | 'neutral' {
  if (flowScore > NEUTRAL_THRESHOLD) return 'bullish';
  if (flowScore < -NEUTRAL_THRESHOLD) return 'bearish';
  return 'neutral';
}

/**
 * Build a human-readable reasoning string summarizing the analysis.
 */
function buildReasoning(
  bidAskRatio: number,
  buyVolume: number,
  sellVolume: number,
  whaleCount: number,
  flowDirection: 'bullish' | 'bearish' | 'neutral',
  flowScore: number
): string {
  const parts: string[] = [];

  parts.push(
    `Bid/ask ratio: ${bidAskRatio.toFixed(2)} (${bidAskRatio > 1 ? 'bids dominate' : 'asks dominate'})`
  );

  const totalVol = buyVolume + sellVolume;
  if (totalVol > 0) {
    const buyPct = ((buyVolume / totalVol) * 100).toFixed(1);
    parts.push(`Buy volume: ${buyPct}% of total`);
  }

  if (whaleCount > 0) {
    parts.push(`${whaleCount} whale-sized order${whaleCount > 1 ? 's' : ''} detected`);
  }

  parts.push(
    `Flow direction: ${flowDirection} (score: ${flowScore.toFixed(3)})`
  );

  return parts.join('. ') + '.';
}

/**
 * Analyze order book imbalances and trade flow direction.
 *
 * Calculates bid/ask ratio, detects whale activity, determines whether
 * buying or selling pressure dominates, and produces a flow score
 * ranging from -1 (strong sell pressure) to 1 (strong buy pressure).
 */
export function analyzeOrderFlow(
  orderBook: OrderBook,
  recentTrades: Tick[]
): OrderFlowAnalysis {
  const bidVolume = sumBookVolume(orderBook.bids);
  const askVolume = sumBookVolume(orderBook.asks);
  const bidAskRatio = askVolume > 0 ? bidVolume / askVolume : bidVolume > 0 ? Infinity : 1;

  const { buyVolume, sellVolume } = calculateVolumeSplit(recentTrades);
  const { count: largeOrderCount, detected: whaleActivity } =
    detectWhaleOrders(recentTrades);

  const flowScore = calculateFlowScore(bidAskRatio, buyVolume, sellVolume);
  const flowDirection = classifyDirection(flowScore);

  const reasoning = buildReasoning(
    bidAskRatio,
    buyVolume,
    sellVolume,
    largeOrderCount,
    flowDirection,
    flowScore
  );

  return {
    bidAskRatio,
    buyVolume,
    sellVolume,
    largeOrderCount,
    flowDirection,
    flowScore,
    whaleActivity,
    reasoning,
  };
}
