import { EventEmitter } from 'events';
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
  findRoomByInviteCode,
  getRoomInviteCode as dbGetRoomInviteCode,
  regenerateRoomInviteCode as dbRegenerateRoomInviteCode,
  getRoomMemberRole,
  RoomRow,
  RoomMemberWithDeviceCount,
  RoomWithMembers,
} from '../db/queries/rooms';
import { findUserById, isBlocked } from '../db/queries/users';
import { pool } from '../db/pool';
import { ApiError } from '../middleware/errorHandler';

/**
 * Room membership event emitter.
 *
 * Emits 'membershipChange' events when users join or leave rooms.
 * Consumers (e.g. the sync layer) can listen for these events to
 * trigger Megolm session invalidation for forward secrecy.
 */
export const roomEvents = new EventEmitter();

export interface MembershipChangeEvent {
  roomId: string;
  userId: string;
  action: 'join' | 'leave' | 'invite';
}

const USER_ID_REGEX = /^@[a-zA-Z0-9_-]+:.+$/;

const config = getConfig();

/**
 * Anonymous animal names used to generate pseudonyms for anonymous rooms.
 * Each member gets a unique "Anonymous <Animal>" name.
 */
const ANONYMOUS_ANIMALS = [
  'Fox', 'Eagle', 'Wolf', 'Bear', 'Hawk', 'Owl', 'Deer', 'Lynx',
  'Raven', 'Falcon', 'Panther', 'Cobra', 'Puma', 'Dolphin', 'Tiger',
  'Crane', 'Otter', 'Viper', 'Bison', 'Jaguar', 'Heron', 'Badger',
  'Moose', 'Osprey', 'Coyote', 'Marten', 'Ibis', 'Gecko', 'Ferret',
  'Mantis', 'Condor', 'Bobcat', 'Wren', 'Newt', 'Lark', 'Yak',
  'Dingo', 'Finch', 'Moth', 'Toad', 'Asp', 'Kiwi', 'Emu', 'Ram',
  'Mink', 'Pike', 'Swan', 'Dove', 'Jay', 'Elk',
];

/**
 * Generate a deterministic anonymous name for a user in a room.
 * Uses simple index-based assignment so names are stable.
 */
function pickAnonymousName(usedNames: Set<string>): string {
  for (const animal of ANONYMOUS_ANIMALS) {
    const name = `Anonymous ${animal}`;
    if (!usedNames.has(name)) return name;
  }
  // Fallback if we somehow exceed the list
  return `Anonymous User ${usedNames.size + 1}`;
}

/**
 * Build the anonymousNames mapping for a room given its current members.
 * Preserves existing assignments and adds new ones for new members.
 */
function buildAnonymousNames(
  existingMap: Record<string, string>,
  memberIds: string[],
): Record<string, string> {
  const result: Record<string, string> = { ...existingMap };
  const usedNames = new Set(Object.values(result));
  for (const memberId of memberIds) {
    if (!result[memberId]) { // eslint-disable-line security/detect-object-injection
      const name = pickAnonymousName(usedNames);
      result[memberId] = name; // eslint-disable-line security/detect-object-injection
      usedNames.add(name);
    }
  }
  return result;
}

/**
 * Create a new room (direct or group) and invite initial members.
 */
export async function createRoom(
  userId: string,
  roomType: 'direct' | 'group',
  inviteUserIds: string[],
  homeserver: string = config.HOMESERVER_DOMAIN,
  options?: { name?: string; isPrivate?: boolean; password?: string; isAnonymous?: boolean },
): Promise<{ roomId: string; room: RoomRow }> {
  // Validate all invited user IDs before creating the room
  for (const inviteeId of inviteUserIds) {
    if (!USER_ID_REGEX.test(inviteeId)) {
      throw new ApiError(400, 'M_INVALID_PARAM', `Invalid userId format: ${inviteeId}. Expected @username:server`);
    }
    const invitee = await findUserById(inviteeId);
    if (!invitee) {
      throw new ApiError(404, 'M_NOT_FOUND', `User not found: ${inviteeId}`);
    }
    // Block check: prevent creating rooms with users who have blocked the creator
    const blockedByInvitee = await isBlocked(inviteeId, userId);
    if (blockedByInvitee) {
      throw new ApiError(403, 'M_FORBIDDEN', 'Cannot create room with this user');
    }
  }

  const room = await dbCreateRoom(roomType, userId, homeserver, options?.name, inviteUserIds);

  // Set room settings if privacy, password, or anonymous mode is specified
  if (options?.isPrivate || options?.password || options?.isAnonymous) {
    const settings: Record<string, unknown> = {};
    if (options.isPrivate) settings.isPrivate = true;
    if (options.password) {
      const bcrypt = await import('bcrypt');
      settings.passwordHash = await bcrypt.hash(options.password, 10);
    }
    if (options.isAnonymous) {
      settings.isAnonymous = true;
      // Generate anonymous names for creator and all invited members
      const allMembers = [userId, ...inviteUserIds];
      settings.anonymousNames = buildAnonymousNames({}, allMembers);
    }
    await dbUpdateRoomSettings(room.room_id, settings);
  }

  // Emit membership events for the creator and all invited members
  roomEvents.emit('membershipChange', {
    roomId: room.room_id,
    userId,
    action: 'join',
  } as MembershipChangeEvent);

  for (const inviteeId of inviteUserIds) {
    roomEvents.emit('membershipChange', {
      roomId: room.room_id,
      userId: inviteeId,
      action: 'invite',
    } as MembershipChangeEvent);
  }

  return { roomId: room.room_id, room };
}

/**
 * List all rooms the user is a member of, including member lists,
 * last message, and unread counts.
 */
export async function getUserRooms(userId: string, deviceId?: string): Promise<RoomWithMembers[]> {
  return getUserRoomsWithMembers(userId, deviceId);
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

  // Check if target user has blocked the inviter — prevent invite harassment
  const blockedByTarget = await isBlocked(targetUserId, requestingUserId);
  if (blockedByTarget) {
    throw new ApiError(403, 'M_FORBIDDEN', 'Cannot invite this user');
  }

  // Check for duplicate membership
  const alreadyMember = await isRoomMember(roomId, targetUserId);
  if (alreadyMember) {
    throw new ApiError(409, 'M_ALREADY_JOINED', 'User is already a member of this room');
  }

  await addRoomMember(roomId, targetUserId, 'member');

  // If this is an anonymous room, assign an anonymous name to the invited member.
  // Uses a transaction with SELECT ... FOR UPDATE to prevent concurrent joins from
  // overwriting each other's anonymous name assignments.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const roomRow = await client.query<{ settings: Record<string, unknown> }>(
      'SELECT settings FROM rooms WHERE room_id = $1 FOR UPDATE',
      [roomId],
    );
    const roomSettings = roomRow.rows[0]?.settings || {};
    if (roomSettings.isAnonymous) {
      const existingNames = (roomSettings.anonymousNames as Record<string, string>) || {};
      if (!existingNames[targetUserId]) { // eslint-disable-line security/detect-object-injection
        const updatedNames = buildAnonymousNames(existingNames, [targetUserId]);
        await client.query(
          'UPDATE rooms SET settings = $1 WHERE room_id = $2',
          [JSON.stringify({ ...roomSettings, anonymousNames: updatedNames }), roomId],
        );
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // Emit membership change event for the invited user
  roomEvents.emit('membershipChange', {
    roomId,
    userId: targetUserId,
    action: 'invite',
  } as MembershipChangeEvent);

  return { success: true };
}

/**
 * Join a room (by invite). Rejects join attempts on private or
 * password-protected rooms — use joinRoomWithPassword instead.
 */
export async function joinRoom(
  roomId: string,
  userId: string,
): Promise<{ joined: boolean }> {
  // Verify the room exists
  const roomResult = await pool.query<{ room_id: string; settings: Record<string, unknown> }>(
    'SELECT room_id, settings FROM rooms WHERE room_id = $1',
    [roomId],
  );
  if (roomResult.rows.length === 0) {
    throw new ApiError(404, 'M_NOT_FOUND', 'Room not found');
  }

  const alreadyMember = await isRoomMember(roomId, userId);
  if (alreadyMember) {
    return { joined: true };
  }

  // Block open join on private or password-protected rooms
  const settings = roomResult.rows[0].settings || {};
  if (settings.isPrivate) {
    throw new ApiError(403, 'M_FORBIDDEN', 'This room is invite-only');
  }
  if (settings.passwordHash) {
    throw new ApiError(403, 'M_FORBIDDEN', 'This room requires a password to join. Use join-with-password instead.');
  }

  await addRoomMember(roomId, userId, 'member');

  // If this is an anonymous room, assign an anonymous name to the new member.
  // Uses a transaction with SELECT ... FOR UPDATE to prevent concurrent joins from
  // overwriting each other's anonymous name assignments.
  if (settings.isAnonymous) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const lockedRoom = await client.query<{ settings: Record<string, unknown> }>(
        'SELECT settings FROM rooms WHERE room_id = $1 FOR UPDATE',
        [roomId],
      );
      const lockedSettings = lockedRoom.rows[0]?.settings || {};
      const existingNames = (lockedSettings.anonymousNames as Record<string, string>) || {};
      if (!existingNames[userId]) { // eslint-disable-line security/detect-object-injection
        const updatedNames = buildAnonymousNames(existingNames, [userId]);
        await client.query(
          'UPDATE rooms SET settings = $1 WHERE room_id = $2',
          [JSON.stringify({ ...lockedSettings, anonymousNames: updatedNames }), roomId],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // Emit membership change event
  roomEvents.emit('membershipChange', {
    roomId,
    userId,
    action: 'join',
  } as MembershipChangeEvent);

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

interface RoomSettingsRow {
  settings: Record<string, unknown>;
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

  const result = await pool.query<RoomSettingsRow>(
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
  const roomResult = await pool.query<RoomSettingsRow>(
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

  const settings = roomResult.rows[0].settings || {} as Record<string, unknown>;

  // A private room without a password is invite-only — no open join allowed
  if (settings.isPrivate && !settings.passwordHash) {
    throw new ApiError(403, 'M_FORBIDDEN', 'This room is invite-only');
  }

  // Check password if set
  if (settings.passwordHash) {
    if (!password) {
      throw new ApiError(403, 'M_FORBIDDEN', 'This room requires a password to join');
    }
    const bcrypt = await import('bcrypt');
    const valid = await bcrypt.compare(password, settings.passwordHash as string);
    if (!valid) {
      throw new ApiError(403, 'M_FORBIDDEN', 'Incorrect room password');
    }
  }

  await addRoomMember(roomId, userId, 'member');

  // If this is an anonymous room, assign an anonymous name to the new member.
  // Uses a transaction with SELECT ... FOR UPDATE to prevent concurrent joins from
  // overwriting each other's anonymous name assignments.
  if (settings.isAnonymous) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const lockedRoom = await client.query<{ settings: Record<string, unknown> }>(
        'SELECT settings FROM rooms WHERE room_id = $1 FOR UPDATE',
        [roomId],
      );
      const lockedSettings = lockedRoom.rows[0]?.settings || {};
      const existingNames = (lockedSettings.anonymousNames as Record<string, string>) || {};
      if (!existingNames[userId]) { // eslint-disable-line security/detect-object-injection
        const updatedNames = buildAnonymousNames(existingNames, [userId]);
        await client.query(
          'UPDATE rooms SET settings = $1 WHERE room_id = $2',
          [JSON.stringify({ ...lockedSettings, anonymousNames: updatedNames }), roomId],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // Emit membership change event
  roomEvents.emit('membershipChange', {
    roomId,
    userId,
    action: 'join',
  } as MembershipChangeEvent);

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

  const members = await getRoomMembersWithDeviceCounts(roomId);

  // For anonymous rooms, replace display names with anonymous pseudonyms
  const roomResult = await pool.query<{ settings: Record<string, unknown> }>(
    'SELECT settings FROM rooms WHERE room_id = $1',
    [roomId],
  );
  const settings = roomResult.rows[0]?.settings || {};
  if (settings.isAnonymous && settings.anonymousNames) {
    const anonNames = settings.anonymousNames as Record<string, string>;
    return members.map((m) => ({
      ...m,
      display_name: anonNames[m.user_id] || 'Anonymous', // eslint-disable-line security/detect-object-injection
    }));
  }

  return members;
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
  const existing = await pool.query<RoomSettingsRow>('SELECT settings FROM rooms WHERE room_id = $1', [roomId]);
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

  // Emit membership change so remaining clients can invalidate the
  // Megolm session, ensuring the departed user cannot decrypt future messages.
  roomEvents.emit('membershipChange', {
    roomId,
    userId,
    action: 'leave',
  } as MembershipChangeEvent);

  return { success: true };
}

/**
 * Remove (kick) a member from a room.
 * Only the room creator (created_by) can kick members.
 */
export async function kickMember(
  roomId: string,
  requestingUserId: string,
  targetUserId: string,
): Promise<{ success: boolean }> {
  // Verify room exists and get created_by
  const roomResult = await pool.query<{ created_by: string }>(
    'SELECT created_by FROM rooms WHERE room_id = $1',
    [roomId],
  );
  if (roomResult.rows.length === 0) {
    throw new ApiError(404, 'M_NOT_FOUND', 'Room not found');
  }

  // Only room creator can kick members
  if (roomResult.rows[0].created_by !== requestingUserId) {
    throw new ApiError(403, 'M_FORBIDDEN', 'Only the room creator can remove members');
  }

  // Cannot kick yourself
  if (targetUserId === requestingUserId) {
    throw new ApiError(400, 'M_BAD_JSON', 'Cannot kick yourself. Use leave instead.');
  }

  // Verify target is a member
  const isMember = await isRoomMember(roomId, targetUserId);
  if (!isMember) {
    throw new ApiError(404, 'M_NOT_FOUND', 'User is not a member of this room');
  }

  const removed = await removeRoomMember(roomId, targetUserId);
  if (!removed) {
    throw new ApiError(404, 'M_NOT_FOUND', 'Membership not found');
  }

  // Emit membership change so remaining clients can invalidate Megolm sessions
  roomEvents.emit('membershipChange', {
    roomId,
    userId: targetUserId,
    action: 'leave',
  } as MembershipChangeEvent);

  return { success: true };
}

/**
 * Join a room by invite code. Optionally accepts a password for
 * password-protected rooms.
 */
export async function joinRoomByCode(
  code: string,
  userId: string,
  password?: string,
): Promise<{ joined: boolean; roomId: string; name: string | null }> {
  const room = await findRoomByInviteCode(code);
  if (!room) {
    throw new ApiError(404, 'M_NOT_FOUND', 'Invalid invite code');
  }

  const alreadyMember = await isRoomMember(room.room_id, userId);
  if (alreadyMember) {
    return { joined: true, roomId: room.room_id, name: room.name };
  }

  const settings = room.settings || {};

  // Check password if the room has one
  if (settings.passwordHash) {
    if (!password) {
      throw new ApiError(403, 'M_FORBIDDEN', 'This room requires a password to join');
    }
    const bcrypt = await import('bcrypt');
    const valid = await bcrypt.compare(password, settings.passwordHash as string);
    if (!valid) {
      throw new ApiError(403, 'M_FORBIDDEN', 'Incorrect room password');
    }
  }

  await addRoomMember(room.room_id, userId, 'member');

  // If this is an anonymous room, assign an anonymous name to the new member.
  // Uses a transaction with SELECT ... FOR UPDATE to prevent concurrent joins from
  // overwriting each other's anonymous name assignments.
  if (settings.isAnonymous) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const lockedRoom = await client.query<{ settings: Record<string, unknown> }>(
        'SELECT settings FROM rooms WHERE room_id = $1 FOR UPDATE',
        [room.room_id],
      );
      const lockedSettings = lockedRoom.rows[0]?.settings || {};
      const existingNames = (lockedSettings.anonymousNames as Record<string, string>) || {};
      if (!existingNames[userId]) { // eslint-disable-line security/detect-object-injection
        const updatedNames = buildAnonymousNames(existingNames, [userId]);
        await client.query(
          'UPDATE rooms SET settings = $1 WHERE room_id = $2',
          [JSON.stringify({ ...lockedSettings, anonymousNames: updatedNames }), room.room_id],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  roomEvents.emit('membershipChange', {
    roomId: room.room_id,
    userId,
    action: 'join',
  } as MembershipChangeEvent);

  return { joined: true, roomId: room.room_id, name: room.name };
}

/**
 * Get the invite code for a room. The requesting user must be a member.
 */
export async function getRoomCode(
  roomId: string,
  userId: string,
): Promise<{ inviteCode: string | null }> {
  const isMember = await isRoomMember(roomId, userId);
  if (!isMember) {
    throw new ApiError(403, 'M_FORBIDDEN', 'Not a member of this room');
  }

  const code = await dbGetRoomInviteCode(roomId);
  return { inviteCode: code };
}

/**
 * Regenerate the invite code for a room. Only admins can do this.
 */
export async function regenerateRoomCode(
  roomId: string,
  userId: string,
): Promise<{ inviteCode: string }> {
  const role = await getRoomMemberRole(roomId, userId);
  if (!role) {
    throw new ApiError(403, 'M_FORBIDDEN', 'Not a member of this room');
  }
  if (role !== 'admin') {
    throw new ApiError(403, 'M_FORBIDDEN', 'Only admins can regenerate invite codes');
  }

  const newCode = await dbRegenerateRoomInviteCode(roomId);
  return { inviteCode: newCode };
}
