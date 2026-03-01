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

export class AlpacaConnector {
  private ws: WebSocket | null = null;
  private tickHandler: TickHandler | null = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private shouldReconnect = true;
  private symbols: string[];

  constructor() {
    this.symbols = (process.env.EQUITY_SYMBOLS ?? 'SPY,QQQ,AAPL,MSFT,NVDA').split(',');
  }

  onTick(handler: TickHandler): void {
    this.tickHandler = handler;
  }

  async connect(): Promise<void> {
    const apiKey = process.env.ALPACA_API_KEY;
    const apiSecret = process.env.ALPACA_API_SECRET;

    if (!apiKey || !apiSecret) {
      console.warn('[Alpaca] No API keys configured. Skipping equity data feed.');
      return;
    }

    const wsUrl = process.env.ALPACA_WS_URL ?? 'wss://stream.data.alpaca.markets/v2/iex';
    console.log(`[Alpaca] Connecting to ${wsUrl}...`);

    return new Promise((resolve) => {
      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', () => {
        console.log('[Alpaca] Connected. Authenticating...');
        this.reconnectDelay = 1000;

        // Authenticate
        this.ws!.send(JSON.stringify({
          action: 'auth',
          key: apiKey,
          secret: apiSecret,
        }));
      });

      this.ws.on('message', (data: Buffer) => {
        try {
          const messages = JSON.parse(data.toString());
          if (!Array.isArray(messages)) return;

          for (const msg of messages) {
            if (msg.T === 'success' && msg.msg === 'authenticated') {
              console.log('[Alpaca] Authenticated. Subscribing to', this.symbols.join(', '));
              this.ws!.send(JSON.stringify({
                action: 'subscribe',
                trades: this.symbols,
              }));
              resolve();
            } else if (msg.T === 't') {
              this.handleTrade(msg);
            }
          }
        } catch {
          // Ignore parse errors
        }
      });

      this.ws.on('close', () => {
        console.log('[Alpaca] Disconnected.');
        this.scheduleReconnect();
      });

      this.ws.on('error', (err) => {
        console.error('[Alpaca] WebSocket error:', err.message);
      });
    });
  }

  private handleTrade(msg: Record<string, unknown>): void {
    if (!this.tickHandler) return;

    this.tickHandler({
      exchange: 'alpaca',
      instrument: msg.S as string,
      market: 'equity',
      price: msg.p as number,
      quantity: msg.s as number,
      side: 'buy', // Alpaca trades don't have side info
      tradeId: String(msg.i),
      timestamp: new Date(msg.t as string),
    });
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect) return;

    console.log(`[Alpaca] Reconnecting in ${this.reconnectDelay}ms...`);
    setTimeout(() => {
      this.connect().catch((err) => {
        console.error('[Alpaca] Reconnect failed:', err.message);
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
