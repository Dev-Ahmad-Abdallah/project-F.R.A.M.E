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
import { ackToDeviceMessages } from '../api/messagesAPI';
import { fetchAndVerifyKey } from '../verification/keyTransparency';

// Track which users have already been warned about key transparency — prevents console spam
const ktWarnedUsers = new Set<string>();

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

  // Step 1: Update tracked users so the machine knows who is in the room.
  // NOTE: updateTrackedUsers destroys UserId instances, so we create
  // separate arrays for each WASM call that needs them.
  //
  // markAllTrackedUsersAsDirty ensures the machine re-fetches keys even if
  // it has cached state from a previous session (IndexedDB persistence).
  // After restoring from IndexedDB, the OlmMachine may have stale device
  // state, so we always force a fresh keys query regardless.
  const trackUserIds = memberUserIds.map((id) => new sdk.UserId(id));
  await machine.updateTrackedUsers(trackUserIds);
  await machine.markAllTrackedUsersAsDirty();

  // Step 2: Process outgoing requests (KeysQuery) to discover all devices.
  // We call processOutgoingRequests() TWICE with a short delay between:
  //   - The first call generates and sends KeysQuery requests triggered by
  //     markAllTrackedUsersAsDirty().
  //   - The 100ms delay lets the WASM state machine settle and update its
  //     internal tracking state from the KeysQuery response.
  //   - The second call picks up any follow-up requests (e.g. KeysClaim,
  //     additional KeysQuery for newly discovered devices).
  // This two-pass approach fixes cross-session key exchange where a single
  // processOutgoingRequests() after markAllTrackedUsersAsDirty() would not
  // fully refresh device state restored from IndexedDB.
  await processOutgoingRequests();
  await new Promise((resolve) => setTimeout(resolve, 100));
  await processOutgoingRequests();

  // Step 2.5: Verify user tracking state. If getMissingSessions still returns
  // null after two rounds of processOutgoingRequests, the machine may not be
  // tracking the users properly (can happen when IndexedDB state is stale).
  // trackedUsers() returns the full set; we check each member is present.
  // If any user is untracked we force one more updateTrackedUsers +
  // processOutgoingRequests cycle.
  const trackedSet = await machine.trackedUsers();
  const trackedStrings = new Set<string>();
  trackedSet.forEach((uid) => trackedStrings.add(uid.toString()));
  const untrackedMembers = memberUserIds.filter(
    (id) => !trackedStrings.has(id),
  );
  if (untrackedMembers.length > 0) {
    console.warn(
      `[F.R.A.M.E.] ${untrackedMembers.length} user(s) still untracked after initial key query — forcing re-track.`,
    );
    const retryUserIds = memberUserIds.map((id) => new sdk.UserId(id));
    await machine.updateTrackedUsers(retryUserIds);
    await processOutgoingRequests();
  }

  // Step 2.6: Verify each remote member's key against the transparency log
  // before proceeding with key claiming. This is defense-in-depth: if
  // verification fails we log a warning but still proceed so messaging is
  // not broken (the server-side enforcement in queryDeviceKeys is the
  // primary gate).
  for (const memberId of memberUserIds) {
    try {
      const result = await fetchAndVerifyKey(memberId);
      if (!result.verified && result.proof !== null) {
        // Only warn once per user per session to reduce console noise
        if (!ktWarnedUsers.has(memberId)) {
          console.warn(
            `[F.R.A.M.E.] Key transparency verification failed for ${memberId} — proceeding anyway (defense in depth).`,
          );
          ktWarnedUsers.add(memberId);
        }
      }
    } catch {
      // Key transparency check failed — not critical, proceeding with messaging
    }
  }

  await sessionMutex.acquire();
  try {
    // Step 3: Claim one-time keys for devices without Olm sessions
    const claimUserIds = memberUserIds.map((id) => new sdk.UserId(id));
    const claimRequest = await machine.getMissingSessions(claimUserIds);
    if (claimRequest) {
      const claimBody = JSON.parse(claimRequest.body) as Record<string, unknown>;
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
    const shareUserIds = memberUserIds.map((id) => new sdk.UserId(id));
    const shareRequests = await machine.shareRoomKey(
      roomIdObj,
      shareUserIds,
      new sdk.EncryptionSettings(),
    );

    let shareFailureCount = 0;
    for (const request of shareRequests) {
      try {
        const reqBody = JSON.parse(request.body) as Record<string, unknown>;
        // Use event_type (the Matrix event type string, e.g. "m.room.encrypted")
        // not request.type (which is the RequestType enum used for markRequestAsSent)
        const eventType = request.event_type;
        const response = await apiRequest<Record<string, unknown>>(
          '/sendToDevice/' + encodeURIComponent(eventType) + '/' + Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, '0')).join(''),
          { method: 'PUT', body: reqBody },
        );
        await machine.markRequestAsSent(
          request.id,
          request.type,
          JSON.stringify(response),
        );
      } catch (err) {
        shareFailureCount++;
        console.error(
          '[F.R.A.M.E.] Failed to send room key to-device message:',
          err,
        );
      }
    }

    if (shareFailureCount > 0) {
      console.warn(
        `[F.R.A.M.E.] Key sharing completed with ${shareFailureCount}/${shareRequests.length} device(s) failing for room ${roomId}.`,
      );
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

  return JSON.parse(encrypted) as Record<string, unknown>;
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
    const parsed = JSON.parse(decrypted.event) as Record<string, unknown>;

    return {
      event,
      plaintext: (parsed.content as Record<string, unknown> | undefined) ?? parsed,
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
      'algorithm:', event.content?.algorithm,
    );

    // Store in window for debugging
    if (typeof window !== 'undefined') {
      (window as unknown as Record<string, unknown[]>).__decryptDebug =
        (window as unknown as Record<string, unknown[]>).__decryptDebug || [];
      (window as unknown as Record<string, unknown[]>).__decryptDebug.push({
        eventId: event.eventId,
        error: errorMessage,
        algorithm: event.content?.algorithm,
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

// ── Session Invalidation (Forward Secrecy) ──

/**
 * Invalidate the current Megolm group session for a room.
 *
 * This MUST be called whenever a member leaves or is removed from a room.
 * It forces the OlmMachine to create a new Megolm session on the next
 * message, ensuring the departed user cannot decrypt future messages
 * (forward secrecy).
 *
 * @param roomId The room whose Megolm session should be invalidated
 */
export async function invalidateRoomSession(roomId: string): Promise<void> {
  const machine = getOlmMachine();
  const roomIdObj = new sdk.RoomId(roomId);
  await machine.invalidateGroupSession(roomIdObj);
}

/**
 * Invalidate the outbound Megolm session for a room after a device revocation.
 *
 * This is a thin wrapper around invalidateRoomSession, called when a device
 * is removed/revoked. The next encrypt call for this room will create a fresh
 * Megolm session and share it only with currently valid devices, effectively
 * excluding the revoked device from future message decryption.
 *
 * @param roomId The room whose outbound Megolm session should be invalidated
 */
export async function invalidateOutboundSession(roomId: string): Promise<void> {
  console.info(
    `[F.R.A.M.E.] Invalidating outbound Megolm session for room ${roomId} due to device revocation`,
  );
  await invalidateRoomSession(roomId);
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

    // Acknowledge processed to-device messages so the server can clean them up
    const toDeviceIds = (syncData.to_device ?? [])
      .map((evt) => evt.id)
      .filter((id): id is number => typeof id === 'number');

    if (toDeviceIds.length > 0) {
      ackToDeviceMessages(toDeviceIds).catch((ackErr) => {
        console.warn(
          '[F.R.A.M.E.] Failed to ACK to-device messages:',
          ackErr,
        );
      });
    }
  } catch (err) {
    console.error(
      '[F.R.A.M.E.] Failed to process sync response for crypto:',
      err,
    );
  }
}
