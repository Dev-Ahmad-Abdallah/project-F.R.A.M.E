/**
 * Blocks API functions for F.R.A.M.E.
 *
 * Handles blocking, unblocking, and listing blocked users.
 * All requests go through the central client.ts fetch wrapper.
 */

import { apiRequest } from './client';

/**
 * Block a user. Blocked users cannot send messages to you.
 */
export async function blockUser(userId: string): Promise<void> {
  await apiRequest(`/blocks/${encodeURIComponent(userId)}`, { method: 'POST' });
}

/**
 * Unblock a previously blocked user.
 */
export async function unblockUser(userId: string): Promise<void> {
  await apiRequest(`/blocks/${encodeURIComponent(userId)}`, { method: 'DELETE' });
}

/**
 * Get the list of user IDs that the current user has blocked.
 */
export async function getBlockedUsers(): Promise<string[]> {
  const resp = await apiRequest<{ blocked: string[] }>('/blocks');
  return resp.blocked;
}
