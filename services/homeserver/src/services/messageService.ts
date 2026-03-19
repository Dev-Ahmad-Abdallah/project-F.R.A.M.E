import crypto from 'crypto';
import { getConfig } from '../config';
import { insertEvent, getEventsByUser, createDeliveryEntries } from '../db/queries/events';
import { isRoomMember, getRoomMembers } from '../db/queries/rooms';
import { pool } from '../db/pool';
import { redisClient, redisSubscriber } from '../redis/client';
import { ApiError } from '../middleware/errorHandler';
import { relayEventToPeers } from './federationService';
import type { FederationEvent } from '@frame/shared/federation';

const config = getConfig();

export interface SendMessageParams {
  roomId: string;
  senderId: string;
  senderDeviceId: string;
  eventType: string;
  content: Record<string, unknown>;
}

/**
 * Server-side cleanup: soft-delete messages that have exceeded the room's
 * disappearing messages timeout. Called periodically and before sync.
 *
 * This ensures messages are actually removed server-side, not just hidden
 * on the client. The content is replaced with a tombstone and deleted_at is set.
 */
export async function cleanupExpiredMessages(): Promise<number> {
  const result = await pool.query(
    `UPDATE events e
     SET content = '{"deleted": true, "reason": "expired"}'::jsonb,
         deleted_at = NOW()
     FROM rooms r
     WHERE e.room_id = r.room_id
       AND e.deleted_at IS NULL
       AND r.settings IS NOT NULL
       AND (r.settings->'disappearingMessages'->>'enabled')::boolean = true
       AND (r.settings->'disappearingMessages'->>'timeoutSeconds')::int > 0
       AND e.origin_ts < NOW() - (
         ((r.settings->'disappearingMessages'->>'timeoutSeconds')::int) * INTERVAL '1 second'
       )`,
  );
  return result.rowCount ?? 0;
}

// Run cleanup every 30 seconds
setInterval(() => {
  cleanupExpiredMessages().catch((err: unknown) =>
    console.error('[Disappearing] Cleanup error:', err),
  );
}, 30_000);

export async function sendMessage(params: SendMessageParams) {
  const { roomId, senderId, senderDeviceId, eventType, content } = params;

  // Verify sender is a member of the room
  if (!(await isRoomMember(roomId, senderId))) {
    throw new ApiError(403, 'M_FORBIDDEN', 'Not a member of this room');
  }

  // Generate event ID
  const eventId = `$${crypto.randomBytes(16).toString('hex')}`;

  // Store encrypted event
  const event = await insertEvent(
    eventId,
    roomId,
    senderId,
    senderDeviceId,
    eventType,
    content,
    config.HOMESERVER_DOMAIN,
    new Date()
  );

  // Fan out: create delivery entries for all member devices
  // Single query for all member devices (fixes N+1 — Perf Finding 1)
  const members = await getRoomMembers(roomId);
  const memberIds = members.map((m) => m.user_id);

  const deviceResult = await pool.query<{ device_id: string }>(
    'SELECT device_id FROM devices WHERE user_id = ANY($1::text[])',
    [memberIds]
  );

  const allDeviceIds = deviceResult.rows
    .map((r) => r.device_id)
    .filter((id) => id !== senderDeviceId);

  await createDeliveryEntries(eventId, allDeviceIds);

  // Notify via Redis pub/sub in parallel (fixes sequential publish — Perf Finding 2).
  // SECURITY: Only metadata (IDs) is published — no message content or encryption
  // material passes through Redis. Actual content is fetched via authenticated /messages/sync.
  const notification = JSON.stringify({ eventId, roomId, sequenceId: event.sequence_id });
  await Promise.all(
    allDeviceIds.map((deviceId) =>
      redisClient.publish(`device:${deviceId}`, notification)
    )
  );

  // Relay to federation peers that have members in this room (targeted relay).
  // Extract unique remote domains from member user IDs instead of broadcasting
  // to all configured peers — avoids leaking events to unrelated servers.
  const remoteDomains = new Set(
    members
      .map((m) => {
        const idx = m.user_id.indexOf(':');
        return idx !== -1 ? m.user_id.slice(idx + 1) : null;
      })
      .filter((domain): domain is string => domain !== null && domain !== config.HOMESERVER_DOMAIN)
  );

  if (remoteDomains.size > 0) {
    const federationEvent: FederationEvent = {
      origin: config.HOMESERVER_DOMAIN,
      originServerTs: Date.now(),
      eventId,
      roomId,
      sender: senderId,
      eventType,
      content,
      signatures: {},
    };
    // Fire and forget — don't block the sender on federation relay
    relayEventToPeers(federationEvent, [...remoteDomains]).catch((err: unknown) =>
      console.error('[Federation] Relay failed after sendMessage:', err)
    );
  }

  return {
    eventId,
    sequenceId: event.sequence_id,
  };
}

/**
 * Soft-delete a message. Only the original sender may delete their own message.
 * The row is not removed; instead a deleted_at timestamp is set and the content
 * is replaced with a tombstone so the ciphertext is no longer available.
 */
export async function deleteMessage(eventId: string, userId: string): Promise<void> {
  // Verify the event exists and the user is the sender
  const result = await pool.query<{ sender_id: string }>(
    'SELECT sender_id FROM events WHERE event_id = $1',
    [eventId],
  );

  if (result.rows.length === 0) {
    throw new ApiError(404, 'M_NOT_FOUND', 'Message not found');
  }

  if (result.rows[0].sender_id !== userId) {
    throw new ApiError(403, 'M_FORBIDDEN', 'You can only delete your own messages');
  }

  // Soft-delete: set deleted_at and clear content
  await pool.query(
    `UPDATE events
     SET content = '{"deleted": true}'::jsonb,
         deleted_at = NOW()
     WHERE event_id = $1`,
    [eventId],
  );
}

/**
 * Mark to-device messages as acknowledged by the client.
 * This removes the messages from the database so they won't be re-delivered.
 */
export async function acknowledgeToDeviceMessages(
  userId: string,
  deviceId: string,
  messageIds: number[],
): Promise<number> {
  if (messageIds.length === 0) return 0;

  // Only delete messages that belong to this user/device to prevent abuse
  const result = await pool.query(
    `DELETE FROM to_device_messages
     WHERE id = ANY($1::bigint[])
       AND recipient_user_id = $2
       AND recipient_device_id = $3`,
    [messageIds, userId, deviceId],
  );
  return result.rowCount ?? 0;
}

interface ToDeviceRow {
  id: string;
  sender_user_id: string;
  sender_device_id: string;
  event_type: string;
  content: unknown;
}

export async function syncMessages(
  userId: string,
  deviceId: string,
  since: number,
  limit: number,
  timeout: number
): Promise<{ events: Record<string, unknown>[]; nextBatch: string; hasMore: boolean; to_device?: unknown[] }> {
  // NOTE: cleanupExpiredMessages() runs on a 30s setInterval — calling it
  // on every sync poll would create heavy DB load under many concurrent users.

  // Clean up stale claimed messages for THIS user/device only
  // (client disconnected mid-response more than 5 min ago).
  // Scoped to avoid deleting messages claimed by other users with slow connections.
  await pool.query(
    `DELETE FROM to_device_messages
     WHERE recipient_user_id = $1 AND recipient_device_id = $2
       AND claimed_at IS NOT NULL AND claimed_at < NOW() - INTERVAL '5 minutes'`,
    [userId, deviceId]
  );

  // Fetch unclaimed to-device messages and mark them as claimed atomically
  const toDeviceResult = await pool.query<ToDeviceRow>(
    `UPDATE to_device_messages
     SET claimed_at = NOW()
     WHERE id IN (
       SELECT id FROM to_device_messages
       WHERE recipient_user_id = $1 AND recipient_device_id = $2
         AND claimed_at IS NULL
       FOR UPDATE
     )
     RETURNING id, sender_user_id, sender_device_id, event_type, content`,
    [userId, deviceId]
  );

  const claimedToDeviceIds = toDeviceResult.rows.map((row) => row.id);

  const toDeviceEvents = toDeviceResult.rows.map((row) => ({
    id: Number(row.id),
    sender: row.sender_user_id,
    sender_device: row.sender_device_id,
    type: row.event_type,
    content: row.content,
  }));

  // Check for pending room events
  let events = await getEventsByUser(userId, since, limit);

  // Long-polling: if no events and no to-device messages and timeout > 0, wait
  if (events.length === 0 && toDeviceEvents.length === 0 && timeout > 0) {
    events = await waitForEvents(userId, deviceId, since, limit, timeout);
  }

  // Mark as delivered in batch
  if (events.length > 0) {
    const eventIds = events.map((e) => e.event_id);
    await pool.query(
      `UPDATE delivery_state SET status = 'delivered', updated_at = NOW()
       WHERE event_id = ANY($1::text[]) AND device_id = $2`,
      [eventIds, deviceId]
    );
  }

  // Delete claimed to-device messages now that the response is fully built
  if (claimedToDeviceIds.length > 0) {
    await pool.query(
      `DELETE FROM to_device_messages WHERE id = ANY($1::bigint[])`,
      [claimedToDeviceIds]
    );
  }

  const lastSeq = events.length > 0 ? events[events.length - 1].sequence_id : since;

  return {
    events: events.map((e) => ({
      eventId: e.event_id,
      roomId: e.room_id,
      senderId: e.sender_id,
      senderDeviceId: e.sender_device_id,
      eventType: e.event_type,
      content: e.content,
      originServerTs: e.origin_ts,
      sequenceId: e.sequence_id,
    })),
    nextBatch: String(lastSeq),
    hasMore: events.length >= limit,
    to_device: toDeviceEvents.length > 0 ? toDeviceEvents : undefined,
  };
}

type EventRows = Awaited<ReturnType<typeof getEventsByUser>>;

async function waitForEvents(
  userId: string,
  deviceId: string,
  since: number,
  limit: number,
  timeout: number
): Promise<EventRows> {
  return new Promise((resolve) => {
    const channel = `device:${deviceId}`;
    let resolved = false;

    const cleanup = () => {
      if (resolved) return;
      resolved = true;
      redisSubscriber.removeListener('message', onMessage);
      redisSubscriber.unsubscribe(channel).catch(() => { /* ignore */ });
    };

    const timer = setTimeout(() => {
      cleanup();
      void getEventsByUser(userId, since, limit).then(resolve);
    }, timeout);

    const onMessage = (ch: string, _msg: string) => {
      if (ch !== channel) return;
      clearTimeout(timer);
      cleanup();
      void getEventsByUser(userId, since, limit).then(resolve);
    };

    // Use dedicated subscriber client (never the command client)
    redisSubscriber.on('message', onMessage);
    redisSubscriber.subscribe(channel).catch(() => {
      clearTimeout(timer);
      cleanup();
      resolve([]);
    });
  });
}
