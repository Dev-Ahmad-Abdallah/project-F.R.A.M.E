/**
 * Megolm session coordination for F.R.A.M.E.
 *
 * Orchestrates the full Megolm group encryption lifecycle:
 *   1. Track room members so the OlmMachine knows which devices exist
 *   2. Query keys for all member devices
 *   3. Claim one-time keys for devices without Olm sessions
 *   4. Share the Megolm room key to all devices via Olm
 *   5. Encrypt outgoing events with the room's Megolm session
 *   6. Decrypt incoming events using received Megolm sessions
 *
 * SECURITY: Plaintext content and key material are never logged.
 *           All sensitive data stays within the WASM boundary.
 */

import * as sdk from '@matrix-org/matrix-sdk-crypto-wasm';
import { getOlmMachine, processOutgoingRequests } from './olmMachine';
import { apiRequest } from '../api/client';
import type { SyncEvent, SyncResponse } from '../api/messagesAPI';

// ── Mutex ──

/**
 * Minimal async mutex to serialise session establishment.
 * getMissingSessions and shareRoomKey must not be called concurrently
 * per the matrix-sdk-crypto-wasm contract.
 */
class Mutex {
  private queue: Array<() => void> = [];
  private locked = false;

  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.locked = false;
    }
  }
}

const sessionMutex = new Mutex();

// ── Types ──

export interface DecryptedEvent {
  /** The original sync event */
  event: SyncEvent;
  /** Decrypted plaintext content, or null if decryption failed */
  plaintext: Record<string, unknown> | null;
  /** Whether the event was successfully decrypted */
  isEncrypted: boolean;
  /** Error message if decryption failed */
  decryptionError: string | null;
}

// ── Session Establishment ──

/**
 * Ensure Olm sessions exist for all devices of the given room members,
 * and share the current Megolm room key with them.
 *
 * Steps:
 *   1. updateTrackedUsers — tell the machine about room membership
 *   2. outgoingRequests  — process KeysQueryRequests to discover devices
 *   3. getMissingSessions — claim OTKs for devices without Olm sessions
 *   4. shareRoomKey       — distribute Megolm session key via Olm
 *
 * Mutex-protected: only one session establishment runs at a time.
 *
 * @param roomId         The room to establish sessions for
 * @param memberUserIds  All user IDs that are members of the room
 */
export async function ensureSessionsForRoom(
  roomId: string,
  memberUserIds: string[],
): Promise<void> {
  const machine = getOlmMachine();

  // Step 1: Update tracked users so the machine knows who is in the room
  const userIds = memberUserIds.map((id) => new sdk.UserId(id));
  await machine.updateTrackedUsers(userIds);

  // Step 2: Process outgoing requests (KeysQuery) to discover all devices
  await processOutgoingRequests();

  await sessionMutex.acquire();
  try {
    // Step 3: Claim one-time keys for devices without Olm sessions
    const claimRequest = await machine.getMissingSessions(userIds);
    if (claimRequest) {
      const claimBody = JSON.parse(claimRequest.body);
      const claimResponse = await apiRequest<Record<string, unknown>>(
        '/keys/claim',
        { method: 'POST', body: claimBody },
      );
      await machine.markRequestAsSent(
        claimRequest.id,
        claimRequest.type,
        JSON.stringify(claimResponse),
      );
    }

    // Step 4: Share Megolm room key to all devices via Olm to-device messages
    const roomIdObj = new sdk.RoomId(roomId);
    const shareRequests = await machine.shareRoomKey(
      roomIdObj,
      userIds,
      new sdk.EncryptionSettings(),
    );

    for (const request of shareRequests) {
      try {
        const reqBody = JSON.parse(request.body);
        const response = await apiRequest<Record<string, unknown>>(
          '/sendToDevice/' + encodeURIComponent(request.type) + '/' + Date.now().toString(36) + Math.random().toString(36).slice(2),
          { method: 'PUT', body: reqBody },
        );
        await machine.markRequestAsSent(
          request.id,
          request.type,
          JSON.stringify(response),
        );
      } catch (err) {
        console.error(
          '[F.R.A.M.E.] Failed to send room key to-device message:',
          err,
        );
      }
    }
  } finally {
    sessionMutex.release();
  }
}

// ── Encryption ──

/**
 * Encrypt an event for a room using the Megolm session.
 *
 * Ensures sessions are established for all room members before encrypting.
 * The returned content is the ciphertext payload ready to send via
 * the messages API.
 *
 * @param roomId         Target room ID
 * @param eventType      Event type (e.g. "m.room.message")
 * @param plaintext      The plaintext content object to encrypt
 * @param memberUserIds  All member user IDs in the room
 * @returns              Encrypted content object
 */
export async function encryptForRoom(
  roomId: string,
  eventType: string,
  plaintext: Record<string, unknown>,
  memberUserIds: string[],
): Promise<Record<string, unknown>> {
  // Ensure all devices have Olm sessions and the Megolm key is shared
  await ensureSessionsForRoom(roomId, memberUserIds);

  const machine = getOlmMachine();
  const roomIdObj = new sdk.RoomId(roomId);

  // Encrypt the event content using the room's Megolm session
  const encrypted = await machine.encryptRoomEvent(
    roomIdObj,
    eventType,
    JSON.stringify(plaintext),
  );

  return JSON.parse(encrypted);
}

// ── Decryption ──

/**
 * Decrypt a single room event.
 *
 * Returns a DecryptedEvent with the plaintext content if successful,
 * or a decryption error message if it fails. Never throws — decryption
 * failures are captured and returned gracefully.
 *
 * @param event The sync event to decrypt
 */
export async function decryptEvent(event: SyncEvent): Promise<DecryptedEvent> {
  // If the event is not encrypted, pass through as-is
  if (event.eventType !== 'm.room.encrypted') {
    return {
      event,
      plaintext: event.content,
      isEncrypted: false,
      decryptionError: null,
    };
  }

  try {
    const machine = getOlmMachine();

    // Build a Matrix-format event JSON for the crypto machine
    const eventJson = JSON.stringify({
      event_id: event.eventId,
      room_id: event.roomId,
      sender: event.senderId,
      type: event.eventType,
      content: event.content,
      origin_server_ts: new Date(event.originServerTs).getTime(),
    });

    const roomIdObj = new sdk.RoomId(event.roomId);

    // decryptRoomEvent expects (eventJson: string, roomId: RoomId, settings: DecryptionSettings)
    const decrypted = await machine.decryptRoomEvent(
      eventJson,
      roomIdObj,
      new sdk.DecryptionSettings(sdk.TrustRequirement.Untrusted),
    );
    const parsed = JSON.parse(decrypted.event);

    return {
      event,
      plaintext: parsed.content ?? parsed,
      isEncrypted: true,
      decryptionError: null,
    };
  } catch (err) {
    // Capture the error — log type and message for debugging
    const errorMessage =
      err instanceof Error ? err.message : 'Unknown decryption error';
    console.error(
      `[F.R.A.M.E.] Decryption failed for event ${event.eventId}:`,
      errorMessage,
      'eventType:', event.eventType,
      'algorithm:', (event.content as Record<string, unknown>)?.algorithm,
    );

    // Store in window for debugging
    if (typeof window !== 'undefined') {
      (window as unknown as Record<string, unknown[]>).__decryptDebug =
        (window as unknown as Record<string, unknown[]>).__decryptDebug || [];
      (window as unknown as Record<string, unknown[]>).__decryptDebug.push({
        eventId: event.eventId,
        error: errorMessage,
        algorithm: (event.content as Record<string, unknown>)?.algorithm,
      });
    }

    return {
      event,
      plaintext: null,
      isEncrypted: true,
      decryptionError: errorMessage,
    };
  }
}

// ── Sync Processing ──

/**
 * Process a sync response through the OlmMachine.
 *
 * This feeds to-device events (containing Megolm room keys) and
 * device-list changes through the machine's receiveSyncChanges,
 * which updates internal session state.
 *
 * Must be called for every /sync response to keep the crypto
 * state up to date.
 *
 * @param syncData The raw sync response data
 */
export async function processSyncResponse(
  syncData: SyncResponse,
): Promise<void> {
  try {
    const machine = getOlmMachine();

    // Convert to-device events from our API format to Matrix sync format
    const toDeviceEvents = (syncData.to_device ?? []).map((evt) => ({
      sender: evt.sender,
      type: evt.type,
      content: evt.content,
    }));

    // Feed to-device events to the OlmMachine so it can:
    // - Receive Megolm room keys (m.room_key)
    // - Process Olm-encrypted key-share messages
    // - Update device tracking state
    await machine.receiveSyncChanges(
      JSON.stringify(toDeviceEvents),
      new sdk.DeviceLists(),
      new Map<string, number>(),
      undefined,
    );

    // Process any outgoing requests generated by sync (e.g., key re-uploads)
    await processOutgoingRequests();
  } catch (err) {
    console.error(
      '[F.R.A.M.E.] Failed to process sync response for crypto:',
      err,
    );
  }
}
