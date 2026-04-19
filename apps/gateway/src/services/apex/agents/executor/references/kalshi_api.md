# Kalshi API Reference
## Authentication: RSA-PSS signature on each request
## Order Placement: POST /trade-api/v2/portfolio/orders
Body: {action: "buy"|"sell", side: "yes"|"no", count: int, ticker: str, type: "limit"|"market", yes_price: int (cents), no_price: int (cents)}
## Fee Formula: ceil(0.07 * contracts * price * (1 - price))
## Rate Limits: Tiered by account type
## Demo: demo-api.kalshi.co | Prod: trading-api.kalshi.com
## Orderbook: Only returns bids (YES/NO reciprocal relationship)
