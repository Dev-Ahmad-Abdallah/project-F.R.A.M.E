#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# scripts/healthcheck.sh — Production health check for Project F.R.A.M.E.
#
# Usage:
#   ./scripts/healthcheck.sh                  # Check all services
#   ./scripts/healthcheck.sh homeserver       # Check homeserver only
#   ./scripts/healthcheck.sh frontend         # Check frontend only
#
# Exit codes:
#   0 — all checked services healthy
#   1 — one or more services unhealthy
#
# Environment overrides:
#   HOMESERVER_URL   — override homeserver base URL
#   FRONTEND_URL     — override frontend base URL
#   TIMEOUT          — curl timeout in seconds (default: 15)
# ──────────────────────────────────────────────────────────────
set -euo pipefail

# Defaults — override via env vars for staging or local use
HOMESERVER_URL="${HOMESERVER_URL:-https://project-frame-production.up.railway.app}"
FRONTEND_URL="${FRONTEND_URL:-https://frontend-production-29a3.up.railway.app}"
TIMEOUT="${TIMEOUT:-15}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No color

FAILED=0

check_service() {
  local name="$1"
  local url="$2"
  local expected_code="${3:-200}"

  printf "%-20s %s ... " "$name" "$url"

  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time "$TIMEOUT" "$url" 2>/dev/null || echo "000")

  if [ "$HTTP_CODE" = "$expected_code" ]; then
    printf "${GREEN}OK${NC} (HTTP %s)\n" "$HTTP_CODE"
  elif [ "$HTTP_CODE" = "000" ]; then
    printf "${RED}UNREACHABLE${NC} (connection failed or timeout)\n"
    FAILED=1
  else
    printf "${YELLOW}UNEXPECTED${NC} (HTTP %s, expected %s)\n" "$HTTP_CODE" "$expected_code"
    FAILED=1
  fi
}

check_homeserver() {
  echo "== Homeserver =="
  check_service "health"     "${HOMESERVER_URL}/health"
  check_service "discovery"  "${HOMESERVER_URL}/.well-known/frame/server"
  echo ""
}

check_frontend() {
  echo "== Frontend =="
  check_service "index"      "${FRONTEND_URL}/"
  echo ""
}

echo ""
echo "Project F.R.A.M.E. — Health Check"
echo "Timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "──────────────────────────────────"
echo ""

TARGET="${1:-all}"

case "$TARGET" in
  homeserver)
    check_homeserver
    ;;
  frontend)
    check_frontend
    ;;
  all|"")
    check_homeserver
    check_frontend
    ;;
  *)
    echo "Unknown target: $TARGET"
    echo "Usage: $0 [homeserver|frontend|all]"
    exit 1
    ;;
esac

if [ "$FAILED" -ne 0 ]; then
  echo "${RED}One or more health checks failed.${NC}"
  exit 1
else
  echo "${GREEN}All health checks passed.${NC}"
  exit 0
fi
