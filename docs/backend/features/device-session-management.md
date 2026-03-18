# Feature: Device & Session Management

**Owner:** Ahmed Ali Abdallah (234742)
**Priority:** Week 6
**Status:** Planned

---

## Overview

The backend tracks registered devices per user and handles message fan-out to all devices. Device management is critical for multi-device support — the server maintains the device list, but the client is responsible for verifying device authenticity.

---

## Device Lifecycle

```
1. REGISTER: New device generates keys → POST /devices/register
   Server stores: { device_id, user_id, device_public_key, display_name }

2. ACTIVE: Device syncs messages, sends/receives encrypted events
   Server fans out events to all user's devices

3. VERIFY: Client-side — existing device verifies new device via QR
   Server stores verification status (but client is source of truth)

4. REVOKE: User removes device → DELETE /devices/:deviceId
   Server removes from device list, stops fan-out
   Client triggers key rotation in affected rooms
```

---

## Endpoints

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/devices/register` | POST | JWT | Register new device with public key |
| `/devices/:userId` | GET | JWT | List all devices for a user |
| `/devices/:deviceId` | DELETE | JWT | Remove/revoke a device |

### Registration Payload

```json
{
  "device_id": "DEVICE_A1",
  "device_display_name": "Mohamed's Laptop",
  "device_public_key": "Curve25519:...",
  "device_signing_key": "Ed25519:..."
}
```

---

## Fan-Out Logic

When an encrypted event arrives for a room:

```
1. Look up room members
2. For each member:
   a. Look up all registered devices
   b. For each device:
      - Create delivery queue entry
      - If device is online → push wake-up signal
3. Each device syncs independently using its own sequence pointer
```

### Multi-Device Crypto Implication
- The **server does NOT re-encrypt** for each device
- The **sender's client** encrypts separately for each recipient device using per-device Olm sessions
- The server simply fans out the pre-encrypted payloads to the correct devices

---

## Session State

The server tracks minimal session state:
- Which devices exist per user
- Which devices are online (for push delivery)
- Delivery state per device per event

The server does NOT store:
- Olm/Megolm session state (client-only)
- Decryption keys
- Message plaintext

---

## Re-Synchronization

When a device reconnects after being offline:
```
1. Device sends: GET /messages/sync?since=<last_sequence_id>
2. Server returns all events since that sequence_id
3. Device decrypts events using its local crypto state
4. If crypto state is stale/corrupted → device requests new Olm sessions from peers
```

---

## Security Considerations

1. **Device list changes must be visible to clients** — any new device should trigger a notification
2. **Replay/ordering checks** — server must ensure event ordering is consistent
3. **Minimal metadata retention** — device last_seen timestamp is useful but privacy-sensitive
4. **Device limit per user** — prevent resource exhaustion (suggest max 10 devices)
5. **Revoked devices should not receive future events** — immediate removal from fan-out
6. **Clone detection** — if two sessions claim the same device_id, flag as suspicious
