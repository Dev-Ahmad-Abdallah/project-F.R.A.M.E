#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo ""
echo "========================================="
echo "  F.R.A.M.E. Full Test Suite"
echo "========================================="
echo ""

# Check Docker
printf "${YELLOW}[CHECK]${NC} Docker containers... "
if ! docker-compose ps --status running 2>/dev/null | grep -q postgres; then
  printf "${RED}NOT RUNNING${NC}\n"
  echo "Start Docker first: npm run docker:up"
  exit 1
fi
printf "${GREEN}OK${NC}\n"

# Run migrations
printf "${YELLOW}[SETUP]${NC} Running migrations... "
cd services/homeserver
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/frame_a \
  npx node-pg-migrate up --migration-file-language sql --migrations-dir migrations > /dev/null 2>&1 || true
cd "$ROOT"
printf "${GREEN}OK${NC}\n"

# Build shared first
printf "${YELLOW}[BUILD]${NC} Building shared... "
npm run build:shared > /dev/null 2>&1
printf "${GREEN}OK${NC}\n"

echo ""

# Run tests
pass=0
fail=0

printf "${YELLOW}[TEST]${NC} Homeserver tests... "
if npm run test:homeserver > /tmp/frame-test-hs.log 2>&1; then
  printf "${GREEN}PASS${NC}\n"
  ((pass++))
else
  printf "${RED}FAIL${NC}\n"
  tail -20 /tmp/frame-test-hs.log
  ((fail++))
fi

printf "${YELLOW}[TEST]${NC} Frontend tests... "
if npm run test:frontend > /tmp/frame-test-fe.log 2>&1; then
  printf "${GREEN}PASS${NC}\n"
  ((pass++))
else
  printf "${RED}FAIL${NC}\n"
  tail -20 /tmp/frame-test-fe.log
  ((fail++))
fi

echo ""
echo "========================================="
printf "  Tests: ${GREEN}%d passed${NC}" "$pass"
if [ "$fail" -gt 0 ]; then
  printf ", ${RED}%d failed${NC}" "$fail"
fi
echo ""
echo "========================================="

[ "$fail" -eq 0 ]
