import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AlpacaEngine } from '../alpaca-engine.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PAPER_URL = 'https://paper-api.alpaca.markets';
const DATA_URL = 'https://data.alpaca.markets';

function createEngine(): AlpacaEngine {
  return new AlpacaEngine({
    apiKey: 'test-api-key',
    apiSecret: 'test-api-secret',
    baseUrl: PAPER_URL,
    dataUrl: DATA_URL,
    paper: true,
  });
}

function mockFetch(response: unknown, status = 200): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(response),
    text: () => Promise.resolve(JSON.stringify(response)),
  }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AlpacaEngine', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // initialize
  // -----------------------------------------------------------------------

  describe('initialize', () => {
    it('should initialize successfully with valid credentials', async () => {
      mockFetch({
        id: 'acc-123',
        status: 'ACTIVE',
        buying_power: '50000.00',
        equity: '100000.00',
      });

      const engine = createEngine();
      await engine.initialize();

      // Should not throw
      expect(fetch).toHaveBeenCalledWith(
        `${PAPER_URL}/v2/account`,
        expect.objectContaining({
          headers: expect.objectContaining({
            'APCA-API-KEY-ID': 'test-api-key',
            'APCA-API-SECRET-KEY': 'test-api-secret',
          }),
        }),
      );
    });

    it('should throw on auth failure', async () => {
      mockFetch({ message: 'Unauthorized' }, 401);

      const engine = createEngine();
      await expect(engine.initialize()).rejects.toThrow('auth failed: 401');
    });
  });

  // -----------------------------------------------------------------------
  // placeOrder
  // -----------------------------------------------------------------------

  describe('placeOrder', () => {
    let engine: AlpacaEngine;

    beforeEach(async () => {
      // First call = initialize, subsequent calls = order placement
      engine = createEngine();

      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: 'acc-123', status: 'ACTIVE', buying_power: '50000', equity: '100000' }),
          text: () => Promise.resolve(''),
        })
        .mockResolvedValue({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            id: 'order-456',
            status: 'filled',
            filled_avg_price: '150.25',
            filled_qty: '10',
            symbol: 'AAPL',
            side: 'buy',
          }),
          text: () => Promise.resolve(''),
        }),
      );

      await engine.initialize();
    });

    it('should place a market order', async () => {
      const result = await engine.placeOrder({
        instrument: 'AAPL',
        side: 'buy',
        quantity: 10,
        type: 'market',
      });

      expect(result.orderId).toBe('order-456');
      expect(result.status).toBe('filled');
      expect(result.side).toBe('buy');
      expect(result.quantity).toBe(10);

      // Verify the POST body
      const postCall = (fetch as ReturnType<typeof vi.fn>).mock.calls[1];
      const body = JSON.parse(postCall[1].body);
      expect(body.symbol).toBe('AAPL');
      expect(body.side).toBe('buy');
      expect(body.type).toBe('market');
      expect(body.time_in_force).toBe('day');
    });

    it('should place a limit order with price', async () => {
      const result = await engine.placeOrder({
        instrument: 'AAPL',
        side: 'buy',
        quantity: 10,
        type: 'limit',
        price: 150.00,
      });

      expect(result.orderId).toBe('order-456');

      const postCall = (fetch as ReturnType<typeof vi.fn>).mock.calls[1];
      const body = JSON.parse(postCall[1].body);
      expect(body.limit_price).toBe('150');
      expect(body.type).toBe('limit');
    });

    it('should place a stop order', async () => {
      await engine.placeOrder({
        instrument: 'AAPL',
        side: 'sell',
        quantity: 10,
        type: 'stop',
        stopPrice: 145.00,
      });

      const postCall = (fetch as ReturnType<typeof vi.fn>).mock.calls[1];
      const body = JSON.parse(postCall[1].body);
      expect(body.stop_price).toBe('145');
      expect(body.type).toBe('stop');
    });

    it('should place a stop_limit order', async () => {
      await engine.placeOrder({
        instrument: 'AAPL',
        side: 'sell',
        quantity: 10,
        type: 'stop_limit',
        price: 144.00,
        stopPrice: 145.00,
      });

      const postCall = (fetch as ReturnType<typeof vi.fn>).mock.calls[1];
      const body = JSON.parse(postCall[1].body);
      expect(body.limit_price).toBe('144');
      expect(body.stop_price).toBe('145');
    });

    it('should return failed status on API error', async () => {
      // Override the mock for this specific test
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 422,
        text: () => Promise.resolve('Insufficient buying power'),
      });

      const result = await engine.placeOrder({
        instrument: 'AAPL',
        side: 'buy',
        quantity: 10,
      });

      expect(result.status).toBe('failed');
      expect(result.error).toContain('422');
    });
  });

  // -----------------------------------------------------------------------
  // cancelOrder
  // -----------------------------------------------------------------------

  describe('cancelOrder', () => {
    let engine: AlpacaEngine;

    beforeEach(async () => {
      engine = createEngine();
      mockFetch({ id: 'acc-123', status: 'ACTIVE', buying_power: '50000', equity: '100000' });
      await engine.initialize();
    });

    it('should cancel an order successfully (204)', async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 204,
      });

      const result = await engine.cancelOrder('order-789');
      expect(result).toBe(true);
    });

    it('should return false on cancel failure', async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 422,
      });

      const result = await engine.cancelOrder('order-789');
      expect(result).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // getPositions
  // -----------------------------------------------------------------------

  describe('getPositions', () => {
    let engine: AlpacaEngine;

    beforeEach(async () => {
      engine = createEngine();
      mockFetch({ id: 'acc-123', status: 'ACTIVE', buying_power: '50000', equity: '100000' });
      await engine.initialize();
    });

    it('should return mapped positions', async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve([
          {
            symbol: 'AAPL',
            side: 'long',
            qty: '10',
            avg_entry_price: '150.00',
            current_price: '155.00',
            unrealized_pl: '50.00',
            market_value: '1550.00',
          },
          {
            symbol: 'TSLA',
            side: 'short',
            qty: '5',
            avg_entry_price: '200.00',
            current_price: '195.00',
            unrealized_pl: '25.00',
            market_value: '975.00',
          },
        ]),
      });

      const positions = await engine.getPositions();

      expect(positions).toHaveLength(2);
      expect(positions[0].instrument).toBe('AAPL');
      expect(positions[0].side).toBe('buy');
      expect(positions[0].quantity).toBe(10);
      expect(positions[0].entryPrice).toBe(150);
      expect(positions[0].currentPrice).toBe(155);
      expect(positions[1].instrument).toBe('TSLA');
      expect(positions[1].side).toBe('sell');
    });

    it('should return empty array when no positions', async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve([]),
      });

      const positions = await engine.getPositions();
      expect(positions).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // getQuote
  // -----------------------------------------------------------------------

  describe('getQuote', () => {
    let engine: AlpacaEngine;

    beforeEach(async () => {
      engine = createEngine();
      mockFetch({ id: 'acc-123', status: 'ACTIVE', buying_power: '50000', equity: '100000' });
      await engine.initialize();
    });

    it('should return formatted quote', async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          quote: {
            bp: 150.00,
            bs: 100,
            ap: 150.10,
            as: 200,
            t: '2024-01-15T10:30:00Z',
          },
        }),
      });

      const quote = await engine.getQuote('AAPL');

      expect(quote.symbol).toBe('AAPL');
      expect(quote.bidPrice).toBe(150);
      expect(quote.askPrice).toBe(150.1);
      expect(quote.lastPrice).toBe(150.05);
      expect(quote.timestamp).toBe('2024-01-15T10:30:00Z');
    });
  });

  // -----------------------------------------------------------------------
  // ensureInitialized
  // -----------------------------------------------------------------------

  describe('ensureInitialized', () => {
    it('should throw if not initialized', async () => {
      const engine = createEngine();
      await expect(engine.placeOrder({
        instrument: 'AAPL',
        side: 'buy',
        quantity: 10,
      })).rejects.toThrow('Not initialized');
    });
  });
});
