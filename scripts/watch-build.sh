#!/bin/bash

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo ""
echo "========================================="
echo "  F.R.A.M.E. Watch Mode"
echo "========================================="
echo "  Watching for .ts changes..."
echo "  Press Ctrl+C to stop"
echo "========================================="
echo ""

# Check for fswatch (macOS)
if command -v fswatch &> /dev/null; then
  fswatch -o -r --include '\.ts$' --exclude 'dist|build|node_modules' \
    shared/types services/homeserver/src services/frontend/src | while read -r; do
    echo ""
    printf "${YELLOW}[WATCH]${NC} Change detected at $(date +%H:%M:%S)\n"

    printf "${YELLOW}[BUILD]${NC} shared... "
    if npm run build:shared > /dev/null 2>&1; then
      printf "${GREEN}OK${NC} "
    else
      printf "${RED}FAIL${NC} "
    fi

    printf "homeserver... "
    if npm run build:homeserver > /dev/null 2>&1; then
      printf "${GREEN}OK${NC} "
    else
      printf "${RED}FAIL${NC} "
    fi

    printf "frontend tsc... "
    if (cd services/frontend && npx tsc --noEmit) > /dev/null 2>&1; then
      printf "${GREEN}OK${NC}"
    else
      printf "${RED}FAIL${NC}"
    fi
    echo ""
  done
else
  echo "fswatch not found. Install with: brew install fswatch"
  echo "Falling back to polling (every 5s)..."
  echo ""

  last_hash=""
  while true; do
    current_hash=$(find shared/types services/homeserver/src services/frontend/src \
      -name '*.ts' -newer /tmp/frame-watch-marker 2>/dev/null | head -1)

    if [ -n "$current_hash" ]; then
      touch /tmp/frame-watch-marker
      printf "${YELLOW}[WATCH]${NC} Change detected at $(date +%H:%M:%S)\n"

      npm run build:shared > /dev/null 2>&1 && printf "${GREEN}shared${NC} " || printf "${RED}shared${NC} "
      npm run build:homeserver > /dev/null 2>&1 && printf "${GREEN}homeserver${NC} " || printf "${RED}homeserver${NC} "
      (cd services/frontend && npx tsc --noEmit) > /dev/null 2>&1 && printf "${GREEN}frontend${NC}" || printf "${RED}frontend${NC}"
      echo ""
    fi
    sleep 5
  done
fi
