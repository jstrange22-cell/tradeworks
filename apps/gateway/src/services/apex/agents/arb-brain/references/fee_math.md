# Fee Math Reference

## Kalshi
fee = ceil(0.07 × contracts × price × (1 - price)) [in cents]
Example: 100 contracts @ $0.50 → ceil(0.07 × 100 × 0.50 × 0.50) = ceil(1.75) = 2¢

## Polymarket
Trading fee: $0 (FREE)
Settlement fee: 2% on WINNING positions

## Cross-Platform Minimum Viable Spread
Kalshi→Kalshi: ~1.5¢ (only Kalshi fees)
Poly→Poly: ~2¢ (only settlement fee on winner)
Kalshi→Poly: ~5-6¢ (both fee structures apply)

## Net Profit Formula
Net = (1.00 - price_a - price_b) × quantity - kalshi_fee - poly_settlement - slippage
Default slippage: 2¢ per contract
