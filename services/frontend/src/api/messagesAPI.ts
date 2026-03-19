/**
 * Messages API functions for F.R.A.M.E.
 *
 * All requests go through the central client.ts fetch wrapper.
 */

import { apiRequest } from './client';

export interface SendMessageParams {
  roomId: string;
  eventType: string;
  content: Record<string, unknown>;
}

export interface SendMessageResponse {
  eventId: string;
  sequenceId: number;
}

export interface ReactionData {
  users: string[];
  count: number;
}

export interface SyncEvent {
  eventId: string;
  roomId: string;
  senderId: string;
  senderDeviceId: string;
  eventType: string;
  content: Record<string, unknown>;
  reactions: Record<string, ReactionData>;
  originServerTs: string;
  sequenceId: number;
}

export interface ToDeviceEvent {
  id: number;
  sender: string;
  sender_device: string;
  type: string;
  content: Record<string, unknown>;
}

export interface SyncResponse {
  events: SyncEvent[];
  nextBatch: string;
  hasMore: boolean;
  to_device?: ToDeviceEvent[];
}

/**
 * Send an encrypted message to a room.
 */
export async function sendMessage(
  roomId: string,
  eventType: string,
  content: Record<string, unknown>,
): Promise<SendMessageResponse> {
  return apiRequest<SendMessageResponse>('/messages/send', {
    method: 'POST',
    body: { roomId, eventType, content },
  });
}

/**
 * Delete (soft-delete) a message by event ID.
 */
export async function deleteMessage(eventId: string): Promise<void> {
  return apiRequest<void>(`/messages/${encodeURIComponent(eventId)}`, {
    method: 'DELETE',
  });
}

/**
 * Acknowledge receipt of to-device messages so they are not re-delivered.
 */
export async function ackToDeviceMessages(
  messageIds: number[],
): Promise<{ acknowledged: number }> {
  return apiRequest<{ acknowledged: number }>('/messages/ack-to-device', {
    method: 'POST',
    body: { messageIds },
  });
}

/**
 * Long-poll for new messages since a given sequence ID.
 */
export async function syncMessages(
  since?: string,
  timeout?: number,
  limit?: number,
): Promise<SyncResponse> {
  const params = new URLSearchParams();
  if (since != null) params.set('since', since);
  if (timeout != null) params.set('timeout', String(timeout));
  if (limit != null) params.set('limit', String(limit));

  const query = params.toString();
  const endpoint = `/messages/sync${query ? `?${query}` : ''}`;

  return apiRequest<SyncResponse>(endpoint);
}

/**
 * Add or toggle a reaction on a message.
 */
export async function reactToMessage(
  eventId: string,
  emoji: string,
): Promise<{ eventId: string; reactions: Record<string, ReactionData> }> {
  return apiRequest<{ eventId: string; reactions: Record<string, ReactionData> }>(
    `/messages/${encodeURIComponent(eventId)}/react`,
    {
      method: 'POST',
      body: { emoji },
    },
  );
}

/**
 * Mark a message as read (send read receipt).
 */
export async function markAsRead(eventId: string): Promise<void> {
  return apiRequest<void>(
    `/messages/${encodeURIComponent(eventId)}/read`,
    { method: 'POST' },
  );
}

export interface ReadReceipt {
  room_id: string;
  user_id: string;
  event_id: string;
  read_at: string;
}

/**
 * Get read receipts for a room.
 */
export async function getReadReceipts(
  roomId: string,
): Promise<{ receipts: ReadReceipt[] }> {
  return apiRequest<{ receipts: ReadReceipt[] }>(
    `/messages/read-receipts/${encodeURIComponent(roomId)}`,
  );
}

/**
 * Set typing indicator for the current user in a room.
 */
export async function setTyping(
  roomId: string,
  isTyping: boolean,
): Promise<void> {
  return apiRequest<void>('/messages/typing', {
    method: 'POST',
    body: { roomId, isTyping },
  });
}

/**
 * Get users currently typing in a room.
 */
export async function getTypingUsers(
  roomId: string,
): Promise<{ typingUserIds: string[] }> {
  return apiRequest<{ typingUserIds: string[] }>(
    `/messages/typing/${encodeURIComponent(roomId)}`,
  );
}
