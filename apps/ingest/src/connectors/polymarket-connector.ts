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

export class PolymarketConnector {
  private ws: WebSocket | null = null;
  private tickHandler: TickHandler | null = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private shouldReconnect = true;

  onTick(handler: TickHandler): void {
    this.tickHandler = handler;
  }

  async connect(): Promise<void> {
    const wsUrl = process.env.POLYMARKET_WS_URL ?? 'wss://ws-subscriptions-clob.polymarket.com/ws/market';
    console.log(`[Polymarket] Connecting to ${wsUrl}...`);

    return new Promise((resolve) => {
      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', () => {
        console.log('[Polymarket] Connected.');
        this.reconnectDelay = 1000;

        // Subscribe to all traded markets
        // Polymarket uses asset_id for specific tokens
        const markets = (process.env.POLYMARKET_MARKETS ?? '').split(',').filter(Boolean);
        if (markets.length > 0) {
          for (const market of markets) {
            this.ws!.send(JSON.stringify({
              type: 'market',
              assets_ids: [market],
            }));
          }
        }

        resolve();
      });

      this.ws.on('message', (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.event_type === 'trade') {
            this.handleTrade(msg);
          }
        } catch {
          // Ignore parse errors
        }
      });

      this.ws.on('close', () => {
        console.log('[Polymarket] Disconnected.');
        this.scheduleReconnect();
      });

      this.ws.on('error', (err) => {
        console.error('[Polymarket] WebSocket error:', err.message);
      });
    });
  }

  private handleTrade(msg: Record<string, unknown>): void {
    if (!this.tickHandler) return;

    this.tickHandler({
      exchange: 'polymarket',
      instrument: (msg.asset_id ?? msg.market) as string,
      market: 'prediction',
      price: Number(msg.price),
      quantity: Number(msg.size ?? msg.amount ?? 0),
      side: (msg.side as string) === 'BUY' ? 'buy' : 'sell',
      tradeId: (msg.id ?? crypto.randomUUID()) as string,
      timestamp: new Date((msg.timestamp as string) ?? Date.now()),
    });
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect) return;

    console.log(`[Polymarket] Reconnecting in ${this.reconnectDelay}ms...`);
    setTimeout(() => {
      this.connect().catch((err) => {
        console.error('[Polymarket] Reconnect failed:', err.message);
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
