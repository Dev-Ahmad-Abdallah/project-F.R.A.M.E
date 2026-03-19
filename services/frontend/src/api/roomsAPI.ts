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
interface ServerMember {
  user_id?: string;
  userId?: string;
  role?: string;
  display_name?: string;
  displayName?: string;
}

interface ServerRoom {
  room_id?: string;
  roomId?: string;
  room_type?: string;
  roomType?: string;
  name?: string;
  members?: ServerMember[];
  created_by?: string;
}

export async function listRooms(): Promise<RoomSummary[]> {
  const data = await apiRequest<{ rooms: ServerRoom[] } | ServerRoom[]>('/rooms');
  const rawRooms = Array.isArray(data) ? data : data.rooms ?? [];

  return rawRooms.map((r) => ({
    roomId: r.roomId ?? r.room_id ?? '',
    roomType: (r.roomType ?? r.room_type ?? 'group') as 'direct' | 'group',
    name: r.name,
    members: (r.members ?? []).map((m) => ({
      userId: m.userId ?? m.user_id ?? '',
      displayName: m.displayName ?? m.display_name,
    })),
    unreadCount: 0,
  }));
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
 * Invite a user to a room.
 *
 * @param roomId  The room to invite the user to
 * @param userId  The user ID to invite
 */
export async function inviteToRoom(
  roomId: string,
  userId: string,
): Promise<{ success: boolean }> {
  return apiRequest<{ success: boolean }>(
    `/rooms/${encodeURIComponent(roomId)}/invite`,
    {
      method: 'POST',
      body: { userId },
    },
  );
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
