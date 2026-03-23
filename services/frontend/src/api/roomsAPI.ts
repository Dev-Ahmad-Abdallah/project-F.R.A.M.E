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
  createdBy?: string;
  lastMessage?: {
    senderId: string;
    body: string;
    timestamp: string;
  };
  unreadCount: number;
  isAnonymous?: boolean;
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
  options?: { isPrivate?: boolean; password?: string; isAnonymous?: boolean },
): Promise<CreateRoomResponse> {
  return apiRequest<CreateRoomResponse>('/rooms/create', {
    method: 'POST',
    body: {
      roomType,
      inviteUserIds,
      name,
      ...(options?.isPrivate ? { isPrivate: true } : {}),
      ...(options?.password ? { password: options.password } : {}),
      ...(options?.isAnonymous ? { isAnonymous: true } : {}),
    },
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

interface ServerLastMessage {
  content?: Record<string, unknown>;
  timestamp?: string;
  senderId?: string;
  sender_id?: string;
}

interface ServerRoom {
  room_id?: string;
  roomId?: string;
  room_type?: string;
  roomType?: string;
  name?: string;
  members?: ServerMember[];
  created_by?: string;
  lastMessage?: ServerLastMessage | null;
  last_message?: ServerLastMessage | null;
  unreadCount?: number;
  unread_count?: number;
  settings?: Record<string, unknown>;
}

export async function listRooms(): Promise<RoomSummary[]> {
  const data = await apiRequest<{ rooms: ServerRoom[] } | ServerRoom[]>('/rooms');
  const rawRooms = Array.isArray(data) ? data : data.rooms ?? [];

  return rawRooms.map((r) => {
    const serverLastMsg = r.lastMessage ?? r.last_message ?? null;
    const lastMessage = serverLastMsg
      ? {
          senderId: serverLastMsg.senderId ?? serverLastMsg.sender_id ?? (serverLastMsg.content?.sender as string) ?? '',
          body: (serverLastMsg.content?.body as string) ?? '',
          timestamp: serverLastMsg.timestamp ?? '',
        }
      : undefined;

    return {
      roomId: r.roomId ?? r.room_id ?? '',
      roomType: (r.roomType ?? r.room_type ?? 'group') as 'direct' | 'group',
      name: r.name,
      members: (r.members ?? []).map((m) => ({
        userId: m.userId ?? m.user_id ?? '',
        displayName: m.displayName ?? m.display_name,
      })),
      createdBy: r.created_by,
      lastMessage,
      unreadCount: r.unreadCount ?? r.unread_count ?? 0,
      isAnonymous: r.settings?.isAnonymous === true || undefined,
    };
  });
}

/**
 * Rename a room.
 *
 * @param roomId  The room to rename
 * @param name    The new room name
 */
export async function renameRoom(
  roomId: string,
  name: string,
): Promise<{ success: boolean; name: string }> {
  return apiRequest<{ success: boolean; name: string }>(
    `/rooms/${encodeURIComponent(roomId)}/name`,
    {
      method: 'PUT',
      body: { name },
    },
  );
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
  const data = await apiRequest<{ members: ServerMember[] } | ServerMember[]>(
    `/rooms/${encodeURIComponent(roomId)}/members`,
  );
  const raw = Array.isArray(data) ? data : data.members ?? [];
  return raw.map((m) => ({
    userId: m.userId ?? m.user_id ?? '',
    displayName: m.displayName ?? m.display_name,
  }));
}

/**
 * Leave a room (removes the user from the room).
 */
export async function leaveRoom(roomId: string): Promise<{ success: boolean }> {
  return apiRequest<{ success: boolean }>(
    `/rooms/${encodeURIComponent(roomId)}/leave`,
    { method: 'DELETE' },
  );
}

/**
 * Update room settings (e.g. disappearing messages, privacy).
 */
export async function updateRoomSettings(
  roomId: string,
  settings: Record<string, unknown>,
): Promise<{ success: boolean }> {
  return apiRequest<{ success: boolean }>(
    `/rooms/${encodeURIComponent(roomId)}/settings`,
    { method: 'PUT', body: settings },
  );
}

/**
 * Get room settings.
 */
export async function getRoomSettingsAPI(
  roomId: string,
): Promise<{ settings: Record<string, unknown> }> {
  return apiRequest<{ settings: Record<string, unknown> }>(
    `/rooms/${encodeURIComponent(roomId)}/settings`,
  );
}

/**
 * Join a room with a password.
 */
export async function joinRoomWithPassword(
  roomId: string,
  password?: string,
): Promise<{ joined: boolean }> {
  return apiRequest<{ joined: boolean }>(
    `/rooms/${encodeURIComponent(roomId)}/join-with-password`,
    { method: 'POST', body: { password } },
  );
}

/**
 * Join a room using a short invite code (e.g., "X7K9P2").
 */
export async function joinByCode(
  code: string,
  password?: string,
): Promise<{ joined: boolean; roomId: string; name: string | null }> {
  return apiRequest<{ joined: boolean; roomId: string; name: string | null }>(
    '/rooms/join-by-code',
    {
      method: 'POST',
      body: { code: code.toUpperCase(), ...(password ? { password } : {}) },
    },
  );
}

/**
 * Get the invite code for a room (members only).
 */
export async function getRoomCode(
  roomId: string,
): Promise<{ inviteCode: string | null }> {
  return apiRequest<{ inviteCode: string | null }>(
    `/rooms/code/${encodeURIComponent(roomId)}`,
  );
}

/**
 * Regenerate the invite code for a room (admin only).
 */
export async function regenerateCode(
  roomId: string,
): Promise<{ inviteCode: string }> {
  return apiRequest<{ inviteCode: string }>(
    `/rooms/${encodeURIComponent(roomId)}/regenerate-code`,
    { method: 'POST' },
  );
}

/**
 * Remove (kick) a member from a room.
 * Only the room creator/admin can perform this action.
 *
 * @param roomId  The room to remove the member from
 * @param userId  The user ID to remove
 */
export async function kickMember(
  roomId: string,
  userId: string,
): Promise<void> {
  await apiRequest(
    `/rooms/${encodeURIComponent(roomId)}/members/${encodeURIComponent(userId)}`,
    { method: 'DELETE' },
  );
}
