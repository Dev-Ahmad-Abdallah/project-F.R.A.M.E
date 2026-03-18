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

export interface SyncEvent {
  eventId: string;
  roomId: string;
  senderId: string;
  senderDeviceId: string;
  eventType: string;
  content: Record<string, unknown>;
  originServerTs: string;
  sequenceId: number;
}

export interface SyncResponse {
  events: SyncEvent[];
  nextBatch: string;
  hasMore: boolean;
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
