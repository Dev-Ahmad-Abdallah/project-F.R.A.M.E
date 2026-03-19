# Federation Deployment Guide

Step-by-step instructions for deploying two federated F.R.A.M.E. homeservers on Railway and verifying they can communicate.

---

## Prerequisites

- A Railway account with an active project containing `frame-homeserver-a` already deployed
- Node.js 20+ installed locally (for key generation)
- `curl` and `jq` installed locally (for testing)
- Access to the Railway dashboard or CLI (`railway` CLI installed)

---

## Step 1: Generate Federation Signing Keys

Each homeserver needs its own unique Ed25519 signing key. The federation service accepts either a raw 32-byte seed or a full PKCS8 DER key, both base64-encoded.

Generate keys for both servers using the provided script:

```bash
# From the project root
./scripts/generate-federation-keys.sh
```

This outputs two base64-encoded private keys and their corresponding public keys. Save each private key -- you will set it as the `FEDERATION_SIGNING_KEY` environment variable on the respective Railway service.

If you prefer to generate keys manually with openssl:

```bash
# Generate a raw 32-byte Ed25519 seed (base64-encoded)
openssl genpkey -algorithm Ed25519 -outform DER 2>/dev/null | tail -c 32 | base64

# Or generate a full PKCS8 DER key (base64-encoded)
openssl genpkey -algorithm Ed25519 -outform DER 2>/dev/null | base64
```

---

## Step 2: Deploy the Second Homeserver on Railway

### 2a. Create the Service

1. Open your Railway project dashboard.
2. Click **"New Service"** > **"GitHub Repo"** > select the F.R.A.M.E. repository.
3. Name the service `frame-homeserver-b`.
4. Under **Settings > Build**:
   - Set **Builder** to `Dockerfile`
   - Set **Dockerfile Path** to `services/homeserver/Dockerfile`
   - Set **Watch Patterns** to `services/homeserver/**`, `shared/**`
5. Under **Settings > Deploy**:
   - Set **Health Check Path** to `/health`
   - Set **Health Check Timeout** to `30`
   - Set **Restart Policy** to `ON_FAILURE` with max retries `5`

### 2b. Add Databases

1. Click **"New Service"** > **"Database"** > **PostgreSQL** > name it `PG-B`.
2. Link `PG-B` to `frame-homeserver-b` (Railway auto-injects `DATABASE_URL`).
3. Click **"New Service"** > **"Database"** > **Redis** > name it `Redis-B`.
4. Link `Redis-B` to `frame-homeserver-b` (Railway auto-injects `REDIS_URL`).

### 2c. Generate a Public Domain

1. Go to `frame-homeserver-b` > **Settings** > **Networking**.
2. Click **"Generate Domain"** to get a `*.up.railway.app` URL.
3. Note the domain (e.g., `frame-b.up.railway.app`). You will need it for configuration.

---

## Step 3: Configure Environment Variables

### On frame-homeserver-a

Set these variables in the Railway dashboard under `frame-homeserver-a` > **Variables**:

| Variable | Value |
|----------|-------|
| `NODE_ENV` | `production` |
| `JWT_SECRET` | A unique random string, at least 64 characters |
| `BCRYPT_SALT_ROUNDS` | `12` |
| `HOMESERVER_DOMAIN` | `frame-a.up.railway.app` |
| `FEDERATION_SIGNING_KEY` | Base64-encoded Ed25519 private key for Server A (from Step 1) |
| `FEDERATION_PEERS` | `frame-b.up.railway.app` |
| `CORS_ORIGINS` | `https://frame.up.railway.app` |

`DATABASE_URL`, `REDIS_URL`, and `PORT` are auto-injected by Railway.

### On frame-homeserver-b

Set these variables under `frame-homeserver-b` > **Variables**:

| Variable | Value |
|----------|-------|
| `NODE_ENV` | `production` |
| `JWT_SECRET` | A **different** unique random string, at least 64 characters |
| `BCRYPT_SALT_ROUNDS` | `12` |
| `HOMESERVER_DOMAIN` | `frame-b.up.railway.app` |
| `FEDERATION_SIGNING_KEY` | Base64-encoded Ed25519 private key for Server B (from Step 1) |
| `FEDERATION_PEERS` | `frame-a.up.railway.app` |
| `CORS_ORIGINS` | `https://frame.up.railway.app` |

Each server's `FEDERATION_PEERS` points to the other server's domain. For multiple peers, use a comma-separated list: `peer1.example.com,peer2.example.com`.

---

## Step 4: Deploy Both Servers

1. Trigger a redeploy on `frame-homeserver-a` (if env vars changed) by clicking **"Redeploy"** in the Railway dashboard.
2. Deploy `frame-homeserver-b` -- it should auto-deploy once created and configured.
3. Wait for both services to pass health checks.

---

## Step 5: Verify Federation

### 5a. Check Health Endpoints

```bash
SERVER_A="https://frame-a.up.railway.app"
SERVER_B="https://frame-b.up.railway.app"

curl -s "$SERVER_A/health" | jq .
curl -s "$SERVER_B/health" | jq .
```

Both should return HTTP 200 with a JSON body.

### 5b. Check Server Discovery

```bash
curl -s "$SERVER_A/.well-known/frame/server" | jq .
curl -s "$SERVER_B/.well-known/frame/server" | jq .
```

Each should return a JSON object containing the server's host, port, and public key:

```json
{
  "frame.server": {
    "host": "frame-a.up.railway.app",
    "port": 443,
    "publicKey": "<base64-encoded SPKI public key>"
  }
}
```

### 5c. Run the Full Federation Test

Use the provided test script for an end-to-end check:

```bash
./scripts/test-federation.sh "$SERVER_A" "$SERVER_B"
```

This script registers users, creates a room, invites a cross-server user, sends a message, and verifies delivery.

### 5d. Manual Federation Test with curl

Register a user on Server A:

```bash
curl -s -X POST "$SERVER_A/auth/register" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "alice",
    "password": "TestPassword123!",
    "identityKey": "test-identity-key-alice",
    "signedPrekey": "test-signed-prekey-alice",
    "signedPrekeySignature": "test-sig-alice",
    "oneTimePrekeys": ["otk-alice-1"]
  }' | jq .
```

Verify Server B can look up the user via federation directory:

```bash
curl -s "$SERVER_B/federation/query/directory?userId=alice" \
  -H "X-Origin-Server: frame-b.up.railway.app" | jq .
```

Fetch user keys from Server A via federation:

```bash
curl -s "$SERVER_A/federation/keys/alice" | jq .
```

---

## Troubleshooting

### Server discovery returns 404

- Verify `HOMESERVER_DOMAIN` is set correctly on the server.
- Check that the `/.well-known/frame/server` route is registered (inspect server logs).
- Confirm the Railway domain is publicly accessible (try opening it in a browser).

### "Origin server is not a trusted peer" (403)

- Verify `FEDERATION_PEERS` on the receiving server includes the sending server's exact domain.
- Domain must match exactly -- no protocol prefix, no trailing slash.
- Example: `frame-a.up.railway.app`, not `https://frame-a.up.railway.app/`.

### "Invalid signature from origin server" (403)

- The signing key on the sending server does not match what the receiving server fetched via discovery.
- Regenerate keys using `./scripts/generate-federation-keys.sh` and update both servers.
- If you recently rotated keys, wait up to 5 minutes for the peer's key cache to expire.

### Circuit breaker is open

- The federation service tracks consecutive failures per peer. After 5 failures, the circuit opens for 60 seconds.
- Check the peer server's health endpoint. If it is down, wait for it to recover.
- Check Railway logs for connection errors (DNS, TLS, timeouts).

### Events not arriving on the peer server

1. Check that the sender is a member of the room on the receiving server.
2. Check that the room exists on both servers (federated rooms must be joined on both sides).
3. Look at the sending server's logs for relay errors.
4. Check the `results` array in the `/federation/send` response for per-event error messages.

### Database migration failures

- Check the `migrate.sh` output in Railway logs.
- Ensure `DATABASE_URL` is correctly injected (check Railway service variables).
- Try a manual redeploy to re-run migrations.

### TLS errors between servers

- Railway provides automatic TLS. Ensure you are using `https://` URLs.
- If using custom domains, verify the SSL certificate is provisioned (Railway dashboard > Networking).

---

## Network Topology

```
Internet
  │
  ├── https://frame-a.up.railway.app (Homeserver A)
  │     ├── PostgreSQL A (internal)
  │     ├── Redis A (internal)
  │     └── FEDERATION_PEERS: frame-b.up.railway.app
  │
  ├── https://frame-b.up.railway.app (Homeserver B)
  │     ├── PostgreSQL B (internal)
  │     ├── Redis B (internal)
  │     └── FEDERATION_PEERS: frame-a.up.railway.app
  │
  └── https://frame.up.railway.app (Frontend)
        └── Connects to Homeserver A
```

Federation traffic flows over the public internet via HTTPS between the two homeserver domains. Database and Redis connections are internal to Railway's private network.

---

## Adding More Federation Peers

To add a third homeserver (e.g., `frame-c.up.railway.app`):

1. Deploy a new Railway service following the same steps as Step 2.
2. Generate a new signing key for Server C.
3. Update `FEDERATION_PEERS` on all three servers to include all other peers:
   - Server A: `frame-b.up.railway.app,frame-c.up.railway.app`
   - Server B: `frame-a.up.railway.app,frame-c.up.railway.app`
   - Server C: `frame-a.up.railway.app,frame-b.up.railway.app`
4. Redeploy all three services.
