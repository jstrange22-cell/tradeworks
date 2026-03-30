# Solana Sniper Bot & Trading Strategy Research

**Date:** 2026-03-29
**Purpose:** Technical research for TradeWorks Sprint 8 — Solana memecoin trading bot

---

## 1. TOP OPEN-SOURCE REPOSITORIES

### Tier 1 — Best Technical Quality

#### fdundjer/solana-sniper-bot (Proof of Concept)
- **URL:** https://github.com/fdundjer/solana-sniper-bot
- **Language:** TypeScript
- **Best for:** Learning the full architecture of a Raydium sniper
- **Key technical patterns:**
  - Dual executor support: `warp` (privacy-preserving) and `jito` (MEV bundles)
  - WebSocket-based pool detection via `RPC_WEBSOCKET_ENDPOINT`
  - Comprehensive filter system (see Section 3 below)
  - Trailing stop loss implementation
  - Snipe list mode vs auto-snipe mode
  - Market pre-loading cache for faster execution

#### chainstacklabs/pumpfun-bonkfun-bot (Python)
- **URL:** https://github.com/chainstacklabs/pumpfun-bonkfun-bot
- **Language:** Python
- **Best for:** Pump.fun sniping with gRPC/Geyser integration
- **Key technical patterns:**
  - Dual detection: `logsSubscribe` (broad compat) + `blockSubscribe` (faster)
  - PDA computation on-the-fly for bonding curve addresses
  - Yellowstone gRPC with Jito ShredStream
  - Token bucket rate limiter (default 25 RPS, exponential backoff on 429s)
  - Bonding curve completion monitoring + migration listening
  - Migration event detection for PumpSwap AMM graduation

#### D3AD-E/Solana-sniper-bot (0-slot Sniper)
- **URL:** https://github.com/D3AD-E/Solana-sniper-bot
- **Language:** TypeScript (88%) + Rust (3.2%) native bindings
- **Best for:** Understanding ultra-low-latency execution
- **Key technical patterns:**
  - **5ms tx build + send** via Rust N-API native modules
  - **4 concurrent MEV providers:** 0slot, NextBlock, Astra, Node1
  - All providers receive tx within a single 5ms window
  - Shred access via custom jito-shred-mod component
  - Redis for state management
  - Telegram notification integration
  - Requires local Solana validator node

#### outsmartchad/solana-trading-cli
- **URL:** https://github.com/outsmartchad/solana-trading-cli
- **Language:** TypeScript
- **Best for:** Multi-DEX trading framework with gRPC
- **Key technical patterns:**
  - 18 DEX adapters (Raydium CPMM/Fusion, Meteora DAMM/DLMM, Orca, PumpFun, PumpSwap, Jupiter Ultra, DFlow)
  - gRPC primary (~200ms latency) with WebSocket fallback (~1-3s)
  - 12 concurrent TX landing processors
  - Stream presets: all-dex-swaps, new-pools, pumpfun-bonding, wallet-trades
  - Programmatic API: `getDexAdapter`, `LpManager`, `EventStream`
  - LP auto-rebalancing with IL thresholds

### Tier 2 — Useful Reference

#### nirholas/pump-fun-sdk (TypeScript SDK)
- **URL:** https://github.com/nirholas/pump-fun-sdk
- Community TypeScript SDK for pump.fun protocol
- Offline-first instruction builders (returns `TransactionInstruction[]`)
- Token creation, bonding curve trading, AMM pool management, tiered fees

#### ahk780/pumpfun-copy-trading-bot (React + TypeScript)
- **URL:** https://github.com/ahk780/pumpfun-copy-trading-bot
- Copy trading with React dashboard UI
- gRPC + WebSocket for trade detection
- Risk management: stop-loss 5-10%, take-profit 10-20%, position timeout 60min
- Default slippage: 20% (recommended 10-20%)

#### PioSol7/Solana_Copy_Trading_Bot
- **URL:** https://github.com/PioSol7/Solana_Copy_Trading_Bot
- Helius geyser RPC WebSocket for wallet monitoring
- 0.3ms processing time for transaction detection
- Supports PumpFun and Raydium copy transactions

#### cutupdev/Solana-Copytrading-bot
- **URL:** https://github.com/cutupdev/Solana-Copytrading-bot
- Written in Rust for performance
- Basic version: RPC WebSocket (300-500ms)
- Advanced version: gRPC (50-100ms)
- Supports Raydium, Meteora, PumpFun, PumpSwap

#### DracoR22/handi-cat_wallet-tracker
- **URL:** https://github.com/DracoR22/handi-cat_wallet-tracker
- Telegram wallet tracker bot
- Tracks Raydium, Jupiter, Pump.fun, PumpSwap transactions
- Shows tx hash, tokens swapped, price in SOL, market cap

#### jcoulaud/pumpfun-sniping-bot (Anti-Sniper Strategy)
- **URL:** https://github.com/jcoulaud/pumpfun-sniping-bot
- Interesting reverse strategy: creates tokens, detects sniper buys, sells into them
- Uses OpenAI for token metadata/image generation
- Profit tracking built in

---

## 2. TOKEN DETECTION METHODS

### Method 1: WebSocket logsSubscribe (Most Compatible)
```
// Subscribe to program logs for Raydium/PumpFun program IDs
// Raydium V4: 675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8
// PumpFun: 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P
connection.onLogs(PROGRAM_ID, callback)
```
- Broad RPC compatibility
- Computes bonding curve PDA on-the-fly (no extra getTransaction call)
- Latency: 100-300ms

### Method 2: WebSocket blockSubscribe (Faster, Less Compatible)
```
// Subscribe to full blocks, parse for pool creation instructions
connection.blockSubscribe(filter, callback)
```
- Not all RPC providers support this
- Lower latency than logsSubscribe

### Method 3: Geyser gRPC / Yellowstone (Lowest Latency)
```
// Yellowstone gRPC streams account updates from validator memory
// Uses Protocol Buffers + HTTP/2 (faster than JSON/HTTP1.1)
// Latency: 1-5ms vs 50-200ms for WebSocket
```
- Requires Yellowstone/Triton One compatible node
- Sub-50ms latency
- Direct validator memory access
- Providers: Helius, Triton, Chainstack

### Method 4: Jito ShredStream (Fastest Possible)
```
// Access shreds before block confirmation
// Combined with Geyser for pre-block data
```
- Requires specialized infrastructure
- Co-location near validators
- Sub-10ms detection

### Detection Pipeline (Recommended)
```
Geyser gRPC stream → Filter for pool creation events →
  Parse token mint + LP details → Run rug checks →
  Build transaction → Submit via Jito bundle
```

---

## 3. RUG DETECTION & TOKEN FILTERING

### Core Safety Checks (from fdundjer bot)

| Check | Config Key | What It Does |
|-------|-----------|--------------|
| Mint Authority | `CHECK_IF_MINT_IS_RENOUNCED` | Reject if mint authority not null (can mint new tokens) |
| Freeze Authority | `CHECK_IF_FREEZABLE` | Reject if freeze authority exists (honeypot risk) |
| LP Burn | `CHECK_IF_BURNED` | Reject if LP tokens not burned (rug pull risk) |
| Metadata Mutable | `CHECK_IF_MUTABLE` | Reject if metadata can be changed |
| Social Presence | `CHECK_IF_SOCIALS` | Require minimum social links |
| Pool Size Min | `MIN_POOL_SIZE` | Reject pools below SOL threshold |
| Pool Size Max | `MAX_POOL_SIZE` | Reject pools above SOL threshold (late entry) |

### Advanced 12-Point Safety Scoring
1. Mint authority check (null = safe)
2. Freeze authority check (null = safe)
3. Top holder concentration (<10% single, <25% top 10)
4. Liquidity lock verification
5. Honeypot simulation (test buy + sell)
6. Deployer wallet history (past rugs?)
7. Dev wallet concentration
8. LP burn status
9. Bundle detection (coordinated buys = insider)
10. Buy/sell tax analysis
11. Social presence score
12. On-chain metadata validation

### Holder Distribution Analysis

**APIs for checking:**
- Helius `getTokenAccounts` — returns all holders, paginated (1000/page)
- Moralis Top Holders API — ranked holders with % of supply
- Solscan Pro API — filter by min/max holdings

**Key thresholds used by bots:**
- `MAX_TOP10_HOLDERS_PERCENTAGE`: typically 25-30%
- `MAX_SINGLE_OWNER_PERCENTAGE`: typically 10-15%
- Bundle detection: multiple wallets buying in same block = insider

### Dev Wallet Tracking Signals
- Wallet that deployed the token contract
- First N wallets to buy (within first 60 seconds)
- Wallets that received tokens from deployer
- Supply distribution from create transaction
- Historical behavior of deployer wallet (previous rugs)

---

## 4. EXECUTION STRATEGIES

### Jito Bundles (MEV Protection)
```
// Bundle = up to 5 transactions, atomic execution
// All-or-nothing: if bundle fails, nothing executes
// Tip required: paid to one of 8 tip accounts
// Typical tip: 50-60% of expected profit for arb bots
// Sniper tip: 0.001-0.01 SOL for priority
```

**Jito SDKs:** Python, JavaScript, Rust, Go

### Priority Fee Calibration
```
// Dynamic fee based on competition level
// Base: COMPUTE_UNIT_LIMIT * COMPUTE_UNIT_PRICE
// Warp/Jito: CUSTOM_FEE (min 0.0001, recommended 0.006+ SOL)
// Nova bot preset: 0.0005-0.002 SOL gas + 0.0003-0.0015 SOL MEV tip
```

### Multi-Provider Broadcasting (D3AD-E pattern)
```
// Send to ALL providers simultaneously in 5ms window:
// 1. 0slot (shred-based, fastest)
// 2. NextBlock
// 3. Astra
// 4. Node1 (fallback)
// First to land wins, others are rejected as duplicates
```

### Transaction Pipeline Timing
```
Event detection:    ~1-5ms (gRPC) / ~100-300ms (WebSocket)
Rug check:          ~5-20ms (local checks) / ~50-200ms (API calls)
TX construction:    ~5ms (Rust native) / ~20-50ms (TypeScript)
TX submission:      ~5ms (multi-provider broadcast)
Block inclusion:    ~400ms (1 slot)
─────────────────────────────────────────────
Total optimal:      ~416ms (same-slot landing)
Total realistic:    ~800-1200ms (next-slot)
```

---

## 5. EXIT STRATEGIES & POSITION MANAGEMENT

### Take Profit / Stop Loss (from fdundjer bot)
```env
TAKE_PROFIT=50              # Sell at 50% gain
STOP_LOSS=30                # Sell at 30% loss
TRAILING_STOP_LOSS=true     # Dynamic trailing stop
PRICE_CHECK_INTERVAL=5000   # Check every 5 seconds
PRICE_CHECK_DURATION=300000 # Max hold time: 5 minutes
SKIP_SELLING_IF_LOST_MORE_THAN=90  # Skip if >90% loss (already rugged)
```

### Tiered Exit Strategy (Wave CLI pattern)
```
Tier 1: Sell 50% at +100% (recover initial + 50% profit)
Tier 2: Sell 25% at +200% (lock in more profit)
Tier 3: Sell 100% remaining at +400% (moon bag exit)
```

### Market Cap-Based Exits
```
// Common thresholds used by traders:
// Entry: <$100K market cap (pump.fun bonding curve)
// First exit: $500K market cap
// Second exit: $1M market cap
// Moon bag exit: $5M+ market cap
```

### Position Sizing
```
// Conservative: 0.1-0.5 SOL per trade
// Moderate: 0.5-2 SOL per trade
// Aggressive: 2-10 SOL per trade
// Win rate expectation: 30-40% (most trades lose)
// Target: 5-10x on winners to compensate
// Keep 25% as "moon bag" for massive winners
```

### AFK Mode (Nova Bot pattern)
```
// Predefined rules for 24/7 unattended trading:
// - Auto-buy on new token detection (with filters)
// - Auto-sell at take-profit levels
// - Stop-loss protection always active
// - Market cap filters for entry/exit
// - Slippage guards (15-80% configurable)
```

---

## 6. COMMERCIAL BOT ANALYSIS

### Nova Bot (Telegram)
- **Volume:** $1B+ in first 2 months
- **Speed:** Ultra V2 + Demon processors, MEV bundles via Jito
- **Features:** Pump.fun sniping (80K mcap entry), Raydium pool sniping, dev wallet sniping, copy trading (10 wallets), AFK mode, DCA, limit orders
- **Settings:** Gas 0.0005-0.002 SOL, MEV tips 0.0003-0.0015 SOL, slippage 15-80%
- **Fee:** 1% per trade
- **Anti-rug:** MEV protection, anti-rug mechanisms
- **URL:** https://docs.tradeonnova.io/

### Trojan Bot (Telegram) — Largest by Volume
- **Volume:** $24.2B lifetime, 2M+ users
- **Features:** 40-wallet copy trading, DCA, MEV protection, token blacklist, anti-rug filters, sell initials button
- **Modes:** Simple vs Advanced
- **Fee:** 0.9% (with referral) / 1% (without)
- **Multi-wallet:** Up to 10

### BONKbot (Telegram) — Simplest
- **Revenue:** $4.35M/month in fees
- **Features:** Jupiter DEX routing, auto-buy/sell, multi-wallet
- **Fee:** ~1% per swap (100% used to buy/burn BONK)
- **Best for:** Speed + simplicity, beginners

### Photon (Web Terminal)
- **Interface:** Web browser with live candlestick charts
- **Features:** One-click trading, color-coded P&L history, private node infrastructure
- **Fee:** ~1%
- **Best for:** Active chart-based traders

### Axiom Trade (Web Terminal) — 2026 Leader
- **Volume:** ~72% of Solana bot trade volume at peak
- **Features:** Multi-chain (Solana + BNB + Hyperliquid perps), wallet tracking, tweet monitor, copy trading, stop-loss/take-profit
- **Non-custodial:** Trade directly from wallet
- **Best for:** Overall trading terminal

### BullX Neo (Web Terminal)
- **Features:** Pump Vision (new token scanner + scam detection), Smart Sniper Detection, Insider Holdings monitor, multi-chart, AFK mode, Degen mode
- **Priority fee presets:** Default (0.01 SOL), Rapid, Insane, Custom
- **Fee:** 1% per spot trade

---

## 7. INFRASTRUCTURE REQUIREMENTS

### Latency Tiers

| Tier | Detection | Execution | Infrastructure |
|------|-----------|-----------|---------------|
| Competitive | gRPC Geyser (<5ms) | Jito bundles | Co-located bare-metal, ShredStream |
| Fast | gRPC (~200ms) | Multi-provider broadcast | Dedicated VPS near validators |
| Standard | WebSocket (~300ms) | Single RPC submission | Any VPS with good RPC |
| Casual | Polling (~1-3s) | Standard RPC | Any machine |

### Required Services
1. **RPC Node:** Helius, Triton, QuickNode, or self-hosted (gRPC capable)
2. **Jito Endpoint:** For bundle submission (block engine API)
3. **Geyser Stream:** Yellowstone gRPC for real-time data
4. **Redis:** For state management (D3AD-E pattern)
5. **Monitoring:** Telegram bot for alerts

### Cost Estimates
- Helius RPC (gRPC): ~$50-500/month depending on tier
- Dedicated validator proximity hosting: ~$200-2000/month
- Jito tips: variable per trade (0.001-0.01 SOL)
- Network fees: ~0.0005-0.002 SOL per trade

---

## 8. PUMP.FUN LIFECYCLE & MIGRATION

### Token Lifecycle
```
1. Token Created on pump.fun
   └─ Starts trading on bonding curve

2. Bonding Curve Phase
   └─ Price follows mathematical curve
   └─ ~$60-80K market cap range

3. Bonding Curve Completes (100%)
   └─ Token "graduates"

4. Migration to PumpSwap (current default)
   └─ Previously migrated to Raydium
   └─ Liquidity seeded to AMM pool
   └─ Open market trading begins
```

### Migration Detection
```python
# pump.fun migration account (Raydium legacy):
# 39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg

# Detection methods:
# 1. logsSubscribe — listen for migration events
# 2. gRPC stream — filter for bonding curve completion
# 3. Bitquery streaming API — full lifecycle tracking
# 4. Shyft gRPC — memcmp filter for completed curves
```

### Sniping Strategies by Phase
```
Phase 1 (Bonding Curve): Buy early on curve, sell before migration
  - Lower risk, lower reward
  - No LP rug risk (bonding curve = protocol-controlled)

Phase 2 (Migration Snipe): Buy at migration moment
  - Highest competition (bots flood pool)
  - Slippage spikes, sandwich attacks
  - Need Jito bundles + MEV protection

Phase 3 (Post-Migration): Buy on PumpSwap/Raydium
  - Lowest competition but also lowest upside
  - Standard DEX trading
```

---

## 9. RECOMMENDED ARCHITECTURE FOR TRADEWORKS

Based on this research, here is the recommended stack for our bot:

### Detection Layer
- **Primary:** Yellowstone gRPC via Helius for new pool/token events
- **Fallback:** WebSocket logsSubscribe for broader compatibility
- **Streams:** pump.fun bonding curve events + PumpSwap migrations + Raydium new pools

### Analysis Layer
- Mint authority check (must be null)
- Freeze authority check (must be null)
- Top 10 holder concentration (<25%)
- Single holder max (<10%)
- LP burn verification
- Bundle detection (insider detection)
- Dev wallet history check
- Minimum pool size threshold

### Execution Layer
- **Primary:** Jito bundles for atomic, MEV-protected execution
- **Secondary:** Multi-provider broadcast (NextBlock, Astra, etc.)
- **TX building:** Consider Rust native bindings for <5ms build time
- **Slippage:** 15-30% for memecoins (dynamic based on pool size)
- **Priority fees:** 0.005-0.01 SOL (dynamic based on competition)

### Exit Layer
- Tiered take-profit: 50% at 2x, 25% at 4x, 25% moon bag
- Trailing stop loss: 20-30% from peak
- Hard stop loss: 50% from entry
- Max hold time: configurable (default 30 minutes)
- Market cap-based exits as alternative

### Position Sizing
- Fixed SOL amount per trade: 0.1-1 SOL
- Max concurrent positions: 3-5
- Daily loss limit: 5 SOL
- Win rate target: 30-40% (compensated by 5-10x winners)

### Copy Trading Layer (Optional)
- Monitor configured whale wallets via gRPC
- Proportional position sizing (% of whale's trade)
- Latency target: <100ms from whale tx to our tx
- Blacklist wallets that show rug patterns

### Tech Stack
- **Runtime:** TypeScript (Node.js) with Rust N-API for hot paths
- **State:** Redis for position tracking, cooldowns, rate limiting
- **RPC:** Helius (gRPC + standard RPC)
- **DEX SDK:** Jupiter for routing, direct Raydium/PumpSwap for sniping
- **Alerts:** Telegram bot for notifications
- **Monitoring:** Dashboard for P&L tracking

---

## 10. KEY REPOS TO STUDY (Priority Order)

1. **fdundjer/solana-sniper-bot** — Best overall architecture reference
2. **chainstacklabs/pumpfun-bonkfun-bot** — Best pump.fun detection patterns
3. **D3AD-E/Solana-sniper-bot** — Best speed optimization patterns
4. **outsmartchad/solana-trading-cli** — Best multi-DEX framework
5. **nirholas/pump-fun-sdk** — Best pump.fun TypeScript SDK
6. **PioSol7/Solana_Copy_Trading_Bot** — Best copy trading reference

---

## Sources

- [fdundjer/solana-sniper-bot](https://github.com/fdundjer/solana-sniper-bot)
- [chainstacklabs/pumpfun-bonkfun-bot](https://github.com/chainstacklabs/pumpfun-bonkfun-bot)
- [D3AD-E/Solana-sniper-bot](https://github.com/D3AD-E/Solana-sniper-bot)
- [outsmartchad/solana-trading-cli](https://github.com/outsmartchad/solana-trading-cli)
- [nirholas/pump-fun-sdk](https://github.com/nirholas/pump-fun-sdk)
- [ahk780/pumpfun-copy-trading-bot](https://github.com/ahk780/pumpfun-copy-trading-bot)
- [PioSol7/Solana_Copy_Trading_Bot](https://github.com/PioSol7/Solana_Copy_Trading_Bot)
- [cutupdev/Solana-Copytrading-bot](https://github.com/cutupdev/Solana-Copytrading-bot)
- [DracoR22/handi-cat_wallet-tracker](https://github.com/DracoR22/handi-cat_wallet-tracker)
- [jcoulaud/pumpfun-sniping-bot](https://github.com/jcoulaud/pumpfun-sniping-bot)
- [digbenjamins/SolanaTokenSniper](https://github.com/digbenjamins/SolanaTokenSniper)
- [HZCX404/memecoin-trading-bots](https://github.com/HZCX404/memecoin-trading-bots)
- [Rabnail-SOL/Solana-Raydium-Sniper](https://github.com/Rabnail-SOL/Solana-Raydium-Sniper)
- [earthskyorg/solana-trading-bot-service](https://github.com/earthskyorg/solana-trading-bot-service)
- [iamnas/SolanaWhaleAlert](https://github.com/iamnas/SolanaWhaleAlert)
- [Nova Bot Docs](https://docs.tradeonnova.io/)
- [Nova Bot Review - Bitrue](https://www.bitrue.com/blog/nova-meme-coin-trading-bot-review)
- [Nova Bot Review - CoinCodeCap](https://coincodecap.com/nova-bot-detailed-review)
- [Top 5 Solana Trading Bots 2026](https://solanatradingbots.com/)
- [Trojan vs Bonkbot vs Sol Trading Bot](https://medium.com/coinmonks/trojan-bot-vs-bonk-bot-vs-sol-trading-bot-025b524a9c4c)
- [Photon Review 2026](https://solanatools.io/photon)
- [Axiom Trade Review 2026](https://solanatradingbots.com/axiom-trade-how-to-use/)
- [BullX Neo Guide](https://solanatradingbots.com/bullx-how-to-use/)
- [Complete Stack for Competitive Solana Sniper Bots 2026 - RPC Fast](https://rpcfast.com/blog/complete-stack-competitive-solana-sniper-bots)
- [Solana Trading Bots Guide 2026 - RPC Fast](https://rpcfast.com/blog/solana-trading-bot-guide)
- [Chainstack - Listening to pump.fun Migrations](https://docs.chainstack.com/docs/solana-listening-to-pumpfun-migrations-to-raydium)
- [Helius - How to Get Token Holders on Solana](https://www.helius.dev/blog/how-to-get-token-holders-on-solana)
- [Helius - Explore Authorities](https://www.helius.dev/docs/orb/explore-authorities)
- [Moralis Solana Top Holders API](https://docs.moralis.com/changelog/solana-top-holders-api)
- [Jito Labs Documentation](https://docs.jito.wtf/lowlatencytxnsend/)
- [BONKbot](https://bonkbot.io/)
- [Solana Tracker](https://www.solanatracker.io/)
- [CoinGecko - Solana Telegram Trading Bots](https://www.coingecko.com/learn/solana-telegram-trading-bots)
- [Best Sniper Bot for Solana Comparison](https://telegramtrading.net/best-sniper-bot-for-solana/)
