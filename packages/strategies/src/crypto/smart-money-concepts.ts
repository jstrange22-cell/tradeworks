import type { MarketSnapshot, TradingSignal, IndicatorSignal } from '@tradeworks/shared';
import { BaseStrategy, type IndicatorConfig } from '../base-strategy.js';
import {
  detectOrderBlocks,
  detectFairValueGaps,
  detectLiquidityZones,
  rsi,
  atr,
} from '@tradeworks/indicators';
import type { OrderBlock, FairValueGap, LiquidityZone } from '@tradeworks/indicators';

/**
 * Smart Money Concepts (SMC) Strategy.
 *
 * Combines institutional order flow concepts:
 * - Order Blocks: zones where institutional buying/selling occurred
 * - Fair Value Gaps: imbalance zones price tends to fill
 * - Liquidity Zones: areas with concentrated stop orders
 *
 * Entry (Long):
 * - Price enters a bullish order block or bullish FVG zone
 * - Liquidity sweep below a buy-side zone (stop hunt reversal)
 * - RSI confirmation (not overbought)
 *
 * Entry (Short):
 * - Price enters a bearish order block or bearish FVG zone
 * - Liquidity sweep above a sell-side zone
 * - RSI confirmation (not oversold)
 *
 * Exit:
 * - Stop below/above the order block zone
 * - Target at next opposing liquidity zone or 2.5x ATR
 */
export class SmartMoneyConceptsStrategy extends BaseStrategy {
  readonly name = 'Smart Money Concepts';
  readonly market = 'crypto' as const;
  readonly strategyType = 'smart_money_concepts';

  getDefaultParams() {
    return {
      rsiPeriod: 14,
      rsiOverbought: 70,
      rsiOversold: 30,
      atrPeriod: 14,
      takeProfitAtrMultiplier: 2.5,
      stopBufferAtr: 0.5,
      liquiditySweepThreshold: 0.002,
      minLiquidityStrength: 2,
      timeframe: '1h',
    };
  }

  getRequiredIndicators(): IndicatorConfig[] {
    return [
      { name: 'detectOrderBlocks', params: {} },
      { name: 'detectFairValueGaps', params: {} },
      { name: 'detectLiquidityZones', params: {} },
      { name: 'rsi', params: { period: this.params.rsiPeriod as number } },
      { name: 'atr', params: { period: this.params.atrPeriod as number } },
    ];
  }

  async analyze(snapshot: MarketSnapshot): Promise<TradingSignal[]> {
    const tf = this.params.timeframe as string;
    const candles = this.getCandles(snapshot, tf);

    if (candles.length < 50) {
      return [];
    }

    const closes = this.getCloses(candles);
    const orderBlocks = detectOrderBlocks(candles);
    const fvgs = detectFairValueGaps(candles);
    const liquidityZones = detectLiquidityZones(candles);
    const rsiValues = rsi(closes, this.params.rsiPeriod as number);
    const atrValues = atr(candles, this.params.atrPeriod as number);

    const lastIdx = closes.length - 1;
    const price = this.getLatestPrice(snapshot);
    const currentRsi = rsiValues[lastIdx];
    const currentAtr = atrValues[lastIdx];

    if (currentRsi === undefined || currentAtr === undefined) {
      return [];
    }

    const signals: TradingSignal[] = [];
    const sweepThreshold = this.params.liquiditySweepThreshold as number;
    const minStrength = this.params.minLiquidityStrength as number;

    // Check for bullish setups
    const bullishOB = this.findNearestOrderBlock(orderBlocks, price, 'bullish');
    const bullishFVG = this.findNearestFVG(fvgs, price, 'bullish');
    const buySideSweep = this.detectLiquiditySweep(liquidityZones, candles, price, 'buy', sweepThreshold, minStrength);

    const hasBullishZone = bullishOB !== null || bullishFVG !== null;
    const bullishRsiOk = currentRsi < (this.params.rsiOverbought as number);

    if ((hasBullishZone || buySideSweep) && bullishRsiOk) {
      const indicatorSignals: IndicatorSignal[] = [
        { indicator: 'RSI', value: currentRsi, signal: currentRsi < 50 ? 'buy' : 'neutral', confidence: 0.6 },
        { indicator: 'ATR', value: currentAtr, signal: 'neutral', confidence: 0.5 },
      ];

      let stopLoss: number;
      const reasonParts: string[] = [];

      if (bullishOB !== null) {
        stopLoss = bullishOB.low - currentAtr * (this.params.stopBufferAtr as number);
        indicatorSignals.push({
          indicator: 'OrderBlock_Bullish',
          value: (bullishOB.high + bullishOB.low) / 2,
          signal: 'buy',
          confidence: 0.8,
        });
        reasonParts.push(`bullish order block zone ($${bullishOB.low.toFixed(2)}-$${bullishOB.high.toFixed(2)})`);
      } else {
        stopLoss = price - currentAtr * 1.5;
      }

      if (bullishFVG !== null) {
        indicatorSignals.push({
          indicator: 'FVG_Bullish',
          value: (bullishFVG.high + bullishFVG.low) / 2,
          signal: 'buy',
          confidence: 0.75,
        });
        reasonParts.push(`bullish FVG ($${bullishFVG.low.toFixed(2)}-$${bullishFVG.high.toFixed(2)})`);
      }

      if (buySideSweep) {
        indicatorSignals.push({
          indicator: 'Liquidity_Sweep',
          value: price,
          signal: 'buy',
          confidence: 0.7,
        });
        reasonParts.push('buy-side liquidity sweep detected');
      }

      const takeProfit = price + currentAtr * (this.params.takeProfitAtrMultiplier as number);
      const confidence = this.calculateSmcConfidence(bullishOB !== null, bullishFVG !== null, buySideSweep, currentRsi, 'buy');

      signals.push({
        instrument: snapshot.instrument,
        market: this.market,
        action: 'buy',
        confidence,
        entryPrice: price,
        stopLoss,
        takeProfit,
        indicators: indicatorSignals,
        reasoning: `SMC bullish confluence: ${reasonParts.join(', ')}. RSI at ${currentRsi.toFixed(1)}. Stop $${stopLoss.toFixed(2)}, target $${takeProfit.toFixed(2)}.`,
        strategyId: '',
        timestamp: Date.now(),
      });
    }

    // Check for bearish setups
    const bearishOB = this.findNearestOrderBlock(orderBlocks, price, 'bearish');
    const bearishFVG = this.findNearestFVG(fvgs, price, 'bearish');
    const sellSideSweep = this.detectLiquiditySweep(liquidityZones, candles, price, 'sell', sweepThreshold, minStrength);

    const hasBearishZone = bearishOB !== null || bearishFVG !== null;
    const bearishRsiOk = currentRsi > (this.params.rsiOversold as number);

    if ((hasBearishZone || sellSideSweep) && bearishRsiOk) {
      const indicatorSignals: IndicatorSignal[] = [
        { indicator: 'RSI', value: currentRsi, signal: currentRsi > 50 ? 'sell' : 'neutral', confidence: 0.6 },
        { indicator: 'ATR', value: currentAtr, signal: 'neutral', confidence: 0.5 },
      ];

      let stopLoss: number;
      const reasonParts: string[] = [];

      if (bearishOB !== null) {
        stopLoss = bearishOB.high + currentAtr * (this.params.stopBufferAtr as number);
        indicatorSignals.push({
          indicator: 'OrderBlock_Bearish',
          value: (bearishOB.high + bearishOB.low) / 2,
          signal: 'sell',
          confidence: 0.8,
        });
        reasonParts.push(`bearish order block zone ($${bearishOB.low.toFixed(2)}-$${bearishOB.high.toFixed(2)})`);
      } else {
        stopLoss = price + currentAtr * 1.5;
      }

      if (bearishFVG !== null) {
        indicatorSignals.push({
          indicator: 'FVG_Bearish',
          value: (bearishFVG.high + bearishFVG.low) / 2,
          signal: 'sell',
          confidence: 0.75,
        });
        reasonParts.push(`bearish FVG ($${bearishFVG.low.toFixed(2)}-$${bearishFVG.high.toFixed(2)})`);
      }

      if (sellSideSweep) {
        indicatorSignals.push({
          indicator: 'Liquidity_Sweep',
          value: price,
          signal: 'sell',
          confidence: 0.7,
        });
        reasonParts.push('sell-side liquidity sweep detected');
      }

      const takeProfit = price - currentAtr * (this.params.takeProfitAtrMultiplier as number);
      const confidence = this.calculateSmcConfidence(bearishOB !== null, bearishFVG !== null, sellSideSweep, currentRsi, 'sell');

      signals.push({
        instrument: snapshot.instrument,
        market: this.market,
        action: 'sell',
        confidence,
        entryPrice: price,
        stopLoss,
        takeProfit,
        indicators: indicatorSignals,
        reasoning: `SMC bearish confluence: ${reasonParts.join(', ')}. RSI at ${currentRsi.toFixed(1)}. Stop $${stopLoss.toFixed(2)}, target $${takeProfit.toFixed(2)}.`,
        strategyId: '',
        timestamp: Date.now(),
      });
    }

    return signals;
  }

  /**
   * Find the nearest order block that the current price is within or near.
   */
  private findNearestOrderBlock(
    blocks: OrderBlock[],
    price: number,
    type: 'bullish' | 'bearish',
  ): OrderBlock | null {
    const matching = blocks.filter(block => block.type === type);
    let nearest: OrderBlock | null = null;
    let minDistance = Infinity;

    for (const block of matching) {
      // Price is inside the block zone
      if (price >= block.low && price <= block.high) {
        return block;
      }
      // Price is near the block (within 0.5% of the zone edge)
      const distToLow = Math.abs(price - block.low) / price;
      const distToHigh = Math.abs(price - block.high) / price;
      const dist = Math.min(distToLow, distToHigh);

      if (dist < 0.005 && dist < minDistance) {
        nearest = block;
        minDistance = dist;
      }
    }

    return nearest;
  }

  /**
   * Find the nearest FVG zone that the current price is within.
   */
  private findNearestFVG(
    gaps: FairValueGap[],
    price: number,
    type: 'bullish' | 'bearish',
  ): FairValueGap | null {
    const matching = gaps.filter(gap => gap.type === type);

    for (const gap of matching) {
      if (price >= gap.low && price <= gap.high) {
        return gap;
      }
      // Near the gap zone (within 0.3%)
      const distToLow = Math.abs(price - gap.low) / price;
      const distToHigh = Math.abs(price - gap.high) / price;
      if (Math.min(distToLow, distToHigh) < 0.003) {
        return gap;
      }
    }

    return null;
  }

  /**
   * Detect liquidity sweep: price pierces through a liquidity zone
   * then reverses (wick through the level).
   */
  private detectLiquiditySweep(
    zones: LiquidityZone[],
    candles: { high: number; low: number; close: number; open: number }[],
    price: number,
    zoneType: 'buy' | 'sell',
    threshold: number,
    minStrength: number,
  ): boolean {
    const relevantZones = zones.filter(
      zone => zone.side === zoneType && zone.touches >= minStrength,
    );

    if (relevantZones.length === 0 || candles.length < 3) return false;

    const lastCandle = candles[candles.length - 1]!;
    const prevCandle = candles[candles.length - 2]!;

    for (const zone of relevantZones) {
      const level = zone.price;
      const thresholdPrice = level * threshold;

      if (zoneType === 'buy') {
        // Buy-side sweep: price dipped below liquidity zone then closed above
        const pierced = lastCandle.low < level - thresholdPrice || prevCandle.low < level - thresholdPrice;
        const reversed = price > level;
        if (pierced && reversed) return true;
      } else {
        // Sell-side sweep: price spiked above liquidity zone then closed below
        const pierced = lastCandle.high > level + thresholdPrice || prevCandle.high > level + thresholdPrice;
        const reversed = price < level;
        if (pierced && reversed) return true;
      }
    }

    return false;
  }

  private calculateSmcConfidence(
    hasOrderBlock: boolean,
    hasFVG: boolean,
    hasSweep: boolean,
    currentRsi: number,
    side: 'buy' | 'sell',
  ): number {
    let confidence = 0.25;

    // Confluence scoring
    if (hasOrderBlock) confidence += 0.2;
    if (hasFVG) confidence += 0.15;
    if (hasSweep) confidence += 0.2;

    // RSI alignment bonus
    const rsiAligned = side === 'buy' ? currentRsi < 50 : currentRsi > 50;
    if (rsiAligned) confidence += 0.1;

    return Math.min(confidence, 0.9);
  }
}
