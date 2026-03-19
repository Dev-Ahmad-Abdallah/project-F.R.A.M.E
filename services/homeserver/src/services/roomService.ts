import { getConfig } from '../config';
import {
  createRoom as dbCreateRoom,
  addRoomMember,
  getUserRoomsWithMembers,
  getRoomMembersWithDeviceCounts,
  isRoomMember,
  updateRoomName as dbUpdateRoomName,
  updateRoomSettings as dbUpdateRoomSettings,
  removeRoomMember,
  RoomRow,
  RoomMemberWithDeviceCount,
  RoomWithMembers,
} from '../db/queries/rooms';
import { findUserById } from '../db/queries/users';
import { ApiError } from '../middleware/errorHandler';

const USER_ID_REGEX = /^@[a-zA-Z0-9_-]+:.+$/;

const config = getConfig();

/**
 * Create a new room (direct or group) and invite initial members.
 */
export async function createRoom(
  userId: string,
  roomType: 'direct' | 'group',
  inviteUserIds: string[],
  homeserver: string = config.HOMESERVER_DOMAIN,
  options?: { name?: string; isPrivate?: boolean; password?: string },
): Promise<{ roomId: string; room: RoomRow }> {
  const room = await dbCreateRoom(roomType, userId, homeserver, options?.name);

  // Set room settings if privacy or password is specified
  if (options?.isPrivate || options?.password) {
    const settings: Record<string, unknown> = {};
    if (options.isPrivate) settings.isPrivate = true;
    if (options.password) {
      const bcrypt = await import('bcrypt');
      settings.passwordHash = await bcrypt.hash(options.password, 10);
    }
    await dbUpdateRoomSettings(room.room_id, settings);
  }

  // Add invited members in parallel
  await Promise.all(
    inviteUserIds.map((inviteeId) => addRoomMember(room.room_id, inviteeId, 'member'))
  );

  return { roomId: room.room_id, room };
}

/**
 * List all rooms the user is a member of, including member lists.
 */
export async function getUserRooms(userId: string): Promise<RoomWithMembers[]> {
  return getUserRoomsWithMembers(userId);
}

/**
 * Invite a user to a room. The requester must be a current member.
 */
export async function inviteToRoom(
  roomId: string,
  requestingUserId: string,
  targetUserId: string,
): Promise<{ success: boolean }> {
  const isMember = await isRoomMember(roomId, requestingUserId);
  if (!isMember) {
    throw new ApiError(403, 'M_FORBIDDEN', 'Not a member of this room');
  }

  if (!targetUserId) {
    throw new ApiError(400, 'M_BAD_JSON', 'Missing userId in request body');
  }

  // Validate userId format (@username:server)
  if (!USER_ID_REGEX.test(targetUserId)) {
    throw new ApiError(400, 'M_INVALID_PARAM', 'Invalid userId format. Expected @username:server');
  }

  // Verify target user exists
  const targetUser = await findUserById(targetUserId);
  if (!targetUser) {
    throw new ApiError(404, 'M_NOT_FOUND', 'Target user does not exist');
  }

  // Check for duplicate membership
  const alreadyMember = await isRoomMember(roomId, targetUserId);
  if (alreadyMember) {
    throw new ApiError(409, 'M_ALREADY_JOINED', 'User is already a member of this room');
  }

  await addRoomMember(roomId, targetUserId, 'member');
  return { success: true };
}

/**
 * Join a room (by invite). The user must already have a pending membership
 * entry, or we allow open join for now.
 */
export async function joinRoom(
  roomId: string,
  userId: string,
): Promise<{ joined: boolean }> {
  const alreadyMember = await isRoomMember(roomId, userId);
  if (alreadyMember) {
    return { joined: true };
  }

  await addRoomMember(roomId, userId, 'member');
  return { joined: true };
}

/**
 * Rename a room. The requesting user must be a member of the room.
 */
export async function renameRoom(
  roomId: string,
  userId: string,
  newName: string,
): Promise<{ success: boolean; name: string }> {
  const isMember = await isRoomMember(roomId, userId);
  if (!isMember) {
    throw new ApiError(403, 'M_FORBIDDEN', 'Not a member of this room');
  }

  if (!newName || typeof newName !== 'string' || newName.trim().length === 0) {
    throw new ApiError(400, 'M_BAD_JSON', 'Room name must be a non-empty string');
  }

  const trimmed = newName.trim();
  if (trimmed.length > 128) {
    throw new ApiError(400, 'M_BAD_JSON', 'Room name must be 128 characters or fewer');
  }

  const updated = await dbUpdateRoomName(roomId, trimmed);
  return { success: true, name: updated.name || trimmed };
}

/**
 * Get room settings. The requesting user must be a member.
 */
export async function getRoomSettings(
  roomId: string,
  userId: string,
): Promise<Record<string, unknown>> {
  const member = await isRoomMember(roomId, userId);
  if (!member) {
    throw new ApiError(403, 'M_FORBIDDEN', 'Not a member of this room');
  }

  const { pool } = await import('../db/pool');
  const result = await pool.query(
    'SELECT settings FROM rooms WHERE room_id = $1',
    [roomId],
  );

  if (result.rows.length === 0) {
    throw new ApiError(404, 'M_NOT_FOUND', 'Room not found');
  }

  return result.rows[0].settings || {};
}

/**
 * Join a room that may require a password.
 */
export async function joinRoomWithPassword(
  roomId: string,
  userId: string,
  password?: string,
): Promise<{ joined: boolean }> {
  const { pool } = await import('../db/pool');
  const roomResult = await pool.query(
    'SELECT settings FROM rooms WHERE room_id = $1',
    [roomId],
  );

  if (roomResult.rows.length === 0) {
    throw new ApiError(404, 'M_NOT_FOUND', 'Room not found');
  }

  const alreadyMember = await isRoomMember(roomId, userId);
  if (alreadyMember) {
    return { joined: true };
  }

  const settings = roomResult.rows[0].settings || {};

  // Check if room is private (invite-only) with no password provided
  if (settings.isPrivate && !settings.passwordHash && !password) {
    throw new ApiError(403, 'M_FORBIDDEN', 'This room is invite-only');
  }

  // Check password if set
  if (settings.passwordHash) {
    if (!password) {
      throw new ApiError(403, 'M_FORBIDDEN', 'This room requires a password to join');
    }
    const bcrypt = await import('bcrypt');
    const valid = await bcrypt.compare(password, settings.passwordHash);
    if (!valid) {
      throw new ApiError(403, 'M_FORBIDDEN', 'Incorrect room password');
    }
  }

  await addRoomMember(roomId, userId, 'member');
  return { joined: true };
}

/**
 * Get the member list for a room with device counts per member.
 * The requesting user must be a member.
 * Device counts are included to support the verification UI.
 */
export async function getRoomMemberList(
  roomId: string,
  requestingUserId: string,
): Promise<RoomMemberWithDeviceCount[]> {
  const isMember = await isRoomMember(roomId, requestingUserId);
  if (!isMember) {
    throw new ApiError(403, 'M_FORBIDDEN', 'Not a member of this room');
  }

  return getRoomMembersWithDeviceCounts(roomId);
}

/**
 * Update room settings (e.g. disappearing messages). Requester must be a member.
 */
export async function updateSettings(
  roomId: string,
  userId: string,
  settings: Record<string, unknown>,
): Promise<{ success: boolean; settings: Record<string, unknown> }> {
  const isMember = await isRoomMember(roomId, userId);
  if (!isMember) {
    throw new ApiError(403, 'M_FORBIDDEN', 'Not a member of this room');
  }

  // If a plaintext password is provided, hash it before storing
  const settingsToStore = { ...settings };
  if (typeof settingsToStore.password === 'string') {
    const bcrypt = await import('bcrypt');
    settingsToStore.passwordHash = await bcrypt.hash(settingsToStore.password, 10);
    delete settingsToStore.password;
  }

  // Merge with existing settings
  const { pool } = await import('../db/pool');
  const existing = await pool.query('SELECT settings FROM rooms WHERE room_id = $1', [roomId]);
  const currentSettings = existing.rows[0]?.settings || {};
  const merged = { ...currentSettings, ...settingsToStore };

  const updated = await dbUpdateRoomSettings(roomId, merged);
  return { success: true, settings: updated.settings };
}

/**
 * Leave a room. The user must currently be a member.
 */
export async function leaveRoom(
  roomId: string,
  userId: string,
): Promise<{ success: boolean }> {
  const isMember = await isRoomMember(roomId, userId);
  if (!isMember) {
    throw new ApiError(403, 'M_FORBIDDEN', 'Not a member of this room');
  }

  const removed = await removeRoomMember(roomId, userId);
  if (!removed) {
    throw new ApiError(404, 'M_NOT_FOUND', 'Membership not found');
  }

  return { success: true };
}
