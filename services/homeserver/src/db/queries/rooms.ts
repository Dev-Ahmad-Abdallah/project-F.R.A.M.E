import { pool } from '../pool';
import crypto from 'crypto';

export interface RoomRow {
  room_id: string;
  room_type: 'direct' | 'group';
  name: string | null;
  settings: Record<string, unknown>;
  created_by: string;
  created_at: Date;
  invite_code: string | null;
}

export interface RoomMemberRow {
  room_id: string;
  user_id: string;
  role: 'member' | 'admin';
  joined_at: Date;
}

export interface RoomMemberWithDeviceCount extends RoomMemberRow {
  device_count: number;
}

export async function createRoom(
  roomType: 'direct' | 'group',
  createdBy: string,
  homeserver: string,
  name?: string,
  inviteUserIds: string[] = [],
): Promise<RoomRow> {
  const roomId = `!${crypto.randomBytes(12).toString('hex')}:${homeserver}`;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const inviteCode = generateInviteCode();

    const roomResult = await client.query<RoomRow>(
      `INSERT INTO rooms (room_id, room_type, created_by, name, invite_code)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [roomId, roomType, createdBy, name || null, inviteCode]
    );

    // Creator is automatically an admin member
    await client.query(
      `INSERT INTO room_members (room_id, user_id, role)
       VALUES ($1, $2, 'admin')`,
      [roomId, createdBy]
    );

    // Add invited members within the same transaction
    for (const inviteeId of inviteUserIds) {
      await client.query(
        `INSERT INTO room_members (room_id, user_id, role)
         VALUES ($1, $2, 'member')
         ON CONFLICT (room_id, user_id) DO NOTHING`,
        [roomId, inviteeId]
      );
    }

    await client.query('COMMIT');
    return roomResult.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function addRoomMember(
  roomId: string,
  userId: string,
  role: 'member' | 'admin' = 'member'
): Promise<void> {
  await pool.query(
    `INSERT INTO room_members (room_id, user_id, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (room_id, user_id) DO NOTHING`,
    [roomId, userId, role]
  );
}

export async function getRoomMembers(roomId: string): Promise<RoomMemberRow[]> {
  const result = await pool.query<RoomMemberRow>(
    'SELECT * FROM room_members WHERE room_id = $1',
    [roomId]
  );
  return result.rows;
}

export async function getRoomMembersWithDeviceCounts(roomId: string): Promise<RoomMemberWithDeviceCount[]> {
  const result = await pool.query<RoomMemberWithDeviceCount>(
    `SELECT rm.*, COALESCE(COUNT(d.device_id), 0)::int AS device_count
     FROM room_members rm
     LEFT JOIN devices d ON rm.user_id = d.user_id
     WHERE rm.room_id = $1
     GROUP BY rm.room_id, rm.user_id, rm.role, rm.joined_at`,
    [roomId]
  );
  return result.rows;
}

export async function getUserRooms(userId: string): Promise<RoomRow[]> {
  const result = await pool.query<RoomRow>(
    `SELECT r.* FROM rooms r
     JOIN room_members rm ON r.room_id = rm.room_id
     WHERE rm.user_id = $1
     ORDER BY r.created_at DESC`,
    [userId]
  );
  return result.rows;
}

export interface LastMessage {
  content: Record<string, unknown>;
  timestamp: Date;
  senderId?: string;
}

export interface RoomWithMembers extends RoomRow {
  members: { user_id: string; role: string; display_name: string | null }[];
  lastMessage: LastMessage | null;
  unreadCount: number;
}

interface MemberQueryRow {
  room_id: string;
  user_id: string;
  role: string;
  display_name: string | null;
}

export async function getUserRoomsWithMembers(userId: string, deviceId?: string): Promise<RoomWithMembers[]> {
  // Get rooms the user belongs to, with the last message per room via lateral join
  interface RoomWithLastMsg extends RoomRow {
    last_msg_content: Record<string, unknown> | null;
    last_msg_ts: Date | null;
    last_msg_sender: string | null;
  }

  const roomsResult = await pool.query<RoomWithLastMsg>(
    `SELECT r.*, last_msg.content AS last_msg_content, last_msg.origin_ts AS last_msg_ts, last_msg.sender_id AS last_msg_sender
     FROM rooms r
     JOIN room_members rm ON r.room_id = rm.room_id
     LEFT JOIN LATERAL (
       SELECT content, origin_ts, sender_id FROM events
       WHERE events.room_id = r.room_id AND deleted_at IS NULL
       ORDER BY sequence_id DESC LIMIT 1
     ) last_msg ON true
     WHERE rm.user_id = $1
     ORDER BY r.created_at DESC`,
    [userId]
  );

  if (roomsResult.rows.length === 0) return [];

  const roomIds = roomsResult.rows.map((r) => r.room_id);

  // Get all members for these rooms in a single query, joining users for display_name
  const membersResult = await pool.query<MemberQueryRow>(
    `SELECT rm.room_id, rm.user_id, rm.role, u.display_name
     FROM room_members rm
     LEFT JOIN users u ON rm.user_id = u.user_id
     WHERE rm.room_id = ANY($1::text[])`,
    [roomIds]
  );

  // Get unread counts per room (pending delivery_state entries for this device)
  const unreadsByRoom = new Map<string, number>();
  if (deviceId) {
    const unreadResult = await pool.query<{ room_id: string; unread_count: number }>(
      `SELECT e.room_id, COUNT(*)::int AS unread_count
       FROM delivery_state ds
       JOIN events e ON ds.event_id = e.event_id
       WHERE ds.device_id = $1 AND ds.status = 'pending'
       AND e.room_id = ANY($2::text[])
       GROUP BY e.room_id`,
      [deviceId, roomIds]
    );
    for (const row of unreadResult.rows) {
      unreadsByRoom.set(row.room_id, row.unread_count);
    }
  }

  // Group members by room using a Map
  const membersByRoom = new Map<string, { user_id: string; role: string; display_name: string | null }[]>();
  for (const m of membersResult.rows) {
    const member = { user_id: m.user_id, role: m.role, display_name: m.display_name };
    const roomMembers = membersByRoom.get(m.room_id);
    if (roomMembers) {
      roomMembers.push(member);
    } else {
      membersByRoom.set(m.room_id, [member]);
    }
  }

  return roomsResult.rows.map((r) => ({
    room_id: r.room_id,
    room_type: r.room_type,
    name: r.name,
    settings: r.settings,
    created_by: r.created_by,
    created_at: r.created_at,
    invite_code: r.invite_code,
    members: membersByRoom.get(r.room_id) || [],
    lastMessage: r.last_msg_content
      ? { content: r.last_msg_content, timestamp: r.last_msg_ts ?? new Date(), senderId: r.last_msg_sender ?? undefined }
      : null,
    unreadCount: unreadsByRoom.get(r.room_id) ?? 0,
  }));
}

/**
 * Get unread counts for a user's device across all rooms.
 * Counts pending delivery_state entries grouped by room_id.
 */
export async function getUnreadCountsForUser(
  userId: string,
  deviceId: string,
): Promise<Map<string, number>> {
  const result = await pool.query<{ room_id: string; unread_count: number }>(
    `SELECT e.room_id, COUNT(*)::int AS unread_count
     FROM delivery_state ds
     JOIN events e ON ds.event_id = e.event_id
     JOIN room_members rm ON e.room_id = rm.room_id AND rm.user_id = $1
     WHERE ds.device_id = $2 AND ds.status = 'pending'
     GROUP BY e.room_id`,
    [userId, deviceId]
  );

  const counts = new Map<string, number>();
  for (const row of result.rows) {
    counts.set(row.room_id, row.unread_count);
  }
  return counts;
}

export async function usersShareRoom(userIdA: string, userIdB: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM room_members a
     JOIN room_members b ON a.room_id = b.room_id
     WHERE a.user_id = $1 AND b.user_id = $2
     LIMIT 1`,
    [userIdA, userIdB]
  );
  return result.rowCount !== null && result.rowCount > 0;
}

export async function updateRoomName(roomId: string, name: string): Promise<RoomRow> {
  const result = await pool.query<RoomRow>(
    `UPDATE rooms SET name = $2 WHERE room_id = $1 RETURNING *`,
    [roomId, name]
  );
  if (result.rows.length === 0) {
    throw new Error('Room not found');
  }
  return result.rows[0];
}

export async function updateRoomSettings(roomId: string, settings: Record<string, unknown>): Promise<RoomRow> {
  const result = await pool.query<RoomRow>(
    `UPDATE rooms SET settings = $2::jsonb WHERE room_id = $1 RETURNING *`,
    [roomId, JSON.stringify(settings)]
  );
  if (result.rows.length === 0) {
    throw new Error('Room not found');
  }
  return result.rows[0];
}

export async function removeRoomMember(roomId: string, userId: string): Promise<boolean> {
  const result = await pool.query(
    'DELETE FROM room_members WHERE room_id = $1 AND user_id = $2',
    [roomId, userId]
  );
  return result.rowCount !== null && result.rowCount > 0;
}

export async function isRoomMember(roomId: string, userId: string): Promise<boolean> {
  const result = await pool.query(
    'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2',
    [roomId, userId]
  );
  return result.rowCount !== null && result.rowCount > 0;
}

/**
 * Generate a 4-character tactical FREQ invite code.
 * Format: letter-digit-digit-letter (e.g. "A74B") with non-consecutive digits.
 * Displayed as "FREQ: A7-4B" on the frontend.
 */
export function generateInviteCode(): string {
  // Generate 6-char codes: 3 hex bytes = 6 hex chars (e.g. "A3F5BE")
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

/**
 * Look up a room by its invite code.
 */
export async function findRoomByInviteCode(code: string): Promise<RoomRow | null> {
  const result = await pool.query<RoomRow>(
    'SELECT * FROM rooms WHERE invite_code = $1',
    [code.toUpperCase()]
  );
  return result.rows[0] || null;
}

/**
 * Get the invite code for a room.
 */
export async function getRoomInviteCode(roomId: string): Promise<string | null> {
  const result = await pool.query<{ invite_code: string | null }>(
    'SELECT invite_code FROM rooms WHERE room_id = $1',
    [roomId]
  );
  return result.rows[0]?.invite_code ?? null;
}

/**
 * Regenerate the invite code for a room.
 */
export async function regenerateRoomInviteCode(roomId: string): Promise<string> {
  const newCode = generateInviteCode();
  const result = await pool.query<RoomRow>(
    'UPDATE rooms SET invite_code = $2 WHERE room_id = $1 RETURNING *',
    [roomId, newCode]
  );
  if (result.rows.length === 0) {
    throw new Error('Room not found');
  }
  return newCode;
}

/**
 * Get a member's role in a room.
 */
export async function getRoomMemberRole(roomId: string, userId: string): Promise<string | null> {
  const result = await pool.query<{ role: string }>(
    'SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2',
    [roomId, userId]
  );
  return result.rows[0]?.role ?? null;
}
