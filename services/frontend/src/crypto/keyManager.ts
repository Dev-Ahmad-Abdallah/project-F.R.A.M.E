/**
 * Key management — coordinates OlmMachine key generation with
 * server-side key upload and contact key retrieval.
 *
 * This is the high-level orchestrator that:
 *   1. Initialises the OlmMachine (which auto-generates identity keys)
 *   2. Extracts public keys and uploads them to the homeserver
 *   3. Processes OlmMachine's outgoing requests (KeysUpload, etc.)
 *   4. Retrieves contact key bundles for session establishment
 */

import type { KeyBundle } from '@frame/shared';
import {
  initCrypto,
  getIdentityKeys,
  processOutgoingRequests,
} from './olmMachine';
import { uploadKeys, fetchKeyBundle } from '../api/keysAPI';
import { fetchAndVerifyKey, type VerifiedKeyResult } from '../verification/keyTransparency';

// ── Public API ──

/**
 * Generate device keys and upload them to the homeserver.
 *
 * Call once at registration or first login on a new device.
 *
 * Flow:
 *   1. `initCrypto()` creates the OlmMachine and auto-generates
 *      Curve25519 + Ed25519 keypairs inside the WASM boundary.
 *   2. The identity (Curve25519) key is extracted for upload.
 *   3. `processOutgoingRequests()` sends the machine's pending
 *      KeysUploadRequest, which contains the signed pre-key,
 *      signature, and one-time pre-keys.
 *   4. As a secondary channel, we also call `/keys/upload` directly
 *      with the identity key to ensure the homeserver has it indexed.
 *
 * @param userId   Full user ID, e.g. `@alice:frame.local`
 * @param deviceId Device identifier
 */
export async function generateAndUploadKeys(
  userId: string,
  deviceId: string,
): Promise<void> {
  // Step 1 — init OlmMachine (generates keys internally)
  await initCrypto(userId, deviceId);

  // Step 2 — extract public identity keys
  const identityKeys = getIdentityKeys();

  // Step 3 — let the OlmMachine push its KeysUploadRequest to the server.
  //          This uploads signed pre-key + one-time pre-keys.
  await processOutgoingRequests();

  // Step 4 — explicit upload of identity key for the homeserver's
  //          key directory (the OlmMachine request may use a different
  //          endpoint format; this ensures compatibility).
  await uploadKeys(
    identityKeys.curve25519,
    '', // signed pre-key handled by OlmMachine request
    '', // signature handled by OlmMachine request
    [], // one-time pre-keys handled by OlmMachine request
  );
}

/**
 * Fetch a contact's public key bundle from the homeserver and verify
 * it against the key transparency log.
 *
 * Returns the identity key, signed pre-key, its signature, and any
 * available one-time pre-keys needed to establish an Olm session.
 *
 * @param userId Target user ID
 * @throws Error if key transparency verification fails
 */
export async function fetchContactKeys(
  userId: string,
): Promise<KeyBundle & { transparencyVerification: VerifiedKeyResult }> {
  const bundle = await fetchKeyBundle(userId);

  // Verify the key against the transparency log
  const verification = await fetchAndVerifyKey(userId);

  if (!verification.verified) {
    throw new Error(
      `Key transparency verification failed for ${userId}. ` +
        'The key may have been tampered with.',
    );
  }

  if (verification.rootChanged) {
    console.warn(
      `[F.R.A.M.E.] Merkle root changed for ${userId}. ` +
        'This may indicate a key rotation or log manipulation.',
    );
  }

  return { ...bundle, transparencyVerification: verification };
}
