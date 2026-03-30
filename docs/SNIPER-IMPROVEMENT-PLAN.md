# TradeWorks Sniper Bot — Improvement Plan

## Research Sources
- Code audit of all 5 sniper files (types.ts, state.ts, monitoring.ts, execution.ts, index.ts)
- Reddit community strategies (r/solana, r/algotrading, r/cryptocurrency)
- Academic papers: SolRugDetector, Memecoin Fragility Framework (ME2F)
- Quantitative analysis: pump.fun graduation data, Kelly Criterion sizing
- Commercial bot analysis: Nova, Trojan, BonkBot, Photon patterns

---

## ROOT CAUSE ANALYSIS: Why The Bot Loses Money

### Problem 1: Entering Too Early (Pre-Graduation)
- **Current**: Buys on pump.fun bonding curve at $5K-$30K mcap
- **Reality**: 98.6% of pump.fun tokens never graduate. Buying pre-graduation = 98.6% chance of total loss
- **Fix**: Add post-graduation filter option. The graduation event ($69K-$100K mcap) is the strongest free signal — it means real demand exists

### Problem 2: Exits Are Broken
- **Current**: Tiered exits DISABLED by default. 3-minute max hold. -12% stop loss
- **Reality**: -12% stop is too tight for volatile memecoins (normal noise = ±15-20%). 3-min max hold kills tokens that pump over 10-30 min. No partial profit-taking = all-or-nothing
- **Fix**: Enable tiered exits by default, widen stop to -30-50%, extend max hold to 30 min, implement time-based stops (no 1.2x in 5 min = exit)

### Problem 3: Fake Momentum Passes Gate
- **Current**: 3 unique buyers + 2.5x buy/sell ratio in 5s window
- **Reality**: Sybil wallets trivially fake 3 "unique" buyers. Bundled snipers coordinate same-block buys. 5s window is too short to distinguish real vs fake demand
- **Fix**: Require 8-10 unique buyers, extend window to 15-30s, add wallet age/history scoring, detect bundle patterns

### Problem 4: Position Sizing Too Small
- **Current**: 0.01 SOL per trade ($1.30). Fees + slippage eat 3-5% per round trip
- **Reality**: Need 0.1-0.5 SOL to overcome friction. Half-Kelly = ~5% of trading wallet
- **Fix**: Increase default buy amount, enable dynamic sizing, use Half-Kelly

### Problem 5: No MEV Protection
- **Current**: Jito code exists but is TODO — not wired in
- **Reality**: Without Jito bundles, every buy gets sandwiched by MEV bots
- **Fix**: Wire Jito integration into buy/sell execution path

### Problem 6: No Creator Intelligence
- **Current**: Tracks creator deploy count per hour (max 3) but only logs, doesn't block
- **Reality**: Serial rug deployers launch 10+ tokens/day from related wallets
- **Fix**: Hard-block known serial deployers, track wallet clusters, share blocklist across templates

---

## IMPROVEMENT TIERS

### TIER 1: Critical Fixes (Biggest Impact, Do First)

#### 1.1 — Fix Default Template Parameters
**Files**: `state.ts` (template seed defaults)
```
OLD → NEW
takeProfitPercent:        50  →  100  (sell at 2x, not 1.5x)
stopLossPercent:         -12  →  -35  (widen for memecoin volatility)
maxPositionAgeMs:     180000  →  1800000  (30 min, not 3 min)
stalePriceTimeoutMs:   60000  →  180000  (3 min, not 1 min)
buyAmountSol:           0.01  →  0.05  (meaningful size)
enableTieredExits:     false  →  true  (MUST be on)
momentumWindowMs:       5000  →  15000  (15s observation)
minUniqueBuyers:           3  →  6  (harder to fake)
minBuySellRatio:         2.5  →  3.0  (stronger signal)
minBuyVolumeSol:         0.3  →  1.0  (real money, not dust)
slippageBps:             800  →  1500  (15% for new tokens)
maxOpenPositions:          5  →  8
```

#### 1.2 — Fix Tiered Exit Defaults
```
OLD → NEW
exitTier1PctGain:    50  →  100   (sell first batch at 2x)
exitTier1SellPct:    30  →  50    (recover full cost at 2x)
exitTier2PctGain:   100  →  400   (sell more at 5x)
exitTier2SellPct:    30  →  25
exitTier3PctGain:   200  →  900   (sell more at 10x)
exitTier3SellPct:    30  →  15
exitTier4PctGain:   500  →  4900  (50x moonshot)
exitTier4SellPct:   100  →  100   (close remainder)
```
Philosophy: Recover cost at 2x, DCA out on the way up, keep 10% moon bag.

#### 1.3 — Add Time-Based Stop (No-Pump Exit)
**Files**: `monitoring.ts` (checkPositions loop)
- NEW: If position age > 5 minutes AND gain < 20%, force exit
- NEW: If position age > 15 minutes AND gain < 50%, force exit
- Rationale: Tokens that don't pump in 5 min rarely pump at all. Dead money = opportunity cost

#### 1.4 — Wire Jito Bundle Support
**Files**: `execution.ts`
- The `submitViaJito()` function already exists
- Need to: get raw unsigned tx from PumpPortal, sign locally, bundle with Jito tip, submit
- Prevents sandwich attacks on every buy/sell
- Jito tip: 0.01-0.05 SOL (adaptive based on network congestion)

### TIER 2: Scoring & Intelligence (Medium Impact)

#### 2.1 — Multi-Factor Token Score (0-100)
Replace the current all-or-nothing gates with a weighted scoring system:

```
Score Component          Weight  Source
─────────────────────────────────────────
Holder growth rate         20    On-chain (unique buyers over time)
Volume acceleration        20    Trade events (volume delta)
Buy/sell ratio             15    Trade events
Social signals             15    Twitter API / Telegram (future)
Whale accumulation         15    Top wallet tracking
Liquidity depth            10    Bonding curve SOL
Token age penalty           5    Newer = riskier

Entry threshold: Score >= 65 AND risk score < 40
```

#### 2.2 — Bundle / Sybil Detection
**New logic in momentum gate:**
- Track wallet ages via Helius DAS (wallets < 24h old = sybil flag)
- Detect same-slot buys from multiple wallets (bundle pattern)
- If bundled wallets hold >15% of supply → REJECT
- Weight "unique buyers" by wallet history (old wallet = 1.0, new wallet = 0.2)

#### 2.3 — Creator Intelligence System
**New module: `creator-intel.ts`**
- Maintain persistent creator database (deployer address → history)
- Track: tokens launched, graduation rate, average token lifespan, rug count
- Hard-block creators with >3 launches in 24h and <10% graduation rate
- Cluster related wallets (fund source analysis)

#### 2.4 — Post-Graduation Filter (Optional Mode)
**New template type: "Graduation Sniper"**
- Only buys tokens that have graduated from bonding curve to DEX
- Entry at $100K-$500K mcap (the 1.4% that survived)
- Higher confidence, larger position size (0.1-0.5 SOL)
- Wider stops (-50%), longer holds (1 hour)
- Much higher win rate expected (30-40% vs current ~10%)

### TIER 3: Advanced Features (High Effort, High Reward)

#### 3.1 — Smart Money / Whale Copy Trading
- Track wallets with >60% win rate over 100+ trades
- Signal: 3+ tracked wallets buying same token within 5 min
- Use GMGN or Nansen APIs for wallet labels
- Create "Follow Smart Money" template

#### 3.2 — Adaptive Priority Fees
- Current: Fixed 400K microlamports
- New: Check recent block base fees, add dynamic premium
- Calm network: 0.001 SOL
- Congested: scale up to 0.1 SOL
- Use getRecentPrioritizationFees() RPC method

#### 3.3 — Honeypot Pre-Check
- Before buying: simulate a buy+sell via Jupiter quote API
- If sell quote returns >50% slippage or fails → honeypot, skip
- Adds ~200ms latency but prevents total loss on honeypots

#### 3.4 — On-Chain Authority Verification
- Current: Trusts RugCheck API (2s timeout, can be skipped)
- New: Direct on-chain check of mint authority and freeze authority
- Use getParsedAccountInfo() — no external API dependency
- ~50ms latency, 100% reliable

#### 3.5 — ML Token Classification (Future)
- Collect labeled dataset: (token features) → (outcome: pump/rug/flat)
- Features: holder distribution, volume pattern, creator history, social signals
- XGBoost classifier for pump/no-pump prediction
- Train on historical execution data
- Gate buys on model confidence > 0.7

---

## IMPLEMENTATION PRIORITY ORDER

| Priority | Change | Impact | Effort | Files |
|----------|--------|--------|--------|-------|
| P0 | Fix template defaults | HIGH | LOW | state.ts |
| P0 | Enable tiered exits | HIGH | LOW | state.ts |
| P0 | Add time-based no-pump exit | HIGH | LOW | monitoring.ts |
| P1 | Wire Jito bundles | HIGH | MED | execution.ts |
| P1 | Widen momentum window + raise thresholds | HIGH | LOW | state.ts, monitoring.ts |
| P1 | Bundle/sybil detection | MED | MED | monitoring.ts (new) |
| P2 | Multi-factor scoring | MED | MED | new: token-scorer.ts |
| P2 | Creator intelligence | MED | MED | new: creator-intel.ts |
| P2 | Post-graduation template | MED | LOW | state.ts |
| P2 | On-chain authority check | MED | LOW | monitoring.ts |
| P3 | Honeypot pre-check | MED | LOW | execution.ts |
| P3 | Adaptive priority fees | LOW | LOW | execution.ts |
| P3 | Smart money tracking | HIGH | HIGH | new module |
| P4 | ML classification | HIGH | VERY HIGH | new service |

---

## EXPECTED OUTCOME

### Current Performance (Estimated)
- Win rate: ~10-15%
- Average win: +50% (1.5x)
- Average loss: -12% (tight stop)
- Net EV per trade: NEGATIVE (too many small losses, not enough big wins)
- Position size: 0.01 SOL (fees eat profits)

### After Tier 1 Fixes
- Win rate: ~20-25% (better filtering, wider stops)
- Average win: +100-200% (tiered exits capture runners)
- Average loss: -35% (wider but realistic stop)
- Net EV per trade: ~BREAKEVEN to slightly positive
- Position size: 0.05 SOL (meaningful)

### After Tier 1 + 2
- Win rate: ~30-35% (scoring, bundle detection, creator intel)
- Average win: +150-300% (better token selection)
- Average loss: -35%
- Net EV per trade: POSITIVE (~$0.15-0.30 per dollar risked)
- With post-graduation filter: 35-40% win rate

### After All Tiers
- Win rate: ~40%+ (ML, smart money, full intelligence)
- Comparable to advanced bot users (74% for insiders is the ceiling)
- Sustainable monthly: 15-30% ROI on trading capital

---

## KEY PRINCIPLES (From Research)

1. **Ten 2x trades beat one 100x** — consistent small wins compound faster than moonshots
2. **Recover cost at 2x** — sell 50% at first double, play with house money
3. **Time is the enemy** — if it hasn't pumped in 5 min, it probably won't
4. **The graduation filter is free alpha** — 98.6% of tokens eliminated automatically
5. **Fake momentum is the #1 killer** — sybil wallets and bundles trick simple gates
6. **Wider stops = higher win rate** — -12% is noise, -35% is conviction
7. **Position size matters** — 0.01 SOL doesn't overcome friction
8. **Jito is mandatory** — without MEV protection, you're donating to sandwich bots
9. **Creator history > token metrics** — a good deployer's worst token > a bad deployer's best
10. **Paper mode lies** — test with real money (small amounts) to account for slippage, MEV, timing
