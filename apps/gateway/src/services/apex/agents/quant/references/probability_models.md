# Probability Models by Category
## Weather (GFS Ensemble)
- Source: Open-Meteo ensemble API (free)
- Method: Count GFS members above/below threshold
- P(above_T) = members_above / 31
- Confidence = |members_above - 15.5| / 15.5
- Edge threshold: 8% minimum
## Crypto Microstructure
- Sources: Coinbase, Binance, Kraken (1-min candles)
- Signals: RSI(14), Momentum(1m/5m/15m), VWAP deviation, SMA crossover(5/20), Order flow imbalance
- Weights: RSI 0.20, Momentum 0.25, VWAP 0.20, SMA 0.15, Skew 0.10, Flow 0.10
- Edge threshold: 2% minimum
## Sports/Events (AI Ensemble)
- 5 LLMs via OpenRouter debating each market
- Weighted probability aggregation
- Agreement metric = 1 - stdev(model_probabilities)
- Edge threshold: 5% minimum
## Arbitrage
- No model needed: profit = 1.00 - (leg_a_price + leg_b_price) - fees
- Kalshi fee: ceil(0.07 * contracts * price * (1-price))
- Polymarket: mostly fee-free (2% on winning positions)
