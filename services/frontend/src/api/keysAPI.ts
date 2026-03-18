/**
 * Key API — server endpoints for key upload, retrieval, and count.
 *
 * All calls flow through the shared api/client `apiRequest` wrapper,
 * which handles auth tokens, refresh, and error mapping.
 */

import { apiRequest } from './client';
import type { KeyBundle } from '@frame/shared';

// ── Request / Response shapes ──

interface UploadKeysPayload {
  identityKey: string;
  signedPrekey: string;
  signedPrekeySig: string;
  oneTimePrekeys: string[];
}

interface UploadKeysResponse {
  stored: number;
}

interface KeyCountResponse {
  count: number;
}

// ── Public API ──

/**
 * Upload identity key, signed pre-key, and a batch of one-time pre-keys
 * to the homeserver.
 *
 * Called at registration and whenever the server-side one-time key count
 * drops below threshold.
 */
export async function uploadKeys(
  identityKey: string,
  signedPrekey: string,
  signedPrekeySig: string,
  oneTimePrekeys: string[],
): Promise<UploadKeysResponse> {
  const body: UploadKeysPayload = {
    identityKey,
    signedPrekey,
    signedPrekeySig,
    oneTimePrekeys,
  };

  return apiRequest<UploadKeysResponse>('/keys/upload', {
    method: 'POST',
    body,
  });
}

/**
 * Fetch a user's public key bundle (identity key + signed pre-key +
 * one available one-time pre-key). Used to establish an initial Olm
 * session with the target device.
 */
export async function fetchKeyBundle(userId: string): Promise<KeyBundle> {
  return apiRequest<KeyBundle>(
    `/keys/${encodeURIComponent(userId)}`,
  );
}

/**
 * Get the server-side count of remaining one-time pre-keys for the
 * current device. When this drops below a threshold the client should
 * generate and upload a fresh batch.
 */
export async function getKeyCount(): Promise<number> {
  const res = await apiRequest<KeyCountResponse>('/keys/count');
  return res.count;
}
