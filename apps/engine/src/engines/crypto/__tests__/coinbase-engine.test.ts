import { describe, it, expect, beforeEach } from 'vitest';
import { CoinbaseEngine } from '../coinbase-engine.js';
import type { EngineTradeOrder } from '../coinbase-engine.js';

/**
 * Create a CoinbaseEngine instance in paper trading mode.
 * No real API keys are needed; the engine simulates all operations.
 */
function createPaperEngine(): CoinbaseEngine {
  return new CoinbaseEngine({
    cdpApiKeyName: '',
    cdpApiKeySecret: '',
    networkId: 'base-sepolia',
    paperTrading: true,
  });
}

describe('CoinbaseEngine (Paper Trading)', () => {
  let engine: CoinbaseEngine;

  beforeEach(async () => {
    engine = createPaperEngine();
  });

  // --------------------------------------------------------------------------
  // 1. Should initialize in paper mode
  // --------------------------------------------------------------------------
  it('should initialize in paper mode', async () => {
    await engine.initialize();

    // After initialize, the engine should work without throwing
    const balances = await engine.getBalance();
    expect(balances).toBeDefined();
    expect(Array.isArray(balances)).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 2. Should auto-fallback to paper mode when no API keys
  // --------------------------------------------------------------------------
  it('should auto-fallback to paper mode when no API keys are provided', async () => {
    const engineNoKeys = new CoinbaseEngine({
      cdpApiKeyName: '',
      cdpApiKeySecret: '',
      networkId: 'base-sepolia',
      paperTrading: false, // explicitly set to false, but should fallback
    });

    // Should not throw even though paperTrading was false
    await engineNoKeys.initialize();

    // Should behave as paper mode (return simulated balances)
    const balances = await engineNoKeys.getBalance();
    expect(balances).toBeDefined();
    expect(balances.length).toBeGreaterThan(0);

    // Paper mode returns a known USD balance
    const usd = balances.find((b) => b.asset === 'USD');
    expect(usd).toBeDefined();
    expect(usd!.usdValue).toBe(10000);
  });

  // --------------------------------------------------------------------------
  // 3. Should simulate trade execution with realistic price
  // --------------------------------------------------------------------------
  it('should simulate trade execution with realistic price', async () => {
    await engine.initialize();

    // Provide an explicit price so the simulation has a non-zero base price.
    // In paper mode without real API connectivity, getPrice() returns 0 because
    // the Coinbase API call fails silently. Providing price avoids this.
    const order: EngineTradeOrder = {
      instrument: 'BTC_USDT',
      side: 'buy',
      quantity: 0.1,
      price: 95000,
    };

    const result = await engine.executeTrade(order);

    expect(result).toBeDefined();
    expect(result.instrument).toBe('BTC_USDT');
    expect(result.side).toBe('buy');
    expect(result.quantity).toBe(0.1);
    // Fill price should be close to the provided price (with slippage)
    expect(result.price).toBeGreaterThan(0);
    expect(result.price).toBeGreaterThanOrEqual(95000); // buy side: price + slippage
    expect(result.timestamp).toBeInstanceOf(Date);
  });

  // --------------------------------------------------------------------------
  // 4. Should return filled status for paper trades
  // --------------------------------------------------------------------------
  it('should return filled status for paper trades', async () => {
    await engine.initialize();

    const order: EngineTradeOrder = {
      instrument: 'ETH_USDT',
      side: 'sell',
      quantity: 1.0,
      price: 3500,
    };

    const result = await engine.executeTrade(order);

    expect(result.status).toBe('filled');
    expect(result.orderId).toBeTruthy();
    expect(result.orderId).toMatch(/^paper-/);
  });

  // --------------------------------------------------------------------------
  // 5. Should include fees and slippage in paper trades
  // --------------------------------------------------------------------------
  it('should include fees and slippage in paper trades', async () => {
    await engine.initialize();

    const order: EngineTradeOrder = {
      instrument: 'BTC_USDT',
      side: 'buy',
      quantity: 0.5,
      price: 95000,
    };

    const result = await engine.executeTrade(order);

    // Paper mode should calculate fees and slippage
    expect(result.fees).toBeDefined();
    expect(typeof result.fees).toBe('number');
    expect(result.fees!).toBeGreaterThan(0);

    expect(result.slippage).toBeDefined();
    expect(typeof result.slippage).toBe('number');
    expect(result.slippage!).toBeGreaterThan(0);
    // Slippage should be between 1-5 bps (0.0001 to 0.0005)
    expect(result.slippage!).toBeGreaterThanOrEqual(0.0001);
    expect(result.slippage!).toBeLessThanOrEqual(0.0005);
  });

  // --------------------------------------------------------------------------
  // 6. Should return balances in paper mode
  // --------------------------------------------------------------------------
  it('should return balances in paper mode', async () => {
    await engine.initialize();

    const balances = await engine.getBalance();

    expect(balances).toHaveLength(3);

    // Check for USD balance
    const usd = balances.find((b) => b.asset === 'USD');
    expect(usd).toBeDefined();
    expect(usd!.amount).toBe('10000.00');
    expect(usd!.usdValue).toBe(10000);

    // Check for BTC balance
    const btc = balances.find((b) => b.asset === 'BTC');
    expect(btc).toBeDefined();
    expect(btc!.amount).toBe('0.00');
    expect(btc!.usdValue).toBe(0);

    // Check for ETH balance
    const eth = balances.find((b) => b.asset === 'ETH');
    expect(eth).toBeDefined();
    expect(eth!.amount).toBe('0.00');
    expect(eth!.usdValue).toBe(0);
  });

  // --------------------------------------------------------------------------
  // 7. Should return empty positions in paper mode
  // --------------------------------------------------------------------------
  it('should return empty positions in paper mode', async () => {
    await engine.initialize();

    const positions = await engine.getPositions();

    expect(positions).toBeDefined();
    expect(Array.isArray(positions)).toBe(true);
    expect(positions).toHaveLength(0);
  });

  // --------------------------------------------------------------------------
  // 8. Should simulate order cancellation in paper mode
  // --------------------------------------------------------------------------
  it('should simulate order cancellation in paper mode', async () => {
    await engine.initialize();

    const cancelled = await engine.cancelOrder('paper-1234567890-abcdef01');

    expect(cancelled).toBe(true);
  });

  // --------------------------------------------------------------------------
  // Additional: should throw if not initialized
  // --------------------------------------------------------------------------
  it('should throw if executeTrade is called before initialize', async () => {
    const uninitEngine = createPaperEngine();

    const order: EngineTradeOrder = {
      instrument: 'BTC_USDT',
      side: 'buy',
      quantity: 0.1,
    };

    await expect(uninitEngine.executeTrade(order)).rejects.toThrow(
      'Not initialized',
    );
  });

  it('should throw if getBalance is called before initialize', async () => {
    const uninitEngine = createPaperEngine();

    await expect(uninitEngine.getBalance()).rejects.toThrow('Not initialized');
  });

  it('should throw if getPositions is called before initialize', async () => {
    const uninitEngine = createPaperEngine();

    await expect(uninitEngine.getPositions()).rejects.toThrow(
      'Not initialized',
    );
  });

  // --------------------------------------------------------------------------
  // Additional: sell-side paper trade should have price adjustment in correct direction
  // --------------------------------------------------------------------------
  it('should adjust price in correct direction for sell orders', async () => {
    await engine.initialize();

    const order: EngineTradeOrder = {
      instrument: 'BTC_USDT',
      side: 'sell',
      quantity: 0.1,
      price: 90000,
    };

    const result = await engine.executeTrade(order);

    // For a sell, slippage means we get a slightly lower fill price
    // The engine adds slippage for buy and subtracts for sell
    expect(result.price).toBeLessThanOrEqual(90000);
    expect(result.price).toBeGreaterThan(0);
    expect(result.status).toBe('filled');
  });

  // --------------------------------------------------------------------------
  // Additional: market order should use higher taker fee rate
  // --------------------------------------------------------------------------
  it('should use taker fee rate for market orders', async () => {
    await engine.initialize();

    const marketOrder: EngineTradeOrder = {
      instrument: 'ETH_USDT',
      side: 'buy',
      quantity: 1.0,
      type: 'market',
      price: 3500,
    };

    const limitOrder: EngineTradeOrder = {
      instrument: 'ETH_USDT',
      side: 'buy',
      quantity: 1.0,
      type: 'limit',
      price: 3500,
    };

    const marketResult = await engine.executeTrade(marketOrder);
    const limitResult = await engine.executeTrade(limitOrder);

    // Market fee rate (0.2%) should be higher than limit fee rate (0.1%)
    // Since the fill prices are similar, fees should reflect the rate difference
    // Market fees should be approximately 2x the limit fees
    expect(marketResult.fees!).toBeGreaterThan(0);
    expect(limitResult.fees!).toBeGreaterThan(0);

    // Market fee rate = 0.002, Limit fee rate = 0.001
    // Ratio should be approximately 2 (allowing for slight price differences from slippage)
    const feeRatio = marketResult.fees! / limitResult.fees!;
    expect(feeRatio).toBeGreaterThan(1.5);
    expect(feeRatio).toBeLessThan(2.5);
  });
});
