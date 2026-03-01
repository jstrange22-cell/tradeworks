import type { OHLCV, MarketSnapshot, Timeframe, MarketType } from '@tradeworks/shared';
import type { BaseStrategy } from '@tradeworks/strategies';
import { calculatePositionSize } from '@tradeworks/risk';
import { SimulatedExecutor, type SimulatedFill } from './executor.js';
import { calculateMetrics, type BacktestMetrics } from './metrics.js';

export interface BacktestConfig {
  strategy: BaseStrategy;
  instrument: string;
  market: MarketType;
  initialCapital: number;
  riskPerTrade: number; // decimal (0.01 = 1%)
  commissionRate: number; // decimal (0.001 = 0.1%)
  slippageBps: number; // basis points of slippage
  timeframe: Timeframe;
}

export interface BacktestResult {
  config: BacktestConfig;
  metrics: BacktestMetrics;
  trades: SimulatedFill[];
  equityCurve: number[];
  drawdownCurve: number[];
}

/**
 * Event-driven backtesting engine.
 * Replays historical candles through a strategy and simulates execution.
 */
export class BacktestEngine {
  private config: BacktestConfig;
  private executor: SimulatedExecutor;
  private equity: number;
  private equityCurve: number[] = [];
  private inPosition: boolean = false;
  private positionSide: 'long' | 'short' | null = null;
  private positionEntry: number = 0;
  private positionSize: number = 0;
  private positionStopLoss: number | null = null;
  private positionTakeProfit: number | null = null;

  constructor(config: BacktestConfig) {
    this.config = config;
    this.equity = config.initialCapital;
    this.executor = new SimulatedExecutor(config.commissionRate, config.slippageBps);
  }

  /**
   * Run backtest on historical data.
   */
  async run(candles: OHLCV[]): Promise<BacktestResult> {
    const { strategy, instrument, market, timeframe, riskPerTrade } = this.config;

    this.equity = this.config.initialCapital;
    this.equityCurve = [this.equity];
    this.inPosition = false;

    // Walk through candles, building up history
    for (let i = 50; i < candles.length; i++) {
      const currentCandle = candles[i]!;
      const historicalCandles = candles.slice(0, i + 1);

      // Check stop loss / take profit on current bar
      if (this.inPosition) {
        const exitResult = this.checkExits(currentCandle);
        if (exitResult) {
          this.equity += exitResult;
          this.inPosition = false;
          this.positionSide = null;
        }
      }

      // Build snapshot for strategy
      const snapshot: MarketSnapshot = {
        instrument,
        market,
        currentPrice: currentCandle.close,
        change24h: currentCandle.close - (candles[Math.max(0, i - 24)]?.close ?? currentCandle.close),
        changePercent24h: 0,
        volume24h: historicalCandles.slice(-24).reduce((s, c) => s + c.volume, 0),
        high24h: Math.max(...historicalCandles.slice(-24).map(c => c.high)),
        low24h: Math.min(...historicalCandles.slice(-24).map(c => c.low)),
        orderBook: null,
        candles: { [timeframe]: historicalCandles } as Record<Timeframe, OHLCV[]>,
        timestamp: currentCandle.timestamp,
      };

      if (snapshot.change24h !== 0 && candles[Math.max(0, i - 24)]?.close) {
        snapshot.changePercent24h = (snapshot.change24h / candles[Math.max(0, i - 24)]!.close) * 100;
      }

      // Get signals from strategy
      const signals = await strategy.analyze(snapshot);

      // Execute first actionable signal
      if (!this.inPosition && signals.length > 0) {
        const signal = signals.find(s => s.action === 'buy' || s.action === 'sell');
        if (signal && signal.entryPrice && signal.stopLoss) {
          const posSize = calculatePositionSize({
            totalCapital: this.equity,
            riskPercentage: riskPerTrade,
            entryPrice: signal.entryPrice,
            stopLossPrice: signal.stopLoss,
          });

          if (posSize.positionSize > 0) {
            const fill = this.executor.simulateFill(
              signal.action as 'buy' | 'sell',
              signal.entryPrice,
              posSize.positionSize,
              currentCandle.timestamp
            );

            this.equity -= fill.commission;
            this.inPosition = true;
            this.positionSide = signal.action === 'buy' ? 'long' : 'short';
            this.positionEntry = fill.fillPrice;
            this.positionSize = fill.fillQuantity;
            this.positionStopLoss = signal.stopLoss;
            this.positionTakeProfit = signal.takeProfit;
          }
        }
      }

      // Close signal
      if (this.inPosition && signals.some(s => s.action === 'close')) {
        const pnl = this.closePosition(currentCandle.close, currentCandle.timestamp);
        this.equity += pnl;
      }

      // Record equity (include unrealized P&L)
      let unrealized = 0;
      if (this.inPosition) {
        const diff = currentCandle.close - this.positionEntry;
        unrealized = this.positionSide === 'long' ? diff * this.positionSize : -diff * this.positionSize;
      }
      this.equityCurve.push(this.equity + unrealized);
    }

    // Close any remaining position at last price
    if (this.inPosition) {
      const lastPrice = candles[candles.length - 1]!.close;
      const pnl = this.closePosition(lastPrice, candles[candles.length - 1]!.timestamp);
      this.equity += pnl;
      this.equityCurve[this.equityCurve.length - 1] = this.equity;
    }

    const metrics = calculateMetrics(
      this.executor.getFills(),
      this.equityCurve,
      this.config.initialCapital
    );

    // Calculate drawdown curve
    let peak = this.equityCurve[0]!;
    const drawdownCurve = this.equityCurve.map(eq => {
      if (eq > peak) peak = eq;
      return peak > 0 ? (peak - eq) / peak : 0;
    });

    return {
      config: this.config,
      metrics,
      trades: this.executor.getFills(),
      equityCurve: this.equityCurve,
      drawdownCurve,
    };
  }

  private checkExits(candle: OHLCV): number | null {
    if (!this.inPosition || this.positionSide === null) return null;

    const isLong = this.positionSide === 'long';

    // Stop loss check
    if (this.positionStopLoss !== null) {
      if ((isLong && candle.low <= this.positionStopLoss) ||
          (!isLong && candle.high >= this.positionStopLoss)) {
        return this.closePosition(this.positionStopLoss, candle.timestamp);
      }
    }

    // Take profit check
    if (this.positionTakeProfit !== null) {
      if ((isLong && candle.high >= this.positionTakeProfit) ||
          (!isLong && candle.low <= this.positionTakeProfit)) {
        return this.closePosition(this.positionTakeProfit, candle.timestamp);
      }
    }

    return null;
  }

  private closePosition(exitPrice: number, timestamp: number): number {
    const fill = this.executor.simulateFill(
      this.positionSide === 'long' ? 'sell' : 'buy',
      exitPrice,
      this.positionSize,
      timestamp
    );

    const diff = fill.fillPrice - this.positionEntry;
    const pnl = this.positionSide === 'long'
      ? diff * this.positionSize
      : -diff * this.positionSize;

    this.inPosition = false;
    this.positionSide = null;
    this.positionEntry = 0;
    this.positionSize = 0;
    this.positionStopLoss = null;
    this.positionTakeProfit = null;

    return pnl - fill.commission;
  }
}
