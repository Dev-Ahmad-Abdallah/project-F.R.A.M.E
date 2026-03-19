import { pool } from '../pool';

export interface EventRow {
  event_id: string;
  room_id: string;
  sender_id: string;
  sender_device_id: string;
  event_type: string;
  ciphertext: Buffer | null;
  content: Record<string, unknown> | null;
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
  const result = await pool.query(
    `INSERT INTO events (event_id, room_id, sender_id, sender_device_id, event_type, content, origin_server, origin_ts)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
     RETURNING *`,
    [eventId, roomId, senderId, senderDeviceId, eventType, JSON.stringify(content), originServer, originTs]
  );
  return result.rows[0];
}

export async function getEventsSince(
  roomId: string,
  sinceSequenceId: number,
  limit: number = 50
): Promise<EventRow[]> {
  const result = await pool.query(
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
  limit: number = 50
): Promise<EventRow[]> {
  const result = await pool.query(
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

export async function getPendingDeliveries(deviceId: string, limit: number = 50): Promise<EventRow[]> {
  const result = await pool.query(
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
