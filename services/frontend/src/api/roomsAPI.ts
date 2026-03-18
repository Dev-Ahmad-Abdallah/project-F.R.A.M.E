/**
 * Rooms API functions for F.R.A.M.E.
 *
 * Handles room creation, listing, joining, and member queries.
 * All requests go through the central client.ts fetch wrapper.
 */

import { apiRequest } from './client';

// ── Types ──

export interface RoomMember {
  userId: string;
  displayName?: string;
}

export interface RoomSummary {
  roomId: string;
  roomType: 'direct' | 'group';
  name?: string;
  members: RoomMember[];
  lastMessage?: {
    senderId: string;
    body: string;
    timestamp: string;
  };
  unreadCount: number;
}

export interface CreateRoomResponse {
  roomId: string;
}

// ── API Functions ──

/**
 * Create a new room (direct message or group).
 *
 * @param roomType  'direct' for direct message, 'group' for group chat
 * @param inviteUserIds  User IDs to invite to the room
 * @param name  Optional room name (for groups)
 */
export async function createRoom(
  roomType: 'direct' | 'group',
  inviteUserIds: string[],
  name?: string,
): Promise<CreateRoomResponse> {
  return apiRequest<CreateRoomResponse>('/rooms/create', {
    method: 'POST',
    body: { roomType, inviteUserIds, name },
  });
}

/**
 * List all rooms the authenticated user is a member of.
 */
export async function listRooms(): Promise<RoomSummary[]> {
  const data = await apiRequest<{ rooms: RoomSummary[] } | RoomSummary[]>('/rooms');
  return Array.isArray(data) ? data : data.rooms ?? [];
}

/**
 * Join an existing room.
 *
 * @param roomId  The room to join
 */
export async function joinRoom(roomId: string): Promise<void> {
  return apiRequest<void>(`/rooms/${encodeURIComponent(roomId)}/join`, {
    method: 'POST',
  });
}

/**
 * Get the member list for a room.
 *
 * @param roomId  The room to query
 */
export async function getRoomMembers(
  roomId: string,
): Promise<RoomMember[]> {
  return apiRequest<RoomMember[]>(
    `/rooms/${encodeURIComponent(roomId)}/members`,
  );
}
