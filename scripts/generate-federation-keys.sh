#!/usr/bin/env bash
#
# generate-federation-keys.sh
#
# Generates Ed25519 keypairs for F.R.A.M.E. federation signing.
# Produces base64-encoded private keys suitable for the FEDERATION_SIGNING_KEY
# environment variable, plus the corresponding public keys.
#
# Usage:
#   ./scripts/generate-federation-keys.sh            # Generate one keypair
#   ./scripts/generate-federation-keys.sh 2           # Generate two keypairs (for two servers)
#   ./scripts/generate-federation-keys.sh --node      # Force Node.js method
#   ./scripts/generate-federation-keys.sh --openssl   # Force openssl method
#
set -euo pipefail

COUNT="${1:-2}"
METHOD=""

# Parse arguments
for arg in "$@"; do
  case "$arg" in
    --node)   METHOD="node" ;;
    --openssl) METHOD="openssl" ;;
    [0-9]*)   COUNT="$arg" ;;
  esac
done

# Auto-detect method if not specified
if [ -z "$METHOD" ]; then
  if command -v node &>/dev/null; then
    METHOD="node"
  elif command -v openssl &>/dev/null; then
    METHOD="openssl"
  else
    echo "Error: Neither node nor openssl found in PATH." >&2
    echo "Install Node.js 20+ or OpenSSL to generate keys." >&2
    exit 1
  fi
fi

echo "============================================"
echo "  F.R.A.M.E. Federation Key Generator"
echo "============================================"
echo ""
echo "Method: $METHOD"
echo "Generating $COUNT keypair(s)..."
echo ""

generate_with_node() {
  local label="$1"
  node -e "
    const crypto = require('crypto');
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');

    // Export private key as PKCS8 DER (base64) -- this is what FEDERATION_SIGNING_KEY expects
    const privDer = privateKey.export({ type: 'pkcs8', format: 'der' });
    const privBase64 = Buffer.from(privDer).toString('base64');

    // Export public key as SPKI DER (base64) -- this is what peers fetch via discovery
    const pubDer = publicKey.export({ type: 'spki', format: 'der' });
    const pubBase64 = Buffer.from(pubDer).toString('base64');

    console.log('FEDERATION_SIGNING_KEY (private, base64-encoded PKCS8 DER):');
    console.log(privBase64);
    console.log('');
    console.log('Public key (base64-encoded SPKI DER, for verification only):');
    console.log(pubBase64);
  "
}

generate_with_openssl() {
  local label="$1"
  local tmpdir
  tmpdir=$(mktemp -d)
  trap "rm -rf '$tmpdir'" RETURN

  # Generate Ed25519 private key in PKCS8 DER format
  openssl genpkey -algorithm Ed25519 -outform DER -out "$tmpdir/priv.der" 2>/dev/null

  # Extract public key in SPKI DER format
  openssl pkey -in "$tmpdir/priv.der" -inform DER -pubout -outform DER -out "$tmpdir/pub.der" 2>/dev/null

  local priv_base64
  priv_base64=$(base64 < "$tmpdir/priv.der" | tr -d '\n')
  local pub_base64
  pub_base64=$(base64 < "$tmpdir/pub.der" | tr -d '\n')

  echo "FEDERATION_SIGNING_KEY (private, base64-encoded PKCS8 DER):"
  echo "$priv_base64"
  echo ""
  echo "Public key (base64-encoded SPKI DER, for verification only):"
  echo "$pub_base64"
}

for i in $(seq 1 "$COUNT"); do
  LABELS=("A" "B" "C" "D" "E" "F" "G" "H")
  idx=$((i - 1))
  label="${LABELS[$idx]:-$i}"

  echo "--------------------------------------------"
  echo "  Server $label"
  echo "--------------------------------------------"

  if [ "$METHOD" = "node" ]; then
    generate_with_node "$label"
  else
    generate_with_openssl "$label"
  fi

  echo ""
done

echo "============================================"
echo "  Setup Instructions"
echo "============================================"
echo ""
echo "1. Copy each FEDERATION_SIGNING_KEY value above."
echo "2. In the Railway dashboard, go to the homeserver service > Variables."
echo "3. Set FEDERATION_SIGNING_KEY to the private key value."
echo "4. Do NOT share the private key. The public key is fetched"
echo "   automatically by peers via /.well-known/frame/server."
echo "5. Redeploy the service after setting the variable."
echo ""
echo "Each server MUST have a unique key. Never reuse keys between servers."
