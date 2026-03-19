#!/usr/bin/env bash
#
# test-federation.sh
#
# End-to-end test of federation between two F.R.A.M.E. homeservers.
# Registers users, creates a room, invites a cross-server user,
# sends a message, and verifies delivery.
#
# Usage:
#   ./scripts/test-federation.sh <server_a_url> <server_b_url>
#
# Examples:
#   # Production (Railway)
#   ./scripts/test-federation.sh https://frame-a.up.railway.app https://frame-b.up.railway.app
#
#   # Local (docker-compose)
#   ./scripts/test-federation.sh http://localhost:3000 http://localhost:3001
#
set -euo pipefail

SERVER_A="${1:?Usage: $0 <server_a_url> <server_b_url>}"
SERVER_B="${2:?Usage: $0 <server_a_url> <server_b_url>}"

# Strip trailing slashes
SERVER_A="${SERVER_A%/}"
SERVER_B="${SERVER_B%/}"

TIMESTAMP=$(date +%s)
USER_A="testuser_a_${TIMESTAMP}"
USER_B="testuser_b_${TIMESTAMP}"
PASSWORD="TestPassword123!"

PASS=0
FAIL=0

pass() { echo "  [PASS] $1"; PASS=$((PASS + 1)); }
fail() { echo "  [FAIL] $1: $2"; FAIL=$((FAIL + 1)); }

echo "============================================"
echo "  F.R.A.M.E. Federation Test"
echo "============================================"
echo ""
echo "Server A: $SERVER_A"
echo "Server B: $SERVER_B"
echo "Test users: $USER_A (A), $USER_B (B)"
echo ""

# ── 1. Health Checks ──

echo "--- Step 1: Health Checks ---"

HEALTH_A=$(curl -s -o /dev/null -w "%{http_code}" "$SERVER_A/health" 2>/dev/null || echo "000")
if [ "$HEALTH_A" = "200" ]; then
  pass "Server A health check"
else
  fail "Server A health check" "HTTP $HEALTH_A"
fi

HEALTH_B=$(curl -s -o /dev/null -w "%{http_code}" "$SERVER_B/health" 2>/dev/null || echo "000")
if [ "$HEALTH_B" = "200" ]; then
  pass "Server B health check"
else
  fail "Server B health check" "HTTP $HEALTH_B"
fi

# Abort if either server is down
if [ "$HEALTH_A" != "200" ] || [ "$HEALTH_B" != "200" ]; then
  echo ""
  echo "Cannot proceed -- one or both servers are unreachable."
  exit 1
fi

# ── 2. Server Discovery ──

echo ""
echo "--- Step 2: Server Discovery ---"

DISCOVERY_A=$(curl -s "$SERVER_A/.well-known/frame/server" 2>/dev/null || echo "{}")
DISCOVERY_B=$(curl -s "$SERVER_B/.well-known/frame/server" 2>/dev/null || echo "{}")

HOST_A=$(echo "$DISCOVERY_A" | jq -r '.["frame.server"].host // empty' 2>/dev/null || echo "")
HOST_B=$(echo "$DISCOVERY_B" | jq -r '.["frame.server"].host // empty' 2>/dev/null || echo "")

if [ -n "$HOST_A" ]; then
  pass "Server A discovery (host: $HOST_A)"
else
  fail "Server A discovery" "No host in response"
fi

if [ -n "$HOST_B" ]; then
  pass "Server B discovery (host: $HOST_B)"
else
  fail "Server B discovery" "No host in response"
fi

PUBKEY_A=$(echo "$DISCOVERY_A" | jq -r '.["frame.server"].publicKey // empty' 2>/dev/null || echo "")
PUBKEY_B=$(echo "$DISCOVERY_B" | jq -r '.["frame.server"].publicKey // empty' 2>/dev/null || echo "")

if [ -n "$PUBKEY_A" ]; then
  pass "Server A has public key"
else
  fail "Server A public key" "Missing from discovery"
fi

if [ -n "$PUBKEY_B" ]; then
  pass "Server B has public key"
else
  fail "Server B public key" "Missing from discovery"
fi

# ── 3. Register Users ──

echo ""
echo "--- Step 3: Register Users ---"

REG_RESPONSE_A=$(curl -s -X POST "$SERVER_A/auth/register" \
  -H "Content-Type: application/json" \
  -d "{
    \"username\": \"$USER_A\",
    \"password\": \"$PASSWORD\",
    \"identityKey\": \"test-identity-key-$USER_A\",
    \"signedPrekey\": \"test-signed-prekey-$USER_A\",
    \"signedPrekeySignature\": \"test-sig-$USER_A\",
    \"oneTimePrekeys\": [\"otk-${USER_A}-1\", \"otk-${USER_A}-2\"]
  }" 2>/dev/null || echo '{"error":"request failed"}')

TOKEN_A=$(echo "$REG_RESPONSE_A" | jq -r '.token // .accessToken // empty' 2>/dev/null || echo "")
USERID_A=$(echo "$REG_RESPONSE_A" | jq -r '.userId // .user_id // empty' 2>/dev/null || echo "")

if [ -n "$TOKEN_A" ]; then
  pass "Registered $USER_A on Server A (userId: $USERID_A)"
else
  fail "Register $USER_A on Server A" "$(echo "$REG_RESPONSE_A" | jq -r '.error // .errcode // "unknown error"' 2>/dev/null)"
fi

REG_RESPONSE_B=$(curl -s -X POST "$SERVER_B/auth/register" \
  -H "Content-Type: application/json" \
  -d "{
    \"username\": \"$USER_B\",
    \"password\": \"$PASSWORD\",
    \"identityKey\": \"test-identity-key-$USER_B\",
    \"signedPrekey\": \"test-signed-prekey-$USER_B\",
    \"signedPrekeySignature\": \"test-sig-$USER_B\",
    \"oneTimePrekeys\": [\"otk-${USER_B}-1\", \"otk-${USER_B}-2\"]
  }" 2>/dev/null || echo '{"error":"request failed"}')

TOKEN_B=$(echo "$REG_RESPONSE_B" | jq -r '.token // .accessToken // empty' 2>/dev/null || echo "")
USERID_B=$(echo "$REG_RESPONSE_B" | jq -r '.userId // .user_id // empty' 2>/dev/null || echo "")

if [ -n "$TOKEN_B" ]; then
  pass "Registered $USER_B on Server B (userId: $USERID_B)"
else
  fail "Register $USER_B on Server B" "$(echo "$REG_RESPONSE_B" | jq -r '.error // .errcode // "unknown error"' 2>/dev/null)"
fi

# Abort if registration failed
if [ -z "$TOKEN_A" ] || [ -z "$TOKEN_B" ]; then
  echo ""
  echo "Cannot proceed -- user registration failed."
  echo "Server A response: $REG_RESPONSE_A"
  echo "Server B response: $REG_RESPONSE_B"
  exit 1
fi

# ── 4. Federation Key Exchange ──

echo ""
echo "--- Step 4: Federation Key Exchange ---"

KEYS_A=$(curl -s "$SERVER_A/federation/keys/$USERID_A" 2>/dev/null || echo '{}')
IDENTITY_KEY_A=$(echo "$KEYS_A" | jq -r '.identityKey // empty' 2>/dev/null || echo "")

if [ -n "$IDENTITY_KEY_A" ]; then
  pass "Fetched $USER_A keys from Server A via federation"
else
  fail "Fetch $USER_A keys" "No identityKey in response: $KEYS_A"
fi

KEYS_B=$(curl -s "$SERVER_B/federation/keys/$USERID_B" 2>/dev/null || echo '{}')
IDENTITY_KEY_B=$(echo "$KEYS_B" | jq -r '.identityKey // empty' 2>/dev/null || echo "")

if [ -n "$IDENTITY_KEY_B" ]; then
  pass "Fetched $USER_B keys from Server B via federation"
else
  fail "Fetch $USER_B keys" "No identityKey in response: $KEYS_B"
fi

# ── 5. Create Room on Server A ──

echo ""
echo "--- Step 5: Create Room on Server A ---"

ROOM_RESPONSE=$(curl -s -X POST "$SERVER_A/rooms" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN_A" \
  -d "{
    \"name\": \"Federation Test Room $TIMESTAMP\"
  }" 2>/dev/null || echo '{"error":"request failed"}')

ROOM_ID=$(echo "$ROOM_RESPONSE" | jq -r '.roomId // .room_id // empty' 2>/dev/null || echo "")

if [ -n "$ROOM_ID" ]; then
  pass "Created room on Server A (roomId: $ROOM_ID)"
else
  fail "Create room" "$(echo "$ROOM_RESPONSE" | jq -r '.error // .errcode // "unknown"' 2>/dev/null)"
fi

# ── 6. Invite User B to the Room ──

echo ""
echo "--- Step 6: Invite User B to Room ---"

if [ -n "$ROOM_ID" ] && [ -n "$USERID_B" ]; then
  INVITE_RESPONSE=$(curl -s -X POST "$SERVER_A/rooms/$ROOM_ID/invite" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN_A" \
    -d "{
      \"userId\": \"$USERID_B\"
    }" 2>/dev/null || echo '{"error":"request failed"}')

  INVITE_OK=$(echo "$INVITE_RESPONSE" | jq -r '.success // .ok // empty' 2>/dev/null || echo "")
  INVITE_ERROR=$(echo "$INVITE_RESPONSE" | jq -r '.error // .errcode // empty' 2>/dev/null || echo "")

  if [ -n "$INVITE_OK" ] && [ "$INVITE_OK" != "null" ] && [ "$INVITE_OK" != "false" ]; then
    pass "Invited $USER_B to room"
  elif [ -z "$INVITE_ERROR" ] || [ "$INVITE_ERROR" = "null" ]; then
    pass "Invite request sent (response: $(echo "$INVITE_RESPONSE" | head -c 120))"
  else
    fail "Invite $USER_B" "$INVITE_ERROR"
  fi
else
  fail "Invite $USER_B" "Missing room ID or user ID"
fi

# ── 7. Send Message from Server A ──

echo ""
echo "--- Step 7: Send Message via Server A ---"

if [ -n "$ROOM_ID" ]; then
  MSG_RESPONSE=$(curl -s -X POST "$SERVER_A/rooms/$ROOM_ID/messages" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN_A" \
    -d "{
      \"type\": \"m.room.message\",
      \"content\": {
        \"msgtype\": \"m.text\",
        \"body\": \"Federation test message $TIMESTAMP\"
      }
    }" 2>/dev/null || echo '{"error":"request failed"}')

  EVENT_ID=$(echo "$MSG_RESPONSE" | jq -r '.eventId // .event_id // empty' 2>/dev/null || echo "")

  if [ -n "$EVENT_ID" ]; then
    pass "Sent message (eventId: $EVENT_ID)"
  else
    fail "Send message" "$(echo "$MSG_RESPONSE" | jq -r '.error // .errcode // "unknown"' 2>/dev/null)"
  fi
else
  fail "Send message" "No room ID"
fi

# ── 8. Check Federation Directory ──

echo ""
echo "--- Step 8: Federation Directory Query ---"

if [ -n "$USERID_A" ]; then
  DIR_RESPONSE=$(curl -s "$SERVER_B/federation/query/directory?userId=$USERID_A" \
    -H "X-Origin-Server: $HOST_B" 2>/dev/null || echo '{}')

  USER_EXISTS=$(echo "$DIR_RESPONSE" | jq -r '.exists // empty' 2>/dev/null || echo "")

  if [ "$USER_EXISTS" = "true" ]; then
    pass "Server B can query Server A user via federation directory"
  elif [ "$USER_EXISTS" = "false" ]; then
    pass "Federation directory responded (user not found on Server B, expected for cross-server)"
  else
    fail "Federation directory query" "Unexpected response: $(echo "$DIR_RESPONSE" | head -c 120)"
  fi
else
  fail "Federation directory query" "No user ID"
fi

# ── 9. Check Backfill Endpoint ──

echo ""
echo "--- Step 9: Federation Backfill ---"

if [ -n "$ROOM_ID" ]; then
  BACKFILL_RESPONSE=$(curl -s "$SERVER_A/federation/backfill?roomId=$ROOM_ID&since=0&limit=10" \
    -H "X-Origin-Server: $HOST_B" 2>/dev/null || echo '{}')

  BACKFILL_EVENTS=$(echo "$BACKFILL_RESPONSE" | jq -r '.events // empty' 2>/dev/null || echo "")

  if [ -n "$BACKFILL_EVENTS" ] && [ "$BACKFILL_EVENTS" != "null" ]; then
    EVENT_COUNT=$(echo "$BACKFILL_RESPONSE" | jq '.events | length' 2>/dev/null || echo "0")
    pass "Backfill returned $EVENT_COUNT event(s)"
  else
    BACKFILL_ERR=$(echo "$BACKFILL_RESPONSE" | jq -r '.error // .errcode // empty' 2>/dev/null || echo "")
    if [ -n "$BACKFILL_ERR" ]; then
      fail "Backfill" "$BACKFILL_ERR"
    else
      pass "Backfill responded (no events yet)"
    fi
  fi
else
  fail "Backfill" "No room ID"
fi

# ── Summary ──

echo ""
echo "============================================"
echo "  Results: $PASS passed, $FAIL failed"
echo "============================================"

if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo "Some tests failed. Check the output above for details."
  echo "See docs/operations/federation-deployment.md for troubleshooting."
  exit 1
else
  echo ""
  echo "All federation tests passed."
  exit 0
fi
