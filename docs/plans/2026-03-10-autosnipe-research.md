# AutoSnipe.ai Feature Research & TradeWorks Comparison

**Date:** 2026-03-10
**Researcher:** Claude (Sprint 12.1)
**Method:** Live Chrome browsing of autosnipe.ai (all 9 pages)

---

## 1. AutoSnipe.ai Overview

AutoSnipe.ai is a Solana-focused memecoin trading platform (SvelteKit SPA) that combines:
- Real-time token discovery (trending + new pairs)
- AI-powered autonomous sniping (configurable bots)
- Copy trading (mirror whale/KOL wallets)
- Portfolio tracking with full P&L
- Wallet analysis tools

---

## 2. Feature-by-Feature Comparison

### 2.1 Token Discovery

| Feature | AutoSnipe.ai | TradeWorks | Gap |
|---------|-------------|------------|-----|
| Trending tokens | Yes (24h/6h/1h/5m filters) | Yes (Dexscreener trending) | Minor — add timeframe filters |
| New pairs feed | Yes (real-time, live age in seconds) | Yes (pump.fun monitor) | Minor — add age display |
| Safety filters | MAD/LB/FAD toggle filters | Mint/Freeze authority checks | Add LB (Liquidity Burned/Locked) |
| Instant buy buttons | Yes (per row) | Yes (scanner quick swap) | Parity |
| Search | Full-text search bar | No search on scanner | **Add search** |
| Category filters | Hide Scams, Hide Rugs | No category toggles | **Add safety filter toggles** |

### 2.2 AI Snipers

| Feature | AutoSnipe.ai | TradeWorks | Gap |
|---------|-------------|------------|-----|
| Pre-built templates | Yes (named sniper cards) | No — single global config | **Add sniper templates/presets** |
| Multiple active snipers | Yes (run many simultaneously) | Single sniper engine | **Add multi-sniper support** |
| Per-sniper stats | PnL, Trades, Win Rate per bot | Global history only | **Add per-sniper tracking** |
| Token filters | Min/Max MCap, Min/Max Liquidity, Min Holders | minLiquidity, maxMarketCap only | **Add min holders filter** |
| Safety checks | Mint auth, Freeze auth, Liquidity lock | Mint auth, Freeze auth | **Add liquidity lock check** |
| Auto-sell config | TP% + SL% per sniper | Global TP/SL | Parity (but need per-sniper) |
| Priority fees | Configurable | Yes (priorityFee setting) | Parity |
| Create/edit/delete | Full CRUD on snipers | Single config PUT | **Add sniper CRUD** |

### 2.3 Copy Trading

| Feature | AutoSnipe.ai | TradeWorks | Gap |
|---------|-------------|------------|-----|
| Explore traders | Categories: Top, Smart Money, KOL, Sniper, Fresh | Manual wallet add only | **Major gap — add trader discovery** |
| Trader stats | PnL, Win Rate, TXs, Volume, Net Inflow | No stats per whale | **Add whale performance stats** |
| 1-click copy | Copy button per trader | Whale tab → manual config | **Streamline UX** |
| Buy settings | Amount, Max Slippage per copy | Scale factor, max amount | Similar |
| Sell strategy | Copy Sell OR Auto Sell (TP/SL) | Buy-only default | **Add sell mirroring** |
| Anti-MEV | Toggle per copy config | None | **Add anti-MEV protection** |
| Time filters | 1D/7D/30D performance | No historical tracking | **Add historical whale stats** |
| Live tracking | LIVE category for active traders | Polling every 15s | Similar approach |

### 2.4 Meme Vision (Kanban Board)

| Feature | AutoSnipe.ai | TradeWorks | Gap |
|---------|-------------|------------|-----|
| Token lifecycle | Kanban columns showing lifecycle stages | Not present | **New feature — pump.fun lifecycle board** |
| Visual pipeline | Drag/visual representation | Text list only (PumpFunTab) | **Major UX gap** |
| Stage tracking | Creation → Bonding → Graduation → Post-Grad | Bonding curve % display | Partial data exists |

### 2.5 Trader Lens (Wallet Analysis)

| Feature | AutoSnipe.ai | TradeWorks | Gap |
|---------|-------------|------------|-----|
| Wallet lookup | Enter any address, see full history | No wallet analysis tool | **New feature** |
| PnL analysis | Win rate, total PnL, volume | Whale leaderboard (volume only) | **Add win rate/PnL** |
| Trading patterns | Historical pattern detection | None | **New feature** |

### 2.6 Holdings / Portfolio

| Feature | AutoSnipe.ai | TradeWorks | Gap |
|---------|-------------|------------|-----|
| Per-token P&L | Invested, Remaining, Sold, Current Value, P&L | Current value only | **Major gap — track cost basis** |
| Sell All | One-click sell all tokens | No bulk sell | **Add Sell All** |
| Hide fully sold | Toggle filter | No filter | Minor |
| Cross-exchange | Single wallet (Solana only) | Multi-exchange aggregation | **TradeWorks ahead** |

### 2.7 Wallet Management

| Feature | AutoSnipe.ai | TradeWorks | Gap |
|---------|-------------|------------|-----|
| Deposit/withdraw | SOL deposit via QR/address | Bot wallet (no withdraw UI) | **Add withdraw UI** |
| Balance display | SOL balance + token values | Yes (bot + Phantom) | Parity |

---

## 3. Priority Matrix

### Tier 1 — High Impact, Feasible Now (Sprint 12.2)

1. **Sniper Templates/Presets** — Multiple named sniper configs (CRUD)
   - Backend: Array of sniper configs instead of single object
   - Dashboard: Card UI with create/edit/delete, per-sniper stats
   - Why: Core feature gap, AutoSnipe's main differentiator

2. **Enhanced Copy Trading UX** — 1-click copy + sell mirroring
   - Backend: Add sell tracking to whale monitor, auto-sell support
   - Dashboard: Streamline copy config, add per-whale PnL stats
   - Why: User specifically requested copy-trade page

3. **Safety Filter Toggles** — Hide Scams/Rugs toggles on token lists
   - Dashboard: Add toggle bar to ScannerTab + PumpFunTab
   - Backend: Already have safety data, just need filtering logic
   - Why: Quick win, high safety value

### Tier 2 — Medium Impact, 1-2 Sprint Effort

4. **Holdings P&L Tracking** — Track cost basis per token
   - Backend: Store buy price/amount in persistent DB (not in-memory)
   - Dashboard: Show invested/sold/remaining/P&L columns
   - Why: Critical for traders to evaluate performance

5. **New Pairs Real-Time Feed** — Live age display, better UX
   - Dashboard: Add live countdown timer (age in seconds), one-click snipe
   - Backend: Already have pump.fun WebSocket, just need better broadcast
   - Why: Speed advantage for early sniping

6. **Liquidity Lock Detection** — Check if LP tokens are burned/locked
   - Backend: On-chain query for LP token burn status
   - Why: Important safety signal AutoSnipe highlights

### Tier 3 — Nice to Have, Future Sprints

7. **Meme Vision Kanban** — Visual pump.fun lifecycle board
   - Complex UI component, moderate backend (track lifecycle stages)

8. **Trader Lens** — Wallet analysis tool
   - New page + backend parsing of Solana transaction history

9. **Anti-MEV Protection** — Jito bundles or private mempool
   - Requires Jito integration, moderate complexity

10. **Trader Discovery** — Auto-discover profitable wallets
    - Requires on-chain analytics, high complexity

---

## 4. Architecture Recommendations

### Sniper Templates (Tier 1)
```
Current: Single SniperConfig object in memory
Target:  Map<string, SniperConfig> with names + IDs
         Each sniper runs independently with own TP/SL/filters
         Per-sniper execution history + stats tracking
         REST: GET/POST/PUT/DELETE /solana/sniper/templates/:id
```

### Copy Trading Enhancement (Tier 1)
```
Current: Whale monitor → detect buy → copy buy (buy-only)
Target:  Whale monitor → detect buy OR sell → copy action
         Per-whale: track PnL, win rate, volume (7D/30D windows)
         Quick copy: POST /solana/whales/:address/copy (1-click)
         Sell mirroring: When tracked whale sells, auto-sell too
```

### Holdings P&L (Tier 2)
```
Current: Live positions in memory (lost on restart)
Target:  SQLite or JSON file persistence
         Track: mint, buyPrice, buyAmount, buyTimestamp, sellPrice, sellAmount
         Calculate: invested, currentValue, realizedPnL, unrealizedPnL
         Endpoint: GET /solana/holdings (with P&L calculations)
```

---

## 5. What TradeWorks Already Does Better

- **Multi-exchange support** — Coinbase, Robinhood, Crypto.com (AutoSnipe is Solana-only)
- **Moonshot AI scoring** — 7-factor algorithmic scoring (AutoSnipe's AI is opaque)
- **Phantom wallet integration** — Direct wallet connection for user-owned transactions
- **Equity curve & portfolio charts** — Charting infrastructure already built
- **Traditional markets** — Stocks alongside crypto (broader scope)

---

## 6. Implementation Order (Recommended)

| Sprint | Features | Effort |
|--------|----------|--------|
| 12.2 | Sniper Templates + Safety Filters + Copy Trade UX | 3 days |
| 12.3 | Holdings P&L + New Pairs Feed Enhancement | 2 days |
| 12.4 | Meme Vision Board + Liquidity Lock | 2 days |
| 13.0 | Trader Lens + Anti-MEV + Trader Discovery | 1 week |
