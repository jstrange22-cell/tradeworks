#!/usr/bin/env bash
# =============================================================================
# APEX CLI — TradeWorks Agent Bridge
# Mirrors the RE-Assistant script architecture
# Usage: ./apex.sh <command> [args...]
# =============================================================================

set -euo pipefail

# ── Config ──────────────────────────────────────────────────────────────────

GATEWAY_URL="${TRADEWORKS_GATEWAY_URL:-http://localhost:4000}"
API_VERSION="v1"
JWT_TOKEN="${APEX_JWT_TOKEN:-}"
HMAC_SECRET="${APEX_HMAC_SECRET:-}"
TIMEOUT=30

# ── Colors ──────────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# ── HMAC Signing ────────────────────────────────────────────────────────────

sign_request() {
  local method="$1"
  local path="$2"
  local timestamp
  timestamp=$(date +%s)
  local payload="${timestamp}:${method}:${path}"

  if [ -n "$HMAC_SECRET" ]; then
    local signature
    signature=$(echo -n "$payload" | openssl dgst -sha256 -hmac "$HMAC_SECRET" -binary | base64)
    echo "-H \"X-Signature: ${signature}\" -H \"X-Timestamp: ${timestamp}\""
  else
    echo ""
  fi
}

# ── HTTP Helper ─────────────────────────────────────────────────────────────

api_call() {
  local method="$1"
  local path="/api/${API_VERSION}${2}"
  local body="${3:-}"
  local url="${GATEWAY_URL}${path}"

  local auth_header=""
  if [ -n "$JWT_TOKEN" ]; then
    auth_header="-H \"Authorization: Bearer ${JWT_TOKEN}\""
  fi

  local sign_headers
  sign_headers=$(sign_request "$method" "$path")

  local cmd="curl -s -w '\n%{http_code}' --max-time ${TIMEOUT}"
  cmd+=" -X ${method}"
  cmd+=" -H 'Content-Type: application/json'"
  cmd+=" ${auth_header}"
  cmd+=" ${sign_headers}"

  if [ -n "$body" ]; then
    cmd+=" -d '${body}'"
  fi

  cmd+=" '${url}'"

  local response
  response=$(eval "$cmd" 2>/dev/null)

  local http_code
  http_code=$(echo "$response" | tail -1)
  local body_response
  body_response=$(echo "$response" | sed '$d')

  case "$http_code" in
    2[0-9][0-9])
      echo "$body_response" | jq . 2>/dev/null || echo "$body_response"
      return 0
      ;;
    401|403)
      echo -e "${RED}Auth error (${http_code}): Check APEX_JWT_TOKEN${NC}" >&2
      return 3
      ;;
    4[0-9][0-9])
      echo -e "${RED}Client error (${http_code}):${NC}" >&2
      echo "$body_response" | jq -r '.error // .message // "Unknown error"' 2>/dev/null >&2
      return 1
      ;;
    5[0-9][0-9])
      echo -e "${RED}Server error (${http_code})${NC}" >&2
      return 2
      ;;
    *)
      echo -e "${RED}Unexpected response (${http_code})${NC}" >&2
      return 1
      ;;
  esac
}

# ── Usage ───────────────────────────────────────────────────────────────────

print_usage() {
  echo -e "${BLUE}APEX CLI — TradeWorks Trading Intelligence${NC}"
  echo ""
  echo "Usage: apex.sh <command> [args...]"
  echo ""
  echo -e "${GREEN}Portfolio & Monitoring:${NC}"
  echo "  status          Full portfolio status"
  echo "  positions       Open positions across all markets"
  echo "  pnl             P&L report (today / week / month)"
  echo "  portfolio       Allocation breakdown"
  echo "  watchlist       View/manage watchlist"
  echo ""
  echo -e "${GREEN}Trading:${NC}"
  echo "  close <id>      Close a position"
  echo "  signal          Generate AI trading signal"
  echo "  scan [market]   Market scan (crypto/stocks/predict/sports/all)"
  echo ""
  echo -e "${GREEN}Solana Sniper:${NC}"
  echo "  sniper          Sniper bot status & positions"
  echo "  sniper start    Start default sniper"
  echo "  sniper stop     Stop default sniper"
  echo "  sniper config   View sniper configuration"
  echo "  sniper history  Recent execution history"
  echo "  whale           Whale wallet activity"
  echo ""
  echo -e "${GREEN}Analysis:${NC}"
  echo "  risk            Current risk exposure"
  echo "  regime          Macro market regime"
  echo "  backtest        Run strategy backtest"
  echo "  arb             Arbitrage opportunities"
  echo "  brief           Market intelligence briefing"
  echo ""
  echo -e "${GREEN}Markets:${NC}"
  echo "  predict         Polymarket prediction markets"
  echo "  sports          Sports betting odds & +EV"
  echo ""
  echo -e "${GREEN}System:${NC}"
  echo "  config          View/update bot configuration"
  echo "  journal         Trade journal"
  echo "  alert           Set price/condition alert"
  echo "  clean           Clean dust token accounts"
  echo "  help            This help message"
}

# ── Commands ────────────────────────────────────────────────────────────────

case "${1:-help}" in
  # Portfolio & Monitoring
  status)       api_call GET "/portfolio" ;;
  positions)    api_call GET "/positions" ;;
  pnl)          api_call GET "/portfolio/trades" ;;
  portfolio)    api_call GET "/portfolio/allocation" ;;
  watchlist)    api_call GET "/market/instruments" ;;

  # Trading
  close)
    if [ -z "${2:-}" ]; then echo -e "${RED}Usage: apex.sh close <position_id>${NC}"; exit 1; fi
    api_call POST "/positions/$2/close" "${3:-{}}"
    ;;
  signal)       api_call POST "/agents/signal" "${2:-{}}" ;;
  scan)
    local market="${2:-all}"
    case "$market" in
      crypto)  api_call GET "/solana/scanner/tokens" ;;
      stocks)  api_call GET "/market/instruments" ;;
      predict) api_call GET "/polymarket/markets" ;;
      sports)  api_call GET "/sports/odds" ;;
      *)       api_call GET "/portfolio" ;;
    esac
    ;;

  # Solana Sniper
  sniper)
    case "${2:-}" in
      start)   api_call POST "/solana/sniper/start" ;;
      stop)    api_call POST "/solana/sniper/stop" ;;
      config)  api_call GET "/solana/sniper/config" ;;
      history) api_call GET "/solana/sniper/history" ;;
      *)       api_call GET "/solana/sniper/status" ;;
    esac
    ;;
  whale)        api_call GET "/solana/whales/activity" ;;
  clean)        api_call POST "/solana/sniper/clean-wallet" ;;

  # Analysis
  risk)         api_call GET "/risk/metrics" ;;
  regime)       api_call GET "/market/regime" ;;
  backtest)     api_call POST "/backtest" "${2:-{}}" ;;
  arb)          api_call GET "/arbitrage/opportunities" ;;
  brief)        api_call GET "/agents/briefing" ;;

  # Markets
  predict)      api_call GET "/polymarket/markets" ;;
  sports)       api_call GET "/sports/odds" ;;

  # System
  config)       api_call GET "/settings" ;;
  journal)      api_call GET "/journal" ;;
  alert)        api_call POST "/notifications" "${2:-{}}" ;;

  # Circuit Breaker
  circuit-breaker)
    api_call POST "/risk/circuit-breaker" "${2:-{}}"
    ;;

  # Help
  help)         print_usage ;;
  *)
    echo -e "${RED}Unknown command: $1${NC}" >&2
    print_usage
    exit 1
    ;;
esac
