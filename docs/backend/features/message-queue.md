# Feature: Message Queue & Store-and-Forward

**Owner:** Ahmed Ali Abdallah (234742)
**Priority:** Week 3
**Status:** Planned

---

## Overview

The message queue implements store-and-forward delivery for encrypted messages. When a recipient is offline, messages are queued and delivered when the device reconnects. The server stores only encrypted blobs — it never reads or modifies message content.

---

## How It Works

```
Sender Client                    Homeserver                     Recipient Client
     │                               │                               │
     │  POST /messages/send          │                               │
     │  { roomId, ciphertext }       │                               │
     │──────────────────────────────►│                               │
     │                               │  Store encrypted event        │
     │                               │  Assign sequence_id           │
     │                               │  Queue for each recipient     │
     │                               │  device                       │
     │                               │                               │
     │                               │  (If recipient online)        │
     │                               │  Push wake-up signal           │
     │                               │──────────────────────────────►│
     │                               │                               │
     │                               │  GET /messages/sync            │
     │                               │  ?since=last_sequence_id       │
     │                               │◄──────────────────────────────│
     │                               │                               │
     │                               │  Return queued events          │
     │                               │──────────────────────────────►│
     │                               │                               │
     │                               │  Mark as delivered             │
```

---

## Components

### Redis Queue
- Temporary queue for pending deliveries
- Fast pub/sub for real-time delivery notifications
- Each device has its own queue (fan-out from room events)
- Queue entries: `{ event_id, room_id, timestamp }`

### PostgreSQL Event Storage
- Permanent storage of encrypted events
- Immutable: events are append-only, never modified
- Schema: `event_id, room_id, sender_device_id, ciphertext, sequence_id, timestamp`
- Sequenced: each event gets a monotonically increasing sequence_id per room

### Delivery State Tracking
- Per-device delivery status: `pending → delivered → acknowledged`
- Client confirms receipt → server updates delivery state
- Failed deliveries retried by background worker

---

## Sync Protocol

The client syncs using incremental sequence IDs:

```
GET /messages/sync?since=42&limit=50

Response:
{
  "events": [
    { "event_id": "...", "room_id": "...", "ciphertext": "...", "sequence_id": 43 },
    { "event_id": "...", "room_id": "...", "ciphertext": "...", "sequence_id": 44 }
  ],
  "next_batch": 44,
  "has_more": false
}
```

Client stores `next_batch` locally and uses it for the next sync request.

---

## Fan-Out Strategy

When a message arrives for a room with multiple member devices:

```
Event received for Room X (3 members × 2 devices each = 6 devices)
  → Create delivery entry for Device 1a (pending)
  → Create delivery entry for Device 1b (pending)
  → Create delivery entry for Device 2a (pending)
  → Create delivery entry for Device 2b (pending)
  → Create delivery entry for Device 3a (pending)
  → Create delivery entry for Device 3b (pending)
  → Push wake-up signal to all online devices
```

---

## Security Considerations

1. **Server never reads ciphertext** — stored and forwarded as opaque blobs
2. **Sequence IDs prevent replay** — client rejects events with old/duplicate sequence_ids
3. **Delivery state is metadata** — minimize retention; purge after confirmation
4. **Rate limit message sending** — prevent flooding
5. **Message size limits** — enforce max payload size
6. **No message content in logs** — log event_id, room_id, timestamp only
