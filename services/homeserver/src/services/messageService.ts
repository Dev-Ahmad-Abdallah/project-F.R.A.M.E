import crypto from 'crypto';
import { getConfig } from '../config';
import { insertEvent, getEventsByUser, createDeliveryEntries, getPendingDeliveries, markDelivered } from '../db/queries/events';
import { isRoomMember, getRoomMembers } from '../db/queries/rooms';
import { findDevicesByUser } from '../db/queries/devices';
import { pool } from '../db/pool';
import { redisClient, redisSubscriber } from '../redis/client';
import { ApiError } from '../middleware/errorHandler';
import { relayEventToAllPeers } from './federationService';
import type { FederationEvent } from '@frame/shared/federation';

const config = getConfig();

export interface SendMessageParams {
  roomId: string;
  senderId: string;
  senderDeviceId: string;
  eventType: string;
  content: Record<string, unknown>;
}

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

  const deviceResult = await pool.query(
    'SELECT device_id FROM devices WHERE user_id = ANY($1::text[])',
    [memberIds]
  );

  const allDeviceIds = deviceResult.rows
    .map((r: { device_id: string }) => r.device_id)
    .filter((id: string) => id !== senderDeviceId);

  await createDeliveryEntries(eventId, allDeviceIds);

  // Notify via Redis pub/sub in parallel (fixes sequential publish — Perf Finding 2)
  const notification = JSON.stringify({ eventId, roomId, sequenceId: event.sequence_id });
  await Promise.all(
    allDeviceIds.map((deviceId: string) =>
      redisClient.publish(`device:${deviceId}`, notification)
    )
  );

  // Relay to federation peers if room has remote members
  const hasRemoteMembers = members.some(
    (m) => !m.user_id.endsWith(`:${config.HOMESERVER_DOMAIN}`)
  );

  if (hasRemoteMembers) {
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
    relayEventToAllPeers(federationEvent).catch((err) =>
      console.error('[Federation] Relay failed after sendMessage:', err)
    );
  }

  return {
    eventId,
    sequenceId: event.sequence_id,
  };
}

export async function syncMessages(
  userId: string,
  deviceId: string,
  since: number,
  limit: number,
  timeout: number
): Promise<{ events: Record<string, unknown>[]; nextBatch: string; hasMore: boolean }> {
  // First check for pending events
  let events = await getEventsByUser(userId, since, limit);

  // Long-polling: if no events and timeout > 0, wait for new events
  if (events.length === 0 && timeout > 0) {
    events = await waitForEvents(userId, deviceId, since, limit, timeout);
  }

  // Mark as delivered in batch (fixes N+1 sequential updates)
  if (events.length > 0) {
    const eventIds = events.map((e) => e.event_id);
    await pool.query(
      `UPDATE delivery_state SET status = 'delivered', updated_at = NOW()
       WHERE event_id = ANY($1::text[]) AND device_id = $2`,
      [eventIds, deviceId]
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
  };
}

async function waitForEvents(
  userId: string,
  deviceId: string,
  since: number,
  limit: number,
  timeout: number
): Promise<ReturnType<typeof getEventsByUser> extends Promise<infer T> ? T : never> {
  return new Promise((resolve) => {
    const channel = `device:${deviceId}`;
    let resolved = false;

    const cleanup = () => {
      if (resolved) return;
      resolved = true;
      redisSubscriber.removeListener('message', onMessage);
      redisSubscriber.unsubscribe(channel).catch(() => {});
    };

    const timer = setTimeout(async () => {
      cleanup();
      const events = await getEventsByUser(userId, since, limit);
      resolve(events);
    }, timeout);

    const onMessage = async (ch: string, _msg: string) => {
      if (ch !== channel) return;
      clearTimeout(timer);
      cleanup();
      const events = await getEventsByUser(userId, since, limit);
      resolve(events);
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
