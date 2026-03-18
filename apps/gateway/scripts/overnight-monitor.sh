#!/bin/bash
# Overnight Sniper Bot Monitor
# Checks status, logs results, resets circuit breaker if needed

LOG_FILE="/c/Users/recon/Desktop/Claude Desk/tradeworks/apps/gateway/data/overnight-monitor.log"
API_BASE="http://localhost:4000/api/v1/solana/sniper"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

echo "=== Monitor Check: $TIMESTAMP ===" >> "$LOG_FILE"

# Get status
STATUS=$(curl -s "$API_BASE/status" 2>/dev/null)

if [ -z "$STATUS" ]; then
  echo "[ERROR] Gateway not responding!" >> "$LOG_FILE"
  echo "Attempting restart..." >> "$LOG_FILE"
  cd "/c/Users/recon/Desktop/Claude Desk/tradeworks/apps/gateway"
  npx tsx watch src/index.ts &
  sleep 10
  STATUS=$(curl -s "$API_BASE/status" 2>/dev/null)
  if [ -z "$STATUS" ]; then
    echo "[FATAL] Gateway restart failed!" >> "$LOG_FILE"
    exit 1
  fi
  echo "[OK] Gateway restarted successfully" >> "$LOG_FILE"
fi

# Parse key metrics
RUNNING=$(echo "$STATUS" | python -c "import sys,json; d=json.load(sys.stdin); print(d.get('running','?'))" 2>/dev/null)
DAILY_SPENT=$(echo "$STATUS" | python -c "import sys,json; d=json.load(sys.stdin); print(f\"{d.get('dailySpentSol',0):.4f}\")" 2>/dev/null)
DAILY_REMAINING=$(echo "$STATUS" | python -c "import sys,json; d=json.load(sys.stdin); print(f\"{d.get('dailyRemainingSol',0):.4f}\")" 2>/dev/null)
POSITIONS=$(echo "$STATUS" | python -c "import sys,json; d=json.load(sys.stdin); positions=d.get('openPositions',[]); print(len(positions))" 2>/dev/null)
CIRCUIT_PAUSED=$(echo "$STATUS" | python -c "import sys,json; d=json.load(sys.stdin); t=d.get('templates',[]); print(t[0].get('circuitBreakerPausedUntil',0) if t else 0)" 2>/dev/null)
CONSEC_LOSSES=$(echo "$STATUS" | python -c "import sys,json; d=json.load(sys.stdin); t=d.get('templates',[]); print(t[0].get('consecutiveLosses',0) if t else 0)" 2>/dev/null)

# Template stats
TOTAL_TRADES=$(echo "$STATUS" | python -c "import sys,json; d=json.load(sys.stdin); t=d.get('templates',[]); s=t[0].get('stats',{}) if t else {}; print(s.get('totalTrades',0))" 2>/dev/null)
WINS=$(echo "$STATUS" | python -c "import sys,json; d=json.load(sys.stdin); t=d.get('templates',[]); s=t[0].get('stats',{}) if t else {}; print(s.get('wins',0))" 2>/dev/null)
LOSSES=$(echo "$STATUS" | python -c "import sys,json; d=json.load(sys.stdin); t=d.get('templates',[]); s=t[0].get('stats',{}) if t else {}; print(s.get('losses',0))" 2>/dev/null)
PNL=$(echo "$STATUS" | python -c "import sys,json; d=json.load(sys.stdin); t=d.get('templates',[]); s=t[0].get('stats',{}) if t else {}; print(f\"{s.get('totalPnlSol',0):.6f}\")" 2>/dev/null)

# Position details
POS_DETAILS=$(echo "$STATUS" | python -c "
import sys,json
d=json.load(sys.stdin)
for p in d.get('openPositions',[]):
    sym=p.get('symbol','?')
    pnl=p.get('pnlPercent',0)
    val=p.get('valueUsd',0)
    print(f'  {sym}: {pnl:+.1f}% (${val:.2f})')
" 2>/dev/null)

echo "Running: $RUNNING | Trades: $TOTAL_TRADES (W:$WINS L:$LOSSES) | PnL: ${PNL} SOL" >> "$LOG_FILE"
echo "Spent: $DAILY_SPENT SOL | Remaining: $DAILY_REMAINING SOL | Open: $POSITIONS positions" >> "$LOG_FILE"
echo "Consecutive Losses: $CONSEC_LOSSES | Circuit Breaker: $CIRCUIT_PAUSED" >> "$LOG_FILE"

if [ -n "$POS_DETAILS" ]; then
  echo "Positions:" >> "$LOG_FILE"
  echo "$POS_DETAILS" >> "$LOG_FILE"
fi

# Auto-reset circuit breaker if paused
if [ "$CIRCUIT_PAUSED" != "0" ] && [ "$CIRCUIT_PAUSED" != "" ]; then
  echo "[ACTION] Circuit breaker is active — resetting..." >> "$LOG_FILE"
  curl -s -X PUT "$API_BASE/templates/default" \
    -H "Content-Type: application/json" \
    -d '{"resetCircuitBreaker": true}' > /dev/null 2>&1
  echo "[OK] Circuit breaker reset" >> "$LOG_FILE"
fi

# Check if bot stopped running
if [ "$RUNNING" != "True" ] && [ "$RUNNING" != "true" ]; then
  echo "[ACTION] Bot not running — attempting to start..." >> "$LOG_FILE"
  curl -s -X POST "$API_BASE/templates/default/start" > /dev/null 2>&1
  echo "[OK] Start command sent" >> "$LOG_FILE"
fi

# Get wallet balance
BALANCE=$(curl -s "$API_BASE/wallet" 2>/dev/null | python -c "import sys,json; d=json.load(sys.stdin); print(f\"{d.get('balanceSol',0):.4f}\")" 2>/dev/null)
echo "Wallet Balance: $BALANCE SOL" >> "$LOG_FILE"

echo "---" >> "$LOG_FILE"
