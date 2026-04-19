# Venue API Reference

## Kalshi
Base: https://api.elections.kalshi.com/trade-api/v2
Auth: RSA-PSS for trading, none for public data
Endpoints:
- GET /events/?limit=N&status=open — List events
- GET /markets/?event_ticker=X — Markets for event
- GET /markets/{ticker}/ — Single market detail
Rate: ~10 req/s public

## Polymarket
CLOB: https://clob.polymarket.com
Gamma: https://gamma-api.polymarket.com (public, no auth)
Auth: EIP-712 signing for trading
Endpoints:
- GET /markets?limit=N&active=true — All active markets
- GET /markets?slug=X — Single market by slug
Rate: No strict limit on Gamma API

## Deribit (Type 7 Options)
Base: https://www.deribit.com/api/v2/public
Auth: None for public data
Endpoints:
- GET /get_instruments?currency=BTC&kind=option — List options
- GET /ticker?instrument_name=X — Single option ticker (IV, price)
- GET /get_index_price?index_name=btc_usd — Current spot price
Rate: 20 req/s public
