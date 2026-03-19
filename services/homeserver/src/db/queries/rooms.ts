import { pool } from '../pool';
import crypto from 'crypto';

export interface RoomRow {
  room_id: string;
  room_type: 'direct' | 'group';
  created_by: string;
  created_at: Date;
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
  homeserver: string
): Promise<RoomRow> {
  const roomId = `!${crypto.randomBytes(12).toString('hex')}:${homeserver}`;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const roomResult = await client.query(
      `INSERT INTO rooms (room_id, room_type, created_by)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [roomId, roomType, createdBy]
    );

    // Creator is automatically an admin member
    await client.query(
      `INSERT INTO room_members (room_id, user_id, role)
       VALUES ($1, $2, 'admin')`,
      [roomId, createdBy]
    );

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
  const result = await pool.query(
    'SELECT * FROM room_members WHERE room_id = $1',
    [roomId]
  );
  return result.rows;
}

export async function getRoomMembersWithDeviceCounts(roomId: string): Promise<RoomMemberWithDeviceCount[]> {
  const result = await pool.query(
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
  const result = await pool.query(
    `SELECT r.* FROM rooms r
     JOIN room_members rm ON r.room_id = rm.room_id
     WHERE rm.user_id = $1
     ORDER BY r.created_at DESC`,
    [userId]
  );
  return result.rows;
}

export interface RoomWithMembers extends RoomRow {
  members: { user_id: string; role: string }[];
}

export async function getUserRoomsWithMembers(userId: string): Promise<RoomWithMembers[]> {
  // Get rooms the user belongs to
  const roomsResult = await pool.query(
    `SELECT r.* FROM rooms r
     JOIN room_members rm ON r.room_id = rm.room_id
     WHERE rm.user_id = $1
     ORDER BY r.created_at DESC`,
    [userId]
  );

  if (roomsResult.rows.length === 0) return [];

  // Get all members for these rooms in a single query
  const roomIds = roomsResult.rows.map((r: RoomRow) => r.room_id);
  const membersResult = await pool.query(
    `SELECT room_id, user_id, role FROM room_members WHERE room_id = ANY($1::text[])`,
    [roomIds]
  );

  // Group members by room
  const membersByRoom: Record<string, { user_id: string; role: string }[]> = {};
  for (const m of membersResult.rows) {
    if (!membersByRoom[m.room_id]) membersByRoom[m.room_id] = [];
    membersByRoom[m.room_id].push({ user_id: m.user_id, role: m.role });
  }

  return roomsResult.rows.map((r: RoomRow) => ({
    ...r,
    members: membersByRoom[r.room_id] || [],
  }));
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

export async function isRoomMember(roomId: string, userId: string): Promise<boolean> {
  const result = await pool.query(
    'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2',
    [roomId, userId]
  );
  return result.rowCount !== null && result.rowCount > 0;
}
