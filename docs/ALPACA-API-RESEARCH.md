# Alpaca Trading API Research

> Research compiled for TradeWorks swing trading engine integration

---

## 1. Authentication

### Method: API Key + Secret (Header-based)

Alpaca uses a simple API Key ID + Secret Key pair. Two headers on every request:

```
APCA-API-KEY-ID: {YOUR_API_KEY_ID}
APCA-API-SECRET-KEY: {YOUR_API_SECRET_KEY}
```

Alternative: HTTP Basic Auth with key ID as username, secret as password.

**OAuth 2.0** is also supported for third-party apps but is overkill for a self-hosted bot. The Client Credentials flow (token endpoint at `https://authx.alpaca.markets/v1/oauth2/token`) returns 15-minute bearer tokens, but the docs note this is **not yet available for Trading API** -- so stick with the header-based approach.

**Key Management:**
- Paper and Live accounts have **separate** API keys
- Generate keys from the Alpaca dashboard at https://app.alpaca.markets
- Each account can have multiple key pairs

---

## 2. Base URLs

| Environment | Trading API | Market Data API |
|---|---|---|
| **Paper** | `https://paper-api.alpaca.markets` | `https://data.alpaca.markets` |
| **Live** | `https://api.alpaca.markets` | `https://data.alpaca.markets` |

Market Data API is the same URL for both paper and live. Only Trading API differs.

---

## 3. Key Endpoints

### 3a. Account Info / Buying Power

```
GET /v2/account
```

**Response fields (key ones):**
```typescript
interface AlpacaAccount {
  id: string;
  account_number: string;
  status: 'ACTIVE' | 'ONBOARDING' | string;
  buying_power: string;          // Available to open new positions
  cash: string;                  // Cash balance
  portfolio_value: string;       // Total value of all positions + cash
  equity: string;                // Cash + long market value + short market value
  last_equity: string;           // Equity at previous market close
  long_market_value: string;
  short_market_value: string;
  initial_margin: string;
  maintenance_margin: string;
  daytrade_count: number;        // Number of day trades in last 5 days
  pattern_day_trader: boolean;   // PDT flag
  trading_blocked: boolean;
  transfers_blocked: boolean;
  account_blocked: boolean;
  multiplier: string;            // "1" (cash), "2" (RegT margin), "4" (intraday)
  currency: string;              // "USD"
}
```

**Account Configurations:**
```
GET  /v2/account/configurations
PATCH /v2/account/configurations
```

Fields: `dtbp_check`, `trade_confirm_email`, `suspend_trade`, `no_shorting`, `fractional_trading`, `max_margin_multiplier`, `pdt_check`.

---

### 3b. Placing Orders

```
POST /v2/orders
```

**Request Body:**
```typescript
interface CreateOrderRequest {
  // Required
  symbol: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit' | 'stop' | 'stop_limit' | 'trailing_stop';
  time_in_force: 'day' | 'gtc' | 'opg' | 'cls' | 'ioc' | 'fok';

  // One of qty or notional required
  qty?: string;                  // Share count (supports fractional: "0.5")
  notional?: string;             // Dollar amount ("500" = $500 worth)

  // Conditional
  limit_price?: string;          // Required for limit/stop_limit
  stop_price?: string;           // Required for stop/stop_limit
  trail_price?: string;          // Required for trailing_stop ($ amount)
  trail_percent?: string;        // Required for trailing_stop (% amount)

  // Optional
  client_order_id?: string;      // Your custom ID (max 128 chars)
  order_class?: 'simple' | 'bracket' | 'oco' | 'oto';
  extended_hours?: boolean;      // Pre/post market (limit orders only)

  // Bracket order legs
  take_profit?: {
    limit_price: string;         // Required for bracket
  };
  stop_loss?: {
    stop_price: string;          // Required for bracket
    limit_price?: string;        // Optional (makes it stop-limit vs stop)
  };
}
```

**Bracket Order Example (Buy with SL + TP):**
```json
{
  "symbol": "AAPL",
  "qty": "10",
  "side": "buy",
  "type": "limit",
  "limit_price": "170.00",
  "time_in_force": "gtc",
  "order_class": "bracket",
  "take_profit": {
    "limit_price": "185.00"
  },
  "stop_loss": {
    "stop_price": "165.00",
    "limit_price": "164.50"
  }
}
```

**Order Response:**
```typescript
interface Order {
  id: string;
  client_order_id: string;
  symbol: string;
  asset_id: string;
  asset_class: string;
  qty: string;
  filled_qty: string;
  filled_avg_price: string | null;
  status: 'new' | 'partially_filled' | 'filled' | 'done_for_day'
        | 'canceled' | 'expired' | 'replaced' | 'pending_new'
        | 'accepted' | 'pending_cancel' | 'pending_replace'
        | 'stopped' | 'rejected' | 'suspended' | 'calculated'
        | 'held';
  type: string;
  side: string;
  time_in_force: string;
  limit_price: string | null;
  stop_price: string | null;
  order_class: string;
  created_at: string;
  submitted_at: string;
  filled_at: string | null;
  canceled_at: string | null;
  legs: Order[] | null;          // Child orders for bracket/oco/oto
  trail_price: string | null;
  trail_percent: string | null;
  hwm: string | null;            // High water mark for trailing stops
}
```

**Other Order Endpoints:**
```
GET    /v2/orders                    # List orders (query: status, limit, nested)
GET    /v2/orders/{order_id}         # Get single order
DELETE /v2/orders/{order_id}         # Cancel single order
DELETE /v2/orders                    # Cancel all open orders
PATCH  /v2/orders/{order_id}         # Replace/modify order
```

---

### 3c. Positions

```
GET    /v2/positions                 # All open positions
GET    /v2/positions/{symbol}        # Single position by symbol
DELETE /v2/positions/{symbol}        # Close position (liquidate)
DELETE /v2/positions                 # Close all positions
```

**Position Response:**
```typescript
interface Position {
  asset_id: string;
  symbol: string;
  exchange: string;
  asset_class: string;
  avg_entry_price: string;
  qty: string;
  qty_available: string;
  side: 'long' | 'short';
  market_value: string;
  cost_basis: string;
  unrealized_pl: string;
  unrealized_plpc: string;        // P/L percentage
  unrealized_intraday_pl: string;
  unrealized_intraday_plpc: string;
  current_price: string;
  lastday_price: string;
  change_today: string;
}
```

---

### 3d. Historical Bars / Candles (for TA)

```
GET /v2/stocks/{symbol}/bars        # Single symbol
GET /v2/stocks/bars                 # Multi-symbol
```

**Base URL:** `https://data.alpaca.markets`

**Query Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `timeframe` | string | Yes | `1Min`, `5Min`, `15Min`, `30Min`, `1Hour`, `4Hour`, `1Day`, `1Week`, `1Month` |
| `start` | string | Yes | RFC-3339 or YYYY-MM-DD |
| `end` | string | No | RFC-3339 or YYYY-MM-DD |
| `limit` | number | No | Max 10000, default 1000 |
| `feed` | string | No | `iex` (free) or `sip` (paid) |
| `sort` | string | No | `asc` (default) or `desc` |
| `page_token` | string | No | Pagination cursor |

**Response:**
```typescript
interface BarsResponse {
  bars: Record<string, Bar[]>;  // Multi-symbol: { "AAPL": [...], "MSFT": [...] }
  next_page_token: string | null;
}

interface Bar {
  t: string;   // Timestamp (RFC-3339)
  o: number;   // Open
  h: number;   // High
  l: number;   // Low
  c: number;   // Close
  v: number;   // Volume
  n: number;   // Number of trades
  vw: number;  // Volume-weighted average price
}
```

**Single-symbol endpoint returns:**
```typescript
interface SingleBarsResponse {
  bars: Bar[];
  symbol: string;
  next_page_token: string | null;
}
```

---

### 3e. Real-Time Quotes (Snapshots)

```
GET /v2/stocks/{symbol}/quotes/latest    # Latest quote
GET /v2/stocks/snapshots                 # Multi-symbol snapshots
GET /v2/stocks/{symbol}/snapshot         # Single snapshot
```

**Snapshot Response:**
```typescript
interface Snapshot {
  latestTrade: {
    t: string; p: number; s: number; c: string[]; i: number; x: string; z: string;
  };
  latestQuote: {
    t: string; bp: number; bs: number; ap: number; as: number; bx: string; ax: string;
  };
  minuteBar: Bar;
  dailyBar: Bar;
  prevDailyBar: Bar;
}
```

---

### 3f. Listing Assets

```
GET /v2/assets                       # List all tradeable assets
GET /v2/assets/{symbol_or_id}        # Get single asset
```

**Query Parameters:**
- `status`: `active` | `inactive`
- `asset_class`: `us_equity` | `crypto`
- `exchange`: `AMEX` | `ARCA` | `BATS` | `NYSE` | `NASDAQ` | `NYSEARCA` | `OTC`

**Response:**
```typescript
interface Asset {
  id: string;
  class: string;
  exchange: string;
  symbol: string;
  name: string;
  status: 'active' | 'inactive';
  tradable: boolean;
  marginable: boolean;
  shortable: boolean;
  easy_to_borrow: boolean;
  fractionable: boolean;
  min_order_size: string | null;
  min_trade_increment: string | null;
  price_increment: string | null;
}
```

---

## 4. Free Tier Limitations

| Feature | Free Plan | Algo Trader Basic ($9/mo) | Algo Trader Plus ($99/mo) |
|---|---|---|---|
| Commission | $0 | $0 | $0 |
| Market Data Source | IEX only (~10% of trades) | SIP (all exchanges) | SIP (all exchanges) |
| REST API Rate Limit | 200 calls/min | 200 calls/min | 10,000 calls/min (data), 200/min (trade) |
| Historical Data | 15-min delayed for SIP feed | Real-time | Real-time |
| WebSocket Connections | 1 concurrent | 1 concurrent | 1 concurrent |
| WebSocket Channels | 30 trades/quotes (crypto) | Unlimited | Unlimited |
| Paper Trading | Unlimited | Unlimited | Unlimited |

**Key Free Tier Constraints:**
- IEX data only (covers ~10% of market trades, less granular)
- Historical SIP data requires 15-min delay
- 200 REST API calls per minute (429 error if exceeded)
- Paper trading is fully functional and free for all tiers
- No fractional share limitations on free tier

---

## 5. WebSocket Streaming

### Market Data Stream

**URLs:**
```
wss://stream.data.alpaca.markets/v2/iex      # Free (IEX feed)
wss://stream.data.alpaca.markets/v2/sip      # Paid (SIP feed)
wss://stream.data.alpaca.markets/v2/test     # Test (24/7, use "FAKEPACA")
```

**Authentication (within 10 seconds of connecting):**
```json
{"action": "auth", "key": "{API_KEY_ID}", "secret": "{API_SECRET}"}
```

**Subscribe to channels:**
```json
{
  "action": "subscribe",
  "trades": ["AAPL", "MSFT"],
  "quotes": ["AAPL"],
  "bars": ["*"]
}
```

**Unsubscribe:**
```json
{
  "action": "unsubscribe",
  "trades": ["AAPL"]
}
```

**Message Types:**
```typescript
// Trade message
interface TradeMessage {
  T: 't';        // Message type
  S: string;     // Symbol
  i: number;     // Trade ID
  x: string;     // Exchange
  p: number;     // Price
  s: number;     // Size
  t: string;     // Timestamp
  c: string[];   // Conditions
  z: string;     // Tape
}

// Quote message
interface QuoteMessage {
  T: 'q';
  S: string;     // Symbol
  bx: string;    // Bid exchange
  bp: number;    // Bid price
  bs: number;    // Bid size
  ax: string;    // Ask exchange
  ap: number;    // Ask price
  as: number;    // Ask size
  t: string;     // Timestamp
  c: string[];   // Conditions
  z: string;     // Tape
}

// Bar message (1-minute aggregated)
interface BarMessage {
  T: 'b';
  S: string;     // Symbol
  o: number;     // Open
  h: number;     // High
  l: number;     // Low
  c: number;     // Close
  v: number;     // Volume
  t: string;     // Timestamp
  n: number;     // Trade count
  vw: number;    // VWAP
}
```

**All messages arrive as arrays:** `[{...}, {...}]`

### Trading Updates Stream (Order/Position Updates)

**URLs:**
```
wss://paper-api.alpaca.markets/stream    # Paper
wss://api.alpaca.markets/stream          # Live
```

**Authentication:**
```json
{
  "action": "authenticate",
  "data": {
    "key_id": "{API_KEY_ID}",
    "secret_key": "{API_SECRET}"
  }
}
```

**Subscribe to trade updates:**
```json
{"action": "listen", "data": {"streams": ["trade_updates"]}}
```

**Trade Update Message:**
```typescript
interface TradeUpdate {
  event: 'new' | 'fill' | 'partial_fill' | 'canceled' | 'expired'
       | 'done_for_day' | 'replaced' | 'rejected' | 'pending_new'
       | 'stopped' | 'pending_cancel' | 'pending_replace'
       | 'calculated' | 'suspended' | 'order_replace_rejected'
       | 'order_cancel_rejected';
  order: Order;
  timestamp: string;
  position_qty: string;
  price: string;
  qty: string;
}
```

---

## 6. Rate Limits

| Endpoint Category | Free Tier | Paid Tier |
|---|---|---|
| Trading API (all endpoints) | 200 req/min | 200 req/min |
| Market Data REST | 200 req/min | 1,000-10,000 req/min |
| WebSocket connections | 1 concurrent | 1 concurrent |
| WebSocket auth timeout | 10 seconds | 10 seconds |

HTTP 429 response when exceeded. Implement exponential backoff.

---

## 7. TypeScript Integration Code

### Setup and Client Configuration

```typescript
// src/lib/alpaca/client.ts

interface AlpacaConfig {
  keyId: string;
  secretKey: string;
  paper: boolean;
}

const config: AlpacaConfig = {
  keyId: process.env.ALPACA_API_KEY_ID!,
  secretKey: process.env.ALPACA_SECRET_KEY!,
  paper: process.env.ALPACA_PAPER === 'true',
};

const TRADING_BASE = config.paper
  ? 'https://paper-api.alpaca.markets'
  : 'https://api.alpaca.markets';

const DATA_BASE = 'https://data.alpaca.markets';

const headers = {
  'APCA-API-KEY-ID': config.keyId,
  'APCA-API-SECRET-KEY': config.secretKey,
  'Content-Type': 'application/json',
};

async function alpacaTrading<T>(
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(`${TRADING_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Alpaca ${method} ${path} failed (${response.status}): ${error}`);
  }

  return response.json() as Promise<T>;
}

async function alpacaData<T>(
  path: string,
  params?: Record<string, string>,
): Promise<T> {
  const url = new URL(`${DATA_BASE}${path}`);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
  }

  const response = await fetch(url.toString(), { headers });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Alpaca Data ${path} failed (${response.status}): ${error}`);
  }

  return response.json() as Promise<T>;
}

export { alpacaTrading, alpacaData, config, TRADING_BASE, DATA_BASE, headers };
```

### Account & Buying Power

```typescript
// src/lib/alpaca/account.ts
import { alpacaTrading } from './client';

interface AlpacaAccount {
  id: string;
  buying_power: string;
  cash: string;
  portfolio_value: string;
  equity: string;
  last_equity: string;
  pattern_day_trader: boolean;
  trading_blocked: boolean;
  daytrade_count: number;
  multiplier: string;
}

export async function getAccount(): Promise<AlpacaAccount> {
  return alpacaTrading<AlpacaAccount>('GET', '/v2/account');
}

export async function getBuyingPower(): Promise<number> {
  const account = await getAccount();
  return parseFloat(account.buying_power);
}
```

### Order Placement (with Bracket for SL/TP)

```typescript
// src/lib/alpaca/orders.ts
import { alpacaTrading } from './client';

interface BracketOrderParams {
  symbol: string;
  qty: string;
  side: 'buy' | 'sell';
  entryType: 'market' | 'limit';
  limitPrice?: string;
  takeProfitPrice: string;
  stopLossPrice: string;
  stopLossLimitPrice?: string;
}

export async function placeBracketOrder(params: BracketOrderParams): Promise<Order> {
  const body: Record<string, unknown> = {
    symbol: params.symbol,
    qty: params.qty,
    side: params.side,
    type: params.entryType,
    time_in_force: 'gtc',
    order_class: 'bracket',
    take_profit: {
      limit_price: params.takeProfitPrice,
    },
    stop_loss: {
      stop_price: params.stopLossPrice,
      ...(params.stopLossLimitPrice && { limit_price: params.stopLossLimitPrice }),
    },
  };

  if (params.entryType === 'limit' && params.limitPrice) {
    body.limit_price = params.limitPrice;
  }

  return alpacaTrading<Order>('POST', '/v2/orders', body);
}

// DCA: Place multiple limit orders at different price levels
export async function placeDCAOrders(
  symbol: string,
  totalQty: number,
  levels: Array<{ price: string; pctOfTotal: number }>,
  takeProfitPrice: string,
  stopLossPrice: string,
): Promise<Order[]> {
  const orders: Order[] = [];

  for (const level of levels) {
    const levelQty = Math.floor(totalQty * level.pctOfTotal);
    if (levelQty <= 0) continue;

    const order = await placeBracketOrder({
      symbol,
      qty: String(levelQty),
      side: 'buy',
      entryType: 'limit',
      limitPrice: level.price,
      takeProfitPrice,
      stopLossPrice,
    });

    orders.push(order);
  }

  return orders;
}

export async function cancelOrder(orderId: string): Promise<void> {
  await alpacaTrading<void>('DELETE', `/v2/orders/${orderId}`);
}

export async function getOpenOrders(): Promise<Order[]> {
  return alpacaTrading<Order[]>('GET', '/v2/orders?status=open&nested=true');
}
```

### Historical Bars for Technical Analysis

```typescript
// src/lib/alpaca/marketdata.ts
import { alpacaData } from './client';

interface Bar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  n: number;
  vw: number;
}

interface BarsResponse {
  bars: Bar[];
  symbol: string;
  next_page_token: string | null;
}

interface MultiBarsResponse {
  bars: Record<string, Bar[]>;
  next_page_token: string | null;
}

export async function getHistoricalBars(
  symbol: string,
  timeframe: string,
  start: string,
  end?: string,
  limit = 1000,
): Promise<Bar[]> {
  const params: Record<string, string> = {
    timeframe,
    start,
    limit: String(limit),
    feed: 'iex',  // Free tier; change to 'sip' with paid plan
    sort: 'asc',
  };

  if (end) params.end = end;

  const allBars: Bar[] = [];
  let pageToken: string | null = null;

  do {
    if (pageToken) params.page_token = pageToken;

    const response = await alpacaData<BarsResponse>(
      `/v2/stocks/${symbol}/bars`,
      params,
    );

    allBars.push(...response.bars);
    pageToken = response.next_page_token;
  } while (pageToken);

  return allBars;
}

// Get bars for multiple symbols in one call (for scanner)
export async function getMultiBars(
  symbols: string[],
  timeframe: string,
  start: string,
  limit = 1000,
): Promise<Record<string, Bar[]>> {
  const params: Record<string, string> = {
    symbols: symbols.join(','),
    timeframe,
    start,
    limit: String(limit),
    feed: 'iex',
    sort: 'asc',
  };

  const response = await alpacaData<MultiBarsResponse>(
    '/v2/stocks/bars',
    params,
  );

  return response.bars;
}

export async function getSnapshot(symbol: string) {
  return alpacaData(`/v2/stocks/${symbol}/snapshot`, { feed: 'iex' });
}
```

### Positions Management

```typescript
// src/lib/alpaca/positions.ts
import { alpacaTrading } from './client';

interface Position {
  asset_id: string;
  symbol: string;
  qty: string;
  qty_available: string;
  side: 'long' | 'short';
  avg_entry_price: string;
  market_value: string;
  cost_basis: string;
  unrealized_pl: string;
  unrealized_plpc: string;
  current_price: string;
  change_today: string;
}

export async function getPositions(): Promise<Position[]> {
  return alpacaTrading<Position[]>('GET', '/v2/positions');
}

export async function getPosition(symbol: string): Promise<Position> {
  return alpacaTrading<Position>('GET', `/v2/positions/${symbol}`);
}

export async function closePosition(
  symbol: string,
  qty?: string,
): Promise<Order> {
  const path = qty
    ? `/v2/positions/${symbol}?qty=${qty}`
    : `/v2/positions/${symbol}`;
  return alpacaTrading<Order>('DELETE', path);
}

export async function closeAllPositions(): Promise<void> {
  await alpacaTrading<void>('DELETE', '/v2/positions');
}
```

### WebSocket Streaming (Market Data + Trade Updates)

```typescript
// src/lib/alpaca/streaming.ts
import WebSocket from 'ws';
import { config } from './client';

type MessageHandler = (messages: unknown[]) => void;

export function createMarketDataStream(
  symbols: string[],
  onTrade: MessageHandler,
  onQuote: MessageHandler,
  onBar: MessageHandler,
): WebSocket {
  const feed = 'iex'; // 'sip' for paid
  const ws = new WebSocket(`wss://stream.data.alpaca.markets/v2/${feed}`);

  ws.on('open', () => {
    // Authenticate within 10 seconds
    ws.send(JSON.stringify({
      action: 'auth',
      key: config.keyId,
      secret: config.secretKey,
    }));
  });

  ws.on('message', (data: WebSocket.Data) => {
    const messages = JSON.parse(data.toString()) as Array<{ T: string; [key: string]: unknown }>;

    for (const msg of messages) {
      switch (msg.T) {
        case 'success':
          if (msg.msg === 'authenticated') {
            // Subscribe after auth
            ws.send(JSON.stringify({
              action: 'subscribe',
              trades: symbols,
              quotes: symbols,
              bars: symbols,
            }));
          }
          break;
        case 't': onTrade([msg]); break;
        case 'q': onQuote([msg]); break;
        case 'b': onBar([msg]); break;
        case 'error':
          console.error('WebSocket error:', msg);
          break;
      }
    }
  });

  ws.on('close', () => {
    console.warn('Market data WebSocket closed. Reconnecting...');
    setTimeout(() => {
      createMarketDataStream(symbols, onTrade, onQuote, onBar);
    }, 5000);
  });

  return ws;
}

export function createTradeUpdatesStream(
  onUpdate: (event: string, order: unknown) => void,
): WebSocket {
  const base = config.paper
    ? 'wss://paper-api.alpaca.markets/stream'
    : 'wss://api.alpaca.markets/stream';

  const ws = new WebSocket(base);

  ws.on('open', () => {
    ws.send(JSON.stringify({
      action: 'authenticate',
      data: {
        key_id: config.keyId,
        secret_key: config.secretKey,
      },
    }));
  });

  ws.on('message', (data: WebSocket.Data) => {
    const msg = JSON.parse(data.toString());

    if (msg.stream === 'authorization' && msg.data?.status === 'authorized') {
      ws.send(JSON.stringify({
        action: 'listen',
        data: { streams: ['trade_updates'] },
      }));
    }

    if (msg.stream === 'trade_updates') {
      onUpdate(msg.data.event, msg.data.order);
    }
  });

  ws.on('close', () => {
    console.warn('Trade updates WebSocket closed. Reconnecting...');
    setTimeout(() => {
      createTradeUpdatesStream(onUpdate);
    }, 5000);
  });

  return ws;
}
```

### Swing Trading Scanner Skeleton

```typescript
// src/lib/alpaca/scanner.ts
import { getMultiBars } from './marketdata';
import { getAccount } from './account';
import { placeBracketOrder, placeDCAOrders } from './orders';

interface ScanResult {
  symbol: string;
  rsi: number;
  macdCrossover: boolean;
  volumeSpike: boolean;
  currentPrice: number;
  score: number;
}

// Calculate RSI from bars
function calculateRSI(bars: Array<{ c: number }>, period = 14): number {
  if (bars.length < period + 1) return 50; // Not enough data

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const change = bars[i].c - bars[i - 1].c;
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < bars.length; i++) {
    const change = bars[i].c - bars[i - 1].c;
    avgGain = (avgGain * (period - 1) + (change > 0 ? change : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (change < 0 ? Math.abs(change) : 0)) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

// Calculate MACD
function calculateMACD(bars: Array<{ c: number }>): { macd: number; signal: number; histogram: number } {
  const closes = bars.map((b) => b.c);

  const ema12 = calculateEMA(closes, 12);
  const ema26 = calculateEMA(closes, 26);

  const macdLine = ema12.map((val, i) => val - ema26[i]);
  const signalLine = calculateEMA(macdLine.slice(26), 9);

  const macd = macdLine[macdLine.length - 1];
  const signal = signalLine[signalLine.length - 1];

  return { macd, signal, histogram: macd - signal };
}

function calculateEMA(data: number[], period: number): number[] {
  const multiplier = 2 / (period + 1);
  const ema: number[] = [data[0]];

  for (let i = 1; i < data.length; i++) {
    ema.push((data[i] - ema[i - 1]) * multiplier + ema[i - 1]);
  }

  return ema;
}

// Detect volume spike (current vol > 1.5x 20-day average)
function hasVolumeSpike(bars: Array<{ v: number }>, threshold = 1.5): boolean {
  if (bars.length < 21) return false;

  const recentBars = bars.slice(-21);
  const avgVolume = recentBars.slice(0, 20).reduce((sum, b) => sum + b.v, 0) / 20;
  const currentVolume = recentBars[20].v;

  return currentVolume > avgVolume * threshold;
}

// Scan a watchlist for swing trade setups
export async function scanForSetups(symbols: string[]): Promise<ScanResult[]> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 60); // 60 days of daily bars

  const allBars = await getMultiBars(
    symbols,
    '1Day',
    startDate.toISOString().split('T')[0],
  );

  const results: ScanResult[] = [];

  for (const symbol of symbols) {
    const bars = allBars[symbol];
    if (!bars || bars.length < 30) continue;

    const rsi = calculateRSI(bars);
    const { macd, signal, histogram } = calculateMACD(bars);
    const prevHistogram = calculateMACD(bars.slice(0, -1)).histogram;

    const macdCrossover = prevHistogram < 0 && histogram > 0; // Bullish crossover
    const volumeSpike = hasVolumeSpike(bars);
    const currentPrice = bars[bars.length - 1].c;

    // Score: RSI oversold (< 30) + MACD crossover + volume spike
    let score = 0;
    if (rsi < 30) score += 3;
    else if (rsi < 40) score += 1;
    if (macdCrossover) score += 3;
    if (volumeSpike) score += 2;

    if (score >= 4) {
      results.push({ symbol, rsi, macdCrossover, volumeSpike, currentPrice, score });
    }
  }

  return results.sort((a, b) => b.score - a.score);
}

// Execute a swing trade with DCA entries
export async function executeSwingTrade(
  symbol: string,
  currentPrice: number,
  riskPercent = 0.02,    // 2% of portfolio per trade
  takeProfitPercent = 0.08, // 8% target
  stopLossPercent = 0.04,   // 4% stop
) {
  const account = await getAccount();
  const equity = parseFloat(account.equity);
  const positionSize = equity * riskPercent;
  const totalShares = Math.floor(positionSize / currentPrice);

  if (totalShares <= 0) {
    throw new Error(`Position size too small for ${symbol} at $${currentPrice}`);
  }

  const takeProfitPrice = (currentPrice * (1 + takeProfitPercent)).toFixed(2);
  const stopLossPrice = (currentPrice * (1 - stopLossPercent)).toFixed(2);

  // DCA: 3 entry levels (40% at market, 30% at -1%, 30% at -2%)
  const orders = await placeDCAOrders(
    symbol,
    totalShares,
    [
      { price: currentPrice.toFixed(2), pctOfTotal: 0.4 },
      { price: (currentPrice * 0.99).toFixed(2), pctOfTotal: 0.3 },
      { price: (currentPrice * 0.98).toFixed(2), pctOfTotal: 0.3 },
    ],
    takeProfitPrice,
    stopLossPrice,
  );

  return { orders, totalShares, takeProfitPrice, stopLossPrice };
}
```

---

## 8. Environment Variables

```env
ALPACA_API_KEY_ID=PKxxxxxxxxxxxxxxxxxx
ALPACA_SECRET_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
ALPACA_PAPER=true
ALPACA_DATA_FEED=iex
```

---

## 9. Official Resources

- [API Docs Home](https://docs.alpaca.markets/)
- [Authentication](https://docs.alpaca.markets/docs/authentication)
- [Trading API](https://docs.alpaca.markets/docs/trading-api)
- [Orders Reference](https://docs.alpaca.markets/reference/postorder)
- [Market Data](https://docs.alpaca.markets/docs/getting-started-with-alpaca-market-data)
- [Historical Bars](https://docs.alpaca.markets/reference/stockbars)
- [WebSocket Streaming](https://docs.alpaca.markets/docs/streaming-market-data)
- [Paper Trading](https://docs.alpaca.markets/docs/paper-trading)
- [Node.js SDK (GitHub)](https://github.com/alpacahq/alpaca-trade-api-js)
- [NPM Package](https://www.npmjs.com/package/@alpacahq/alpaca-trade-api)
- [Postman Collection](https://www.postman.com/alpacamarkets/alpaca-public-workspace/documentation/i8x3xt7/trading-api)
