import WebSocket from 'ws';

interface NormalizedTick {
  exchange: string;
  instrument: string;
  market: 'crypto' | 'equity' | 'prediction';
  price: number;
  quantity: number;
  side: 'buy' | 'sell';
  tradeId: string;
  timestamp: Date;
}

type TickHandler = (tick: NormalizedTick) => void;

export class CryptoConnector {
  private ws: WebSocket | null = null;
  private tickHandler: TickHandler | null = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private shouldReconnect = true;
  private instruments: string[];

  constructor() {
    this.instruments = (process.env.CRYPTO_INSTRUMENTS ?? 'BTC-USD,ETH-USD,SOL-USD').split(',');
  }

  onTick(handler: TickHandler): void {
    this.tickHandler = handler;
  }

  async connect(): Promise<void> {
    const wsUrl = process.env.COINBASE_WS_URL ?? 'wss://ws-feed.exchange.coinbase.com';
    console.log(`[Crypto] Connecting to ${wsUrl}...`);

    return new Promise((resolve) => {
      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', () => {
        console.log('[Crypto] Connected. Subscribing to', this.instruments.join(', '));
        this.reconnectDelay = 1000;

        // Subscribe to trade matches
        this.ws!.send(JSON.stringify({
          type: 'subscribe',
          product_ids: this.instruments,
          channels: ['matches'],
        }));

        resolve();
      });

      this.ws.on('message', (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'match' || msg.type === 'last_match') {
            this.handleMatch(msg);
          }
        } catch {
          // Ignore parse errors
        }
      });

      this.ws.on('close', () => {
        console.log('[Crypto] Disconnected.');
        this.scheduleReconnect();
      });

      this.ws.on('error', (err) => {
        console.error('[Crypto] WebSocket error:', err.message);
      });
    });
  }

  private handleMatch(msg: Record<string, string>): void {
    if (!this.tickHandler) return;

    this.tickHandler({
      exchange: 'coinbase',
      instrument: msg.product_id,
      market: 'crypto',
      price: parseFloat(msg.price),
      quantity: parseFloat(msg.size),
      side: msg.side === 'buy' ? 'buy' : 'sell',
      tradeId: msg.trade_id ?? String(msg.sequence),
      timestamp: new Date(msg.time),
    });
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect) return;

    console.log(`[Crypto] Reconnecting in ${this.reconnectDelay}ms...`);
    setTimeout(() => {
      this.connect().catch((err) => {
        console.error('[Crypto] Reconnect failed:', err.message);
      });
    }, this.reconnectDelay);

    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
  }

  disconnect(): void {
    this.shouldReconnect = false;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
