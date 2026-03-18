# Feature: Multi-Device Synchronization

**Owner:** Mohamed Hussain (235697)
**Priority:** Week 6
**Status:** Planned

---

## Overview

When a user has multiple devices (phone, laptop, web browser), all devices need synchronized crypto state. A bad actor could try to inject a fake device to intercept messages. F.R.A.M.E. requires explicit user approval for every new device and maintains independent crypto sessions per device pair.

---

## How It Works

### Device Registration
1. Each device generates its own identity key pair independently
2. Device registers its public key with homeserver: `POST /devices/register`
3. Homeserver adds device to user's device list

### Device Linking (New Device Approval)
1. New device shows a QR code containing its public key fingerprint
2. Existing trusted device scans the QR code
3. Existing device verifies the fingerprint matches what the server reports
4. Existing device approves the new device (signs its key)
5. New device is now "trusted" and begins receiving encrypted events

### Per-Device Crypto Sessions
- Each device-to-device pair gets its own independent Olm ratchet
- Device A ↔ Contact's Device 1: separate session
- Device A ↔ Contact's Device 2: separate session
- Device B ↔ Contact's Device 1: separate session
- This isolation prevents cross-device session contamination

### Unknown Device Alert
- If a device appears on a user's account that wasn't authorized → immediate alert
- User can: verify the device, or remove it and rotate keys

---

## Implementation

### Key Files

```
src/devices/
├── deviceManager.ts     # Register, list, verify, remove devices
├── deviceLinking.tsx    # QR code based device linking UI
└── deviceAlert.tsx      # Alert for unknown new devices
```

### deviceManager.ts

**Responsibilities:**
- Register current device with homeserver
- Fetch device list for any user: `GET /devices/:userId`
- Track which devices are verified (locally signed)
- Detect new/unknown devices that weren't approved
- Remove/revoke devices
- Trigger key rotation when device list changes

### deviceLinking.tsx

**Responsibilities:**
- Generate QR code from current device's public key fingerprint
- Camera-based QR scanner for approving new devices
- Display linking flow with clear steps
- Confirm linking success/failure

### deviceAlert.tsx

**Responsibilities:**
- Monitor device list for unauthorized additions
- Display modal alert for unrecognized devices
- Actions: "Verify Device" / "Remove Device" / "Ignore" (not recommended)
- Log device change events for audit

---

## Security Properties

| Property | How Achieved |
|----------|-------------|
| **No fake device injection** | Every new device must be approved by existing trusted device via QR verification |
| **Session isolation** | Each device pair has independent Olm session — compromise of one doesn't affect others |
| **Device awareness** | Client tracks and verifies all devices on its own — doesn't blindly trust server's device list |
| **Key rotation on change** | When device list changes, create new Megolm outbound session |

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| User loses all devices — can't approve new one | Critical | Backup key mechanism (recovery key stored offline) |
| Device list out of sync between client and server | High | Re-sync on app open; handle conflicts gracefully |
| QR code replay attack | Medium | Include timestamp/nonce in QR payload |
| Too many devices → too many Olm sessions | Medium | Limit max devices per user; prune inactive devices |

---

## Testing

- [ ] Linking a new device requires approval from existing trusted device
- [ ] Unrecognized device registration triggers visible alert in UI
- [ ] Each device pair has independent Olm session
- [ ] Removing a device triggers key rotation in affected rooms
- [ ] Device list correctly reflects all registered devices
