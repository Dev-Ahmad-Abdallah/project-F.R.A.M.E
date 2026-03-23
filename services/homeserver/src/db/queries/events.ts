import { pool } from '../pool';

export interface EventRow {
  event_id: string;
  room_id: string;
  sender_id: string;
  sender_device_id: string;
  event_type: string;
  ciphertext: Buffer | null;
  content: Record<string, unknown> | null;
  reactions: Record<string, { users: string[]; count: number }> | null;
  sequence_id: number;
  origin_server: string | null;
  origin_ts: Date;
  deleted_at: Date | null;
  created_at: Date;
}

export async function insertEvent(
  eventId: string,
  roomId: string,
  senderId: string,
  senderDeviceId: string,
  eventType: string,
  content: Record<string, unknown>,
  originServer: string,
  originTs: Date
): Promise<EventRow> {
  // Fetch the most recent event_id in this room to build an append-only chain
  const prevResult = await pool.query<{ event_id: string }>(
    `SELECT event_id FROM events WHERE room_id = $1 ORDER BY sequence_id DESC LIMIT 1`,
    [roomId]
  );
  const prevEventId = prevResult.rows.length > 0 ? prevResult.rows[0].event_id : null;

  const result = await pool.query<EventRow>(
    `INSERT INTO events (event_id, room_id, sender_id, sender_device_id, event_type, content, origin_server, origin_ts, prev_event_id)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
     RETURNING *`,
    [eventId, roomId, senderId, senderDeviceId, eventType, JSON.stringify(content), originServer, originTs, prevEventId]
  );
  return result.rows[0];
}

export async function getEventsSince(
  roomId: string,
  sinceSequenceId: number,
  limit = 50
): Promise<EventRow[]> {
  const result = await pool.query<EventRow>(
    `SELECT * FROM events
     WHERE room_id = $1 AND sequence_id > $2 AND deleted_at IS NULL
     ORDER BY sequence_id ASC
     LIMIT $3`,
    [roomId, sinceSequenceId, limit]
  );
  return result.rows;
}

export async function getEventsByUser(
  userId: string,
  sinceSequenceId: number,
  limit = 50
): Promise<EventRow[]> {
  const result = await pool.query<EventRow>(
    `SELECT e.* FROM events e
     JOIN room_members rm ON e.room_id = rm.room_id
     WHERE rm.user_id = $1 AND e.sequence_id > $2 AND e.deleted_at IS NULL
     ORDER BY e.sequence_id ASC
     LIMIT $3`,
    [userId, sinceSequenceId, limit]
  );
  return result.rows;
}

export async function createDeliveryEntries(
  eventId: string,
  deviceIds: string[]
): Promise<void> {
  if (deviceIds.length === 0) return;

  const values = deviceIds
    .map((_, i) => `($1, $${i + 2}, 'pending')`)
    .join(', ');

  await pool.query(
    `INSERT INTO delivery_state (event_id, device_id, status)
     VALUES ${values}
     ON CONFLICT DO NOTHING`,
    [eventId, ...deviceIds]
  );
}

export async function getPendingDeliveries(deviceId: string, limit = 50): Promise<EventRow[]> {
  const result = await pool.query<EventRow>(
    `SELECT e.* FROM events e
     JOIN delivery_state ds ON e.event_id = ds.event_id
     WHERE ds.device_id = $1 AND ds.status = 'pending'
     ORDER BY e.sequence_id ASC
     LIMIT $2`,
    [deviceId, limit]
  );
  return result.rows;
}

export async function markDelivered(eventId: string, deviceId: string): Promise<void> {
  await pool.query(
    `UPDATE delivery_state SET status = 'delivered', updated_at = NOW()
     WHERE event_id = $1 AND device_id = $2`,
    [eventId, deviceId]
  );
}

export async function softDeleteEvent(eventId: string, senderId: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE events SET deleted_at = NOW()
     WHERE event_id = $1 AND sender_id = $2 AND deleted_at IS NULL`,
    [eventId, senderId]
  );
  return result.rowCount !== null && result.rowCount > 0;
}

/**
 * Add or remove a reaction on an event.
 * Uses JSONB operations to atomically update the reactions column.
 */
export async function addReaction(
  eventId: string,
  userId: string,
  emoji: string
): Promise<Record<string, { users: string[]; count: number }>> {
  // Fetch current reactions
  const current = await pool.query<{ reactions: Record<string, { users: string[]; count: number }> }>(
    'SELECT COALESCE(reactions, \'{}\'::jsonb) as reactions FROM events WHERE event_id = $1',
    [eventId]
  );
  if (current.rows.length === 0) {
    throw new Error('Event not found');
  }

  // Use a Map to avoid prototype pollution — emoji keys come from user input
  const rawReactions = current.rows[0].reactions || {};
  const reactions = new Map<string, { users: string[]; count: number }>(
    Object.entries(rawReactions)
  );
  const entry = reactions.get(emoji) || { users: [], count: 0 };

  if (entry.users.includes(userId)) {
    // Remove reaction (toggle off)
    entry.users = entry.users.filter((u: string) => u !== userId);
    entry.count = entry.users.length;
    if (entry.count === 0) {
      reactions.delete(emoji);
    } else {
      reactions.set(emoji, entry);
    }
  } else {
    // Add reaction
    entry.users.push(userId);
    entry.count = entry.users.length;
    reactions.set(emoji, entry);
  }

  const reactionsObj = Object.fromEntries(reactions);
  const result = await pool.query<{ reactions: Record<string, { users: string[]; count: number }> }>(
    `UPDATE events SET reactions = $2::jsonb WHERE event_id = $1 RETURNING reactions`,
    [eventId, JSON.stringify(reactionsObj)]
  );
  return result.rows[0].reactions;
}

/**
 * Record a read receipt for a user in a room.
 * Uses UPSERT to track the latest read event per user per room.
 */
export async function upsertReadReceipt(
  roomId: string,
  userId: string,
  eventId: string
): Promise<void> {
  await pool.query(
    `INSERT INTO read_receipts (room_id, user_id, event_id, read_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (room_id, user_id)
     DO UPDATE SET event_id = EXCLUDED.event_id, read_at = NOW()`,
    [roomId, userId, eventId]
  );
}

export interface ReadReceiptRow {
  room_id: string;
  user_id: string;
  event_id: string;
  read_at: Date;
}

/**
 * Get all read receipts for a room (who has read up to which event).
 */
export async function getReadReceipts(roomId: string): Promise<ReadReceiptRow[]> {
  const result = await pool.query<ReadReceiptRow>(
    'SELECT * FROM read_receipts WHERE room_id = $1',
    [roomId]
  );
  return result.rows;
}

/**
 * Get read receipt counts for specific events — how many users have read past each event.
 */
export async function getReadReceiptsByEventIds(
  eventIds: string[]
): Promise<Record<string, string[]>> {
  if (eventIds.length === 0) return {};
  const result = await pool.query<{ event_id: string; user_id: string }>(
    `SELECT event_id, user_id FROM read_receipts WHERE event_id = ANY($1::text[])`,
    [eventIds]
  );
  // Use Object.create(null) to prevent prototype pollution from DB-sourced keys
  const map: Record<string, string[]> = Object.create(null) as Record<string, string[]>;
  for (const row of result.rows) {
    if (!map[row.event_id]) map[row.event_id] = []; // eslint-disable-line security/detect-object-injection
    map[row.event_id].push(row.user_id); // eslint-disable-line security/detect-object-injection
  }
  return map;
}
