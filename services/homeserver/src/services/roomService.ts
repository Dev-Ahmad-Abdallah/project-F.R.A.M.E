import { getConfig } from '../config';
import {
  createRoom as dbCreateRoom,
  addRoomMember,
  getUserRooms as dbGetUserRooms,
  getRoomMembersWithDeviceCounts,
  isRoomMember,
  RoomRow,
  RoomMemberWithDeviceCount,
} from '../db/queries/rooms';
import { ApiError } from '../middleware/errorHandler';

const config = getConfig();

/**
 * Create a new room (direct or group) and invite initial members.
 */
export async function createRoom(
  userId: string,
  roomType: 'direct' | 'group',
  inviteUserIds: string[],
  homeserver: string = config.HOMESERVER_DOMAIN,
): Promise<{ roomId: string; room: RoomRow }> {
  const room = await dbCreateRoom(roomType, userId, homeserver);

  // Add invited members in parallel
  await Promise.all(
    inviteUserIds.map((inviteeId) => addRoomMember(room.room_id, inviteeId, 'member'))
  );

  return { roomId: room.room_id, room };
}

/**
 * List all rooms the user is a member of.
 */
export async function getUserRooms(userId: string): Promise<RoomRow[]> {
  return dbGetUserRooms(userId);
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
