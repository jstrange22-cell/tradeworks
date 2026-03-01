import { describe, it, expect, vi, afterEach } from 'vitest';
import { PolymarketEngine } from '../polymarket-engine.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createPaperEngine(): PolymarketEngine {
  return new PolymarketEngine({
    clobApiUrl: 'https://clob.polymarket.com',
    gammaApiUrl: 'https://gamma-api.polymarket.com',
    apiKey: '',
    apiSecret: '',
    apiPassphrase: '',
    funderAddress: '0x1234',
    paperTrading: true,
  });
}

function createLiveEngine(): PolymarketEngine {
  return new PolymarketEngine({
    clobApiUrl: 'https://clob.polymarket.com',
    gammaApiUrl: 'https://gamma-api.polymarket.com',
    apiKey: 'test-key',
    apiSecret: 'test-secret',
    apiPassphrase: 'test-pass',
    funderAddress: '0x1234',
    paperTrading: false,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PolymarketEngine', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // initialize
  // -----------------------------------------------------------------------

  describe('initialize', () => {
    it('should initialize in paper mode without API calls', async () => {
      const engine = createPaperEngine();
      await engine.initialize();
      // Should not throw — paper mode skips connectivity check
    });

    it('should auto-fallback to paper mode when no API keys', async () => {
      const engine = new PolymarketEngine({
        clobApiUrl: 'https://clob.polymarket.com',
        gammaApiUrl: 'https://gamma-api.polymarket.com',
        apiKey: '',
        apiSecret: '',
        apiPassphrase: '',
        funderAddress: '0x1234',
        paperTrading: false, // Requests live but no keys
      });

      await engine.initialize();
      // Should not throw — falls back to paper mode
    });

    it('should verify CLOB connectivity in live mode', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ timestamp: '1704067200' }),
      }));

      const engine = createLiveEngine();
      await engine.initialize();

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/time'),
      );
    });

    it('should throw on CLOB health check failure in live mode', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
      }));

      const engine = createLiveEngine();
      await expect(engine.initialize()).rejects.toThrow('health check failed');
    });
  });

  // -----------------------------------------------------------------------
  // placeOrder (paper mode)
  // -----------------------------------------------------------------------

  describe('placeOrder (paper mode)', () => {
    it('should simulate a buy order', async () => {
      const engine = createPaperEngine();
      await engine.initialize();

      const result = await engine.placeOrder({
        instrument: 'token-abc',
        side: 'buy',
        quantity: 100,
        price: 0.65,
        outcome: 'Yes',
      });

      expect(result.status).toBe('filled');
      expect(result.orderId).toMatch(/^paper-poly-/);
      expect(result.instrument).toBe('token-abc');
      expect(result.side).toBe('buy');
      expect(result.quantity).toBe(100);
      expect(result.price).toBeGreaterThan(0);
      expect(result.fees).toBeGreaterThan(0);
      expect(result.slippage).toBeGreaterThan(0);
    });

    it('should simulate a sell order with lower price', async () => {
      const engine = createPaperEngine();
      await engine.initialize();

      const result = await engine.placeOrder({
        instrument: 'token-abc',
        side: 'sell',
        quantity: 50,
        price: 0.80,
        outcome: 'Yes',
      });

      expect(result.status).toBe('filled');
      expect(result.price).toBeLessThanOrEqual(0.80);
    });

    it('should default to 0.50 price when no price given', async () => {
      const engine = createPaperEngine();
      await engine.initialize();

      const result = await engine.placeOrder({
        instrument: 'token-xyz',
        side: 'buy',
        quantity: 10,
        outcome: 'No',
      });

      expect(result.status).toBe('filled');
      expect(result.price).toBeGreaterThan(0);
      expect(result.price).toBeLessThan(1);
    });

    it('should clamp price to valid prediction market range', async () => {
      const engine = createPaperEngine();
      await engine.initialize();

      // Price > 1 should be clamped
      const result = await engine.placeOrder({
        instrument: 'token-abc',
        side: 'buy',
        quantity: 10,
        price: 1.50,
        outcome: 'Yes',
      });

      expect(result.price).toBeLessThanOrEqual(1);
    });
  });

  // -----------------------------------------------------------------------
  // cancelOrder
  // -----------------------------------------------------------------------

  describe('cancelOrder', () => {
    it('should return true in paper mode', async () => {
      const engine = createPaperEngine();
      await engine.initialize();

      const result = await engine.cancelOrder('order-123');
      expect(result).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // getPositions
  // -----------------------------------------------------------------------

  describe('getPositions', () => {
    it('should return empty array in paper mode', async () => {
      const engine = createPaperEngine();
      await engine.initialize();

      const positions = await engine.getPositions();
      expect(positions).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // ensureInitialized
  // -----------------------------------------------------------------------

  describe('ensureInitialized', () => {
    it('should throw if not initialized', async () => {
      const engine = createPaperEngine();
      // Do NOT call initialize()
      await expect(engine.placeOrder({
        instrument: 'token-abc',
        side: 'buy',
        quantity: 10,
        price: 0.5,
        outcome: 'Yes',
      })).rejects.toThrow('Not initialized');
    });

    it('should throw for cancelOrder if not initialized', async () => {
      const engine = createPaperEngine();
      await expect(engine.cancelOrder('order-123')).rejects.toThrow('Not initialized');
    });

    it('should throw for getPositions if not initialized', async () => {
      const engine = createPaperEngine();
      await expect(engine.getPositions()).rejects.toThrow('Not initialized');
    });
  });
});
