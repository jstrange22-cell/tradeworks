# TradeWorks Go-Live Procedure

## Pre-Live Checklist (9:00 AM)
- [ ] All bots running (check dashboard)
- [ ] Safety layer active: `GET /api/v1/safety/status` → masterEnabled: true, paperMode: true
- [ ] Solana wallet funded (minimum 1 SOL for gas + trading)
- [ ] SafePal wallet has ETH/BNB for EVM gas
- [ ] Coinbase API connected
- [ ] Alpaca API connected (for stocks at 9:30 AM)

## Go Live (9:30 AM)

### Step 1: Flip Paper Mode OFF
```
POST /api/v1/safety/paper-mode
Body: { "enabled": false }
```

### Step 2: Start with Quick Scalp ONLY (first 4 hours)
Keep only Quick Scalp running at 0.05 SOL. Monitor every trade manually.

### Step 3: After 4 hours of profitable Quick Scalp
Enable Graduation Hold at 0.10 SOL.

### Step 4: After Day 1 is profitable
Enable Copy Trading at 0.05 SOL (after finding whale wallets on GMGN.ai).

## Emergency: Kill All Trading
```
POST /api/v1/safety/halt
Body: { "reason": "Manual emergency halt" }
```

## Resume After Halt
```
POST /api/v1/safety/resume
```

## Daily Loss Limits
- Total across all systems: $500/day
- Solana Sniper: $100/day
- CEX Blue Chips: $250/day
- Stocks: $500/day
- Sports: $100/day
- Kalshi: $100/day

If any limit is hit, trading auto-halts for that system.
