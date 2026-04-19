---
name: apex-trade-analyzer
description: >
  Full multi-dimensional trade analysis for any ticker, token, or instrument.
  Covers fundamental analysis, technical analysis, sentiment, options flow,
  macro context, and generates a structured trade thesis with entry/stop/target.
  Invoke with: "analyze [TICKER]" or "@apex analyze [instrument]"
---

# APEX Trade Analyzer

You are executing a complete APEX trade analysis. Be methodical. Be honest.
If the thesis is weak, say so — bad trades cost more than missed trades.

## ANALYSIS FRAMEWORK

When given a ticker or instrument, work through all seven layers:

### LAYER 1: INSTRUMENT OVERVIEW
- What does this company/asset do?
- What sector/category does it belong to?
- Current price, 52-week range, market cap (equities) or market cap/FDV (crypto)
- Recent major news (last 30 days)

### LAYER 2: FUNDAMENTAL ANALYSIS (Equities Only)

**Valuation Metrics:**
- P/E ratio vs. sector median
- Forward P/E (next 12 months estimated earnings)
- EV/EBITDA vs. 5-year historical average
- Price/Free Cash Flow
- Revenue growth rate (YoY and QoQ)
- Gross margin trend
- Net debt/EBITDA

**Quality Signals:**
- Return on Equity (ROE > 15% = quality)
- Return on Invested Capital (ROIC > cost of capital = value creation)
- Insider ownership and recent insider transactions
- Institutional ownership changes (13F filings)

**Red Flags:**
- Rising accounts receivable faster than revenue
- Declining gross margins
- Share count increasing >5% annually (dilution)
- Debt increasing while earnings declining

**Verdict:** UNDERVALUED / FAIRLY VALUED / OVERVALUED with brief reasoning

### LAYER 3: TECHNICAL ANALYSIS

**Trend Structure:**
- Is price making higher highs and higher lows (uptrend) or the reverse?
- Price vs. 20 EMA, 50 EMA, 200 SMA — above or below?
- Market structure: is the trend intact or broken?

**Key Levels:**
- Nearest support zone (where buyers are likely to step in)
- Nearest resistance zone (where sellers are likely to emerge)
- Volume profile: where is the high-volume node? Price respects this.

**Momentum:**
- RSI(14): <30 oversold, >70 overbought, divergences are signals
- MACD: crossover direction, histogram shrinking or expanding?
- Volume: confirming or diverging from price?

**Pattern Recognition:**
- Any recognizable chart pattern? (Flag, Cup&Handle, Head&Shoulders, etc.)
- If pattern present, what is the measured move target?

**Verdict:** STRONG UPTREND / WEAK UPTREND / RANGE / DOWNTREND

### LAYER 4: SENTIMENT & CATALYST ANALYSIS

**News Sentiment:**
- Tone of recent coverage (positive/negative/neutral)
- Any upcoming catalysts? (Earnings, FDA decision, FOMC, product launch)
- Social media sentiment trend (rising or falling interest)

**Institutional Activity:**
- Recent 13F changes — are large funds buying or selling?
- Dark pool prints — unusual large block trades?
- Short interest — is it rising (bearish pressure) or falling (short squeeze potential)?

### LAYER 5: OPTIONS MARKET INTELLIGENCE (Equities)

- Put/call ratio on this specific ticker (>1 = bearish, <0.7 = bullish)
- IV Rank: what percentile is implied volatility vs. last 52 weeks?
  - IV Rank > 50: sell premium (covered calls, cash-secured puts)
  - IV Rank < 30: buy options (debit spreads, long calls/puts)
- Any unusual large options positions recently placed?
- Gamma walls: where are large options strikes concentrated? Price tends to gravitate toward or pin to these.

### LAYER 6: MACRO CONTEXT

- How does this fit into the current macro environment?
  - Is the Fed hiking or cutting? (Affects growth stocks significantly)
  - Is the dollar strong or weak? (Affects commodities, international revenue)
  - Credit spreads widening or tightening? (Risk-on vs. risk-off)
- Is this asset class in/out of favor with the current regime?

### LAYER 7: RISK ASSESSMENT

**Bull Case:** What needs to be true for this trade to win?
**Bear Case:** What could go wrong? What would invalidate the thesis?
**Max Loss:** Where does the thesis break down on a chart? That is your stop.

---

## TRADE THESIS OUTPUT FORMAT

After completing all layers, output the structured thesis:

```
═══════════════════════════════════════
APEX TRADE THESIS: [TICKER]
Date: [DATE]
═══════════════════════════════════════

CONVICTION: HIGH / MEDIUM / LOW
DIRECTION: LONG / SHORT / NEUTRAL
TIMEFRAME: [days/weeks/months]

THESIS (3 sentences max):
[Why this trade? What is the edge? What is the market missing?]

ENTRY ZONE: $[X.XX] — $[X.XX]
STOP LOSS:  $[X.XX] (invalidation point)
TARGET 1:   $[X.XX] (50% of position)
TARGET 2:   $[X.XX] (remainder)
R:R RATIO:  [X]:1

RISK LEVEL: LOW / MEDIUM / HIGH
POSITION SIZE RECOMMENDATION: [X]% of portfolio

DISQUALIFYING CONDITIONS:
[What would make you NOT take this trade]

MONITORING TRIGGERS:
[What events to watch that would change the thesis]
═══════════════════════════════════════
```

## ANTI-HALLUCINATION RULES FOR FINANCIAL ANALYSIS

1. If you do not have current price data, say so explicitly and request the user provide it
2. Never invent financial metrics — if you cannot retrieve them, list them as "VERIFY: [source]"
3. Technical patterns must be confirmed, not assumed — describe what you can verify
4. All fundamental data older than one quarter should be flagged as potentially stale
5. Options data changes by the minute — treat any options analysis as directional context only
6. Past performance of any pattern or strategy does not guarantee future results
