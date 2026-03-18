#!/bin/bash

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

pass=0
fail=0

run_step() {
  local label="$1"; shift
  printf "${YELLOW}[PIPELINE]${NC} %s... " "$label"
  if "$@" > /tmp/frame-pipeline.log 2>&1; then
    printf "${GREEN}OK${NC}\n"
    pass=$((pass + 1))
  else
    printf "${RED}FAIL${NC}\n"
    cat /tmp/frame-pipeline.log
    fail=$((fail + 1))
  fi
}

echo ""
echo "========================================="
echo "  F.R.A.M.E. Development Pipeline"
echo "========================================="
echo ""

run_step "Build shared types"        npm run build:shared
run_step "Build homeserver"          npm run build:homeserver
run_step "Build frontend"            npm run build:frontend
run_step "TypeCheck homeserver"      bash -c "cd services/homeserver && npx tsc --noEmit"
run_step "TypeCheck frontend"        bash -c "cd services/frontend && npx tsc --noEmit"
run_step "Homeserver tests"          npm run test:homeserver
run_step "Frontend tests"            npm run test:frontend

echo ""
echo "========================================="
printf "  Results: ${GREEN}%d passed${NC}" "$pass"
if [ "$fail" -gt 0 ]; then
  printf ", ${RED}%d failed${NC}" "$fail"
fi
echo ""
echo "========================================="
echo ""

[ "$fail" -eq 0 ]
