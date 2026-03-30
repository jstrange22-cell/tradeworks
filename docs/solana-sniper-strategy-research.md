# Solana Memecoin Sniping Strategy Research
## Compiled: March 29, 2026

---

## 1. ENTRY SIGNALS — What Separates Winners from Losers

### The Core Truth
Only ~10% of sniper bots achieve sustainable profitability. The difference is NOT just speed — it's **filtering + risk management + disciplined exits**. Blind sniping bleeds SOL on fees and rug pulls.

### Entry Signal Checklist (ALL must pass)

| Signal | Threshold | Rationale |
|--------|-----------|-----------|
| Bonding curve progress | > 30% | Filters out 90% of dead-on-arrival tokens |
| Token age | < 30 minutes | Fresh tokens with momentum |
| Market cap | $9K - $69K (pre-graduation) | Sweet spot before Raydium/PumpSwap migration |
| Volume/holder growth | Consistent uptrend | Organic interest signal |
| Dev wallet holding | < 5% of supply | Lower rug risk |
| Top 10 holders | < 30% of supply combined | Decentralized distribution |
| Mint authority | Renounced | Cannot mint more tokens |
| Freeze authority | None | Cannot freeze your tokens |
| Metadata | Immutable | Cannot change token info post-launch |
| Socials | At least 1 (Twitter/Telegram/Website) | Minimum legitimacy signal |
| LP tokens | Burned or locked 30+ days | Cannot pull liquidity |
| Bubble map | No connected wallets to dev | No bundled wallets |

### What Winners Do Differently
- **Thematic filtering**: Targeting specific narratives (AI, political, animal) during high-volume periods produces higher ROI and fewer rug exposures than unfiltered sniping
- **Watch fewer tokens, act faster**: High-conviction plays on filtered tokens beat spraying buys across dozens of random launches
- **Copy trading as signal source**: Mirror wallets with > 70% win rate, but always apply your own filters on top

---

## 2. MARKET CAP RANGES — Optimal Entry Zones

### Pump.fun Lifecycle

| Phase | Market Cap | Risk Level | Strategy |
|-------|-----------|------------|----------|
| **Birth** | $0 - $5K | EXTREME | Only with perfect filter match. Most tokens die here. |
| **Early Traction** | $5K - $30K | VERY HIGH | Primary snipe zone. Best R:R ratio. 65-70% will still rug. |
| **Pre-Graduation** | $30K - $69K | HIGH | Safer entry, tokens showing real traction. Graduation at ~$69K FDMC. |
| **Post-Graduation** | $69K - $500K | MEDIUM-HIGH | Migrated to PumpSwap/Raydium. Real liquidity ($12K+ deposited). Established momentum. |
| **Established Micro** | $500K - $5M | MEDIUM | More predictable, lower multiples. 2-5x targets realistic. |
| **Mid Cap Meme** | $5M - $50M | MODERATE | Institutional-adjacent. 1.5-3x targets. Lower rug risk. |

### Key Numbers
- Pump.fun graduation threshold: **~$69,000 FDMC**
- Liquidity deposited at graduation: **~$12,000** (previously ~85 SOL)
- Tokens on bonding curve: **800M of 1B** total supply
- Migration fee: **Eliminated** with PumpSwap (was 6 SOL -> 1.5 SOL on Raydium)
- PumpSwap trade fee: **0.25%** (0.2% to LPs, 0.05% to protocol)

### Optimal Entry
- **For sniping bots**: $5K - $30K market cap, within first 20 transactions or < 20 seconds of pool launch
- **For manual/filtered trades**: $30K - $200K range where tokens have proven initial traction

---

## 3. TAKE-PROFIT & STOP-LOSS — Concrete Numbers

### Stop-Loss Settings

| Strategy Type | Stop-Loss | Notes |
|--------------|-----------|-------|
| Quick scalp (< 3 min hold) | -10% | Tight stop, accept frequent stops |
| Standard snipe | -15% | Most common recommendation |
| High-conviction play | -25% to -30% | Only with strong filter signals |
| Copy trade | -10% to -15% | Mirror the tracked wallet's behavior |

### Take-Profit Framework (DCA Out)

| Milestone | Action | Remaining Position |
|-----------|--------|-------------------|
| **+25% to +40%** | Sell 25% (or recover fees) | 75% |
| **+100% (2x)** | Sell 50% of original (recover initial) | ~50% (all house money now) |
| **+200% (3x)** | Sell another 25-30% | ~20-25% |
| **+400% (5x)** | Sell another 10-15% | 10-15% moon bag |
| **+1000% (10x)+** | Let moon bag ride or set trailing stop | 5-10% |

### The "2x Take Initials" Rule
This is the single most cited rule across all sources:
- At **2x**, sell half your position. You now have zero risk.
- Everything remaining is "house money" — let it ride with a trailing stop.
- This single rule prevents the #1 mistake: being up 5x, holding for 20x, watching it crash to zero.

### Time-Based Exits
- If neither TP nor SL hit within **30 seconds to 3 minutes**, sell
- Meme coins typically only pump once — if momentum stalls, exit
- Volume drop = exit signal regardless of P&L

### Auto-Sell Configuration (Trojan/Bot Settings)
- TP at +25%, then another +25% increment
- SL at -10% to -30% (varies by risk tolerance)
- Bonding curve sell: sell 75% if bonding curve reaches critical level, keep 25% as moon bag
- Timeout sell: auto-close if no TP/SL triggered within set time

---

## 4. RUG DETECTION — How to Filter Scams

### Automated Pre-Buy Checks (MUST PASS ALL)

```
CHECK_IF_MUTABLE = false        // Only buy if metadata is immutable
CHECK_IF_SOCIALS = true         // Must have at least 1 social
CHECK_IF_MINT_RENOUNCED = true  // Mint authority must be renounced
CHECK_IF_FREEZABLE = false      // Must not be freezable
CHECK_IF_BURNED = true          // LP must be burned
```

### Red Flags — Skip Immediately

| Red Flag | Why |
|----------|-----|
| Top 10 wallets connected to dev (bundled) | Classic rug setup |
| Single wallet > 5% supply (excl. locked LP) | Dump risk |
| Low liquidity (< 1 SOL initial) | Bait for bots |
| Missing or weird metadata (no name/symbol) | Scam token |
| No socials whatsoever | Zero effort project |
| Unlocked mint authority | Can print infinite tokens |
| Freeze authority present | Can freeze your wallet |
| Sudden large price move with no news | Manipulation |
| Coordinated social media hype with no dev activity | Pump-and-dump |

### Verification Tools (Use 2-3 Per Token)
1. **RugCheck.xyz** — Primary Solana token scanner
2. **Token Sniffer** — 100-point scoring system (avoid tokens < 80)
3. **Honeypot.is** — Detects sell-blocking contracts
4. **SolanaFM** — Explorer with authority analysis
5. **Bubble Maps** — Visualize holder connections

### Rug Pull Statistics
- **65-70%** of new Solana meme coins rug or die within 72 hours
- Pump.fun tokens: **~55-60%** rug rate (lower due to bonding curve protections)
- Direct contract launches: **>80%** rug rate
- Scammers almost always remove **90%+** of liquidity in a single sweep
- Most rug creators start with **30-60 SOL** to establish false legitimacy

### Critical Exit Signals (Sell Immediately)
- Liquidity being removed or unlocked
- Inability to sell (honeypot activation)
- Mint authority being used to create new tokens
- Coordinated dumps by top holders
- Developer wallet selling

---

## 5. OPTIMAL HOLD TIME

| Strategy | Hold Time | Target Return | Win Rate Goal |
|----------|-----------|---------------|---------------|
| Ultra-fast scalp | 30 sec - 1 min | +15-25% | 55-60% |
| Standard snipe | 1 - 3 min | +25-100% | 45-55% |
| Momentum ride | 3 - 15 min | +100-300% | 35-45% |
| Narrative play | 15 min - 2 hrs | +200-500% | 25-35% |
| Moon bag hold | Hours - days | +500-5000% | 10-15% |

### Key Insight
- Most memecoin pumps are **one-time events** — they pump once and crash. Do not expect a bounce.
- Selling durations of **30 seconds to 3 minutes** are the sweet spot for automated sniping
- The vast majority of profits come from the first 1-5 minutes of a token's life
- If a token hasn't moved meaningfully in 5 minutes post-launch, it likely won't

---

## 6. POSITION SIZING & RISK PER TRADE

### Bankroll Allocation

| Rule | Value | Notes |
|------|-------|-------|
| Per-trade risk | **0.5-1% of total portfolio** (conservative) | Recommended for beginners |
| Per-trade risk | **2-5% of trading bankroll** (moderate) | For experienced traders |
| Per-trade risk | **5-10% of dedicated snipe wallet** (aggressive) | Max recommended by any source |
| Trading wallet funding | Separate from main holdings | NEVER use main wallet |
| Starting test size | **0.02 SOL** per snipe | Common bot default for testing |
| Typical snipe size | **0.1 - 0.5 SOL** | Standard range for active sniping |
| High-conviction play | **0.5 - 2 SOL** | Only with maximum filter confidence |

### Kelly Criterion Approximation for Meme Sniping
Given typical parameters:
- Win rate: ~40% on filtered plays
- Average win: 2x (100% gain)
- Average loss: -15% (with stop loss)

Kelly fraction = (0.40 * 1.00 - 0.60 * 0.15) / 1.00 = 0.31 (31%)

Half-Kelly (recommended): **~15% of bankroll per trade** — but this is aggressive. Most experienced traders use 2-5% for memecoins due to high variance.

---

## 7. LIQUIDITY THRESHOLDS

### Minimum Liquidity Requirements

| Context | Minimum Liquidity | Recommended |
|---------|-------------------|-------------|
| Pump.fun bonding curve | N/A (built-in) | Trust the curve |
| Post-graduation (PumpSwap) | $12K (auto-deposited) | $12K+ is baseline |
| Raydium/Meteora direct | > 5 SOL | > 10 SOL preferred |
| For larger positions (> 1 SOL) | > $50K liquidity | Ensures manageable slippage |

### Liquidity Red Flags
- Initial liquidity < 1 SOL = bait trap
- LP tokens NOT burned or locked = rug ready
- If LP locked, minimum lock duration should be **30+ days** (90+ days = stronger)
- At least **80%** of initial liquidity should be locked
- Monitor for liquidity removal events — exit immediately on detection

---

## 8. PARTIAL EXIT / DCA-OUT STRATEGY

### The Tiered Exit Framework

```
Position: 1 SOL buy at launch

Step 1 (at +25-40%):  Sell 0.25 SOL  → Recovered 25% + fees
Step 2 (at 2x):       Sell 0.50 SOL  → Recovered full initial
Step 3 (at 3x):       Sell 0.50 SOL  → Locked 1.5 SOL profit
Step 4 (at 5x+):      Sell 0.25 SOL  → Another 1.25 SOL profit
Moon bag:              Hold 0.25 SOL  → Free ride, potential 10-100x
```

### Real-World Execution
- Use auto-sell / limit orders to set exits BEFORE you buy
- Trojan, Axiom, Photon all support pre-configured exit ladders
- DCA out just like you DCA in — don't exit all at once
- Lower priority/bribe fees for sells (not time-critical like buys)
- Monitor exit buyers via wallet scanner — if smart money is selling, follow

### The "10 Solid 2x" Philosophy
Repeatedly cited by profitable traders: Hitting 10 consecutive 2x trades grows your stack faster than chasing a single 100x (which statistically you'll miss or get rugged on).

---

## 9. COMMON MISTAKES — Why Sniper Bots Lose Money

### The Top 10 Capital Destroyers

1. **Using public/slow RPC** — You're 1-2 slots behind, buying at 3-5x inflated prices
2. **Blind sniping without filters** — Buying every new token = buying 65-70% rug pulls
3. **Over-leveraging after wins** — Dramatically increasing size after a streak, then one rug wipes it all
4. **Ignoring fee calculations** — Bot fees (1%), network fees, slippage, Jito tips can turn winners into losers
5. **No stop-loss** — Holding through -50%, -80%, -100% instead of cutting at -10-15%
6. **Holding for "moon" without a plan** — Being up 5x, refusing to sell, watching it crash to zero
7. **Using main wallet** — One compromised bot interaction = entire portfolio at risk
8. **Going all-in on one trade** — Single rug pull = game over
9. **Switching strategies constantly** — Not allowing a system time to prove itself
10. **Not understanding MEV** — Getting sandwiched on every trade, paying 5-10% hidden tax

### The Math of Failure
- If 65% of tokens rug and you snipe blindly:
  - 100 snipes at 0.1 SOL each = 10 SOL deployed
  - 65 losses at -100% = -6.5 SOL
  - 35 wins need to average +19% just to break even
  - After fees (1% bot + gas + tips), you need +25-30% average win just to survive
  - This is why filtering is not optional — it's survival

---

## 10. RISK MANAGEMENT — The Complete Framework

### Daily Loss Limits

| Level | Daily Loss Limit | Action |
|-------|-----------------|--------|
| Conservative | 3% of bankroll | Stop trading for the day |
| Moderate | 5% of bankroll | Reduce position sizes by 50% |
| Aggressive | 10% of bankroll | Hard stop, no exceptions |

### Drawdown Management

| Drawdown Level | Response |
|---------------|----------|
| -10% from peak | Review strategy, reduce size by 25% |
| -15% from peak | Cut size by 50%, tighten filters |
| -20% from peak | Pause automated trading, manual only |
| -25% from peak | Full stop. Review everything before resuming. |

### Circuit Breakers (For Bot Implementation)

```typescript
interface RiskControls {
  maxDailyLoss: number;        // 5% of bankroll
  maxPerTradeLoss: number;     // 0.5-1% of bankroll
  maxOpenPositions: number;    // 3-5 concurrent
  maxDailyTrades: number;      // 20-50 depending on strategy
  maxConsecutiveLosses: number; // 5 — then pause 1 hour
  maxSlotSpend: number;        // Per-slot fee ceiling
  cooldownAfterLoss: number;   // 60 seconds min between trades after loss
  stopLossPercent: number;     // -10 to -15%
  takeProfitLevels: number[];  // [25, 100, 200, 500]
  trailingStopPercent: number; // 15-20% from local high
}
```

### Sharpe Ratio Target
- Professional trading operations target **Sharpe ratio > 1.5**
- Track your trades meticulously — if Sharpe drops below 1.0, pause and reassess
- Maximum drawdown target: **< 15%** before forced review

---

## 11. BOT CONFIGURATION SETTINGS — Quick Reference

### Execution Settings

| Parameter | Testing/Low Competition | Live/High Competition |
|-----------|------------------------|----------------------|
| **Slippage** | 0.3-5% | 10-30% |
| **Priority Fee** | 0.001 SOL | 0.03-0.1 SOL |
| **Jito Tip** | 0.005 SOL | 0.01-0.1 SOL |
| **Compute Units** | 200,000 | 200,000 |
| **Buy Amount** | 0.02 SOL | 0.1-0.5 SOL |
| **Price Check Interval** | 500-1000ms | 500ms |
| **MEV Protection** | Secure mode | Reduced or Secure |
| **Commitment** | processed | processed |

### Fee Split Rule (Trojan)
If you want to pay 0.1 SOL total in fees: **20% gas / 80% tip** (0.02 SOL gas + 0.08 SOL Jito tip)

### Timing Targets
- Detect-to-execute pipeline: **< 150ms** (elite) / < 500ms (competitive)
- Target entry: Within first **5-20 transactions** or **< 20 seconds** of pool launch
- Missing one Solana slot (~400ms) increases costs by **15-25%**

---

## 12. COPY TRADING & WALLET TRACKING

### Top Tracking Tools
1. **GMGN Monitor** — Real-time insider wallet categorization (KOLs, whales, smart money)
2. **Nansen** — AI-labeled smart money wallets (free tier available)
3. **Axiom Trade** — Leaderboards by PNL, win rate, volume
4. **KOLSCAN** — Free Solana wallet tracker focused on top memecoin traders
5. **Cielo Finance** — Cross-chain wallet tracking with Telegram alerts
6. **Birdeye** — Real-time tracking of whale movements
7. **Dune Analytics** — Custom SQL dashboards for wallet analysis

### Wallet Selection Criteria
- Win rate > 70% on memecoin trades
- Consistent returns (not one lucky hit)
- Mix of buys AND sells (not just accumulation)
- Varied transaction sizes (not uniform = not bot)
- No coordinated transfers with other wallets
- Whales: typically $1M+ in assets on Solana

### What to Watch For
- Whale accumulation during price drops = conviction signal
- Gradual selling into strength = exit strategy in progress
- First 70 buyers/snipers on a token often predict massive pumps
- Synchronized transfers across wallets = insider activity

---

## 13. INFRASTRUCTURE STACK (For Custom Bot)

### Minimum Viable Stack
- **Language**: TypeScript (faster to iterate) or Rust (maximum performance)
- **Libraries**: @solana/web3.js, Jito-ts, Jupiter V6 SDK
- **RPC**: Dedicated endpoint (NOT public) — QuickNode, Helius, Triton, RPC Fast
- **WebSocket**: Essential for real-time account/program event updates
- **Transaction routing**: Jito bundles for MEV protection
- **Monitoring**: Real-time P&L tracking, latency monitoring

### 2026 Competitive Edge Requirements
- Private RPC with Geyser plugin access
- ShredStream integration
- Validator co-location (sub-40ms)
- Dynamic priority fee algorithm based on real-time congestion
- Randomized timing offsets to avoid pattern detection
- Varied tip ladders to avoid copy-trading

---

## 14. RECOMMENDED BOT PLATFORMS (If Not Building Custom)

| Bot | Speed | Best For | Fee |
|-----|-------|----------|-----|
| **Trojan** | 8/10 | Serious traders, feature-rich | ~1% |
| **Axiom Trade** | 8/10 | Analytics + sniping + copy trading | ~1% |
| **BullX NEO** | 8/10 | Multi-chain, speed-focused | ~1% |
| **GMGN** | 7/10 | New-token feeds, copy trading, Anti-MEV | ~1% |
| **Banana Gun** | 8/10 | Veteran choice, honeypot checks | ~0.5-1% |
| **BonkBot** | 7/10 | Beginners, sub-0.5ms execution | ~1% |
| **Photon** | 7/10 | Pump.fun-focused, limit orders | ~1% |
| **MEVx** | 8/10 | AI-driven strategies, anti-rug | ~1% |

---

## 15. STRATEGY SUMMARY — The Playbook

### Pre-Session
1. Fund dedicated trading wallet (separate from main)
2. Set daily loss limit (5% of bankroll)
3. Configure filters (all rug checks ON)
4. Set auto-sell ladders (TP at 2x, 3x, 5x; SL at -15%)

### During Trading
5. Monitor filtered feed (bonding curve > 30%, socials present, dev holding < 5%)
6. Entry: 0.1-0.5 SOL per snipe in the $5K-$30K market cap zone
7. Verify with RugCheck + Token Sniffer before buying (or automate checks)
8. Execute within first 20 transactions of launch

### Post-Entry
9. At +25-40%: Sell 25% (recover fees)
10. At 2x: Sell 50% of original (recover initial — now risk-free)
11. At 3x+: Take more profit, leave 10-25% moon bag
12. Hard SL: Exit at -10% to -15% — no negotiation

### Post-Session
13. Journal every trade (entry, exit, filters passed, result)
14. Review daily P&L and Sharpe ratio
15. If hit daily loss limit — STOP. No revenge trading.

---

## Sources

- [Trojan: Best Solana Sniper Bot Strategy for 2026](https://trojan.com/blog/best-solana-sniper-bot-strategy-for-2026)
- [RPC Fast: Top Solana Sniper Bots 2026](https://rpcfast.com/blog/top-solana-sniper-bot)
- [RPC Fast: Complete Stack for Competitive Bots](https://rpcfast.com/blog/complete-stack-competitive-solana-sniper-bots)
- [Dysnix: Production-Grade Sniper Bot Blueprint](https://dysnix.com/blog/complete-stack-competitive-solana-sniper-bots)
- [QuickNode: Master Solana Sniper Bots 2025](https://blog.quicknode.com/master-the-solana-sniper-bots-tips-and-strategies-for-2025/)
- [QuickNode: Top 10 Solana Sniper Bots 2026](https://www.quicknode.com/builders-guide/best/top-10-solana-sniper-bots)
- [CryptoNews: 6 Best Solana Sniper Bots 2026](https://cryptonews.com/cryptocurrency/best-solana-sniper-bots/)
- [CoinCodeCap: Pump.fun Sniper Bot Guide](https://coincodecap.com/pump-fun-sniper-bot-guide)
- [Flashift: Pump.fun Strategy 2026 — Find Gems, Avoid Rugs](https://flashift.app/blog/how-to-spot-the-next-viral-meme-coin-on-pump-fun-safely/)
- [Flintr: Anatomy of a Rug Pull on Pump.fun](https://www.flintr.io/articles/anatomy-of-a-rug-pull-identify-scams-on-pumpfun)
- [Solidus Labs: Solana Rug Pulls Compliance Report](https://www.soliduslabs.com/reports/solana-rug-pulls-pump-dumps-crypto-compliance)
- [Flashift: Bonding Curve Mechanics](https://flashift.app/blog/bonding-curves-pump-fun-meme-coin-launches/)
- [Medium/Coinmonks: 2 SOL to 15 SOL Guide](https://medium.com/coinmonks/how-i-turned-2-sol-into-15-sol-trading-meme-coins-the-complete-2025-guide-to-sniping-filtering-5dca599f27bf)
- [Medium/Bytesavvy: $2,400 in 30 Days Trading Meme Coins](https://medium.com/@bytesavvy02/how-i-made-2-400-in-30-days-trading-meme-coins-on-solana-ffaef3e8b95a)
- [Zerion: How to Trade Solana Meme Coins](https://zerion.io/blog/how-to-trade-solana-meme-coins-a-guide/)
- [CoinLedger: Solana Memecoin Beginner's Playbook 2026](https://coinledger.io/learn/solana-memecoin)
- [MEVx: Solana Meme Coin Sniper Bots](https://blog.mevx.io/memecoin/solana-meme-coin-sniper-bots)
- [Nansen: How to Track Solana Wallets](https://www.nansen.ai/post/how-to-track-solana-wallets-complete-guide-for-smart-money-analysis)
- [Velvosoft: Best Sniper Bots That Actually Profit](https://velvosoft.com/blogs/best-sniper-bots-guide/)
- [Medium/Yavorovych: Why 90% of Sniper Bots Fail](https://yavorovych.medium.com/how-to-build-a-solana-sniper-bot-and-why-90-fail-the-infra-hack-that-wins-0cbfbbf76a8d)
- [Trojan Docs: Sniper Settings](https://docs.trojanonsolana.com/telegram-bot-user-guide/sniper)
- [Axiom Pro: Sniper Bot](https://axiompro.app/sniper/)
- [Blocmates: PumpSwap Launch](https://www.blocmates.com/news-posts/pump-fun-introduces-pumpswap-a-new-dex-for-graduated-token-listings)
