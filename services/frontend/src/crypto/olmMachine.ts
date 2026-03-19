/**
 * OlmMachine lifecycle management for F.R.A.M.E.
 *
 * Wraps @matrix-org/matrix-sdk-crypto-wasm's OlmMachine — a pure
 * state-machine with no network I/O. This module handles:
 *
 *   1. WASM async init (`initAsync`)
 *   2. OlmMachine creation with automatic key generation
 *   3. Outgoing-request processing (upload keys, query keys, etc.)
 *   4. Mutex protection for concurrent outgoing-request access
 *   5. Multi-tab coordination via BroadcastChannel
 *
 * SECURITY: Identity keys are exposed only via `getIdentityKeys()`.
 *           Private key material never leaves the WASM boundary.
 */

import * as sdk from '@matrix-org/matrix-sdk-crypto-wasm';
import { apiRequest } from '../api/client';

// ── Types ──

export interface IdentityKeys {
  /** Curve25519 public key (base64) */
  curve25519: string;
  /** Ed25519 public key (base64) */
  ed25519: string;
}

/** Request types produced by OlmMachine.outgoingRequests() */
type OutgoingRequest = sdk.KeysUploadRequest | sdk.KeysQueryRequest | sdk.KeysClaimRequest;

// ── Mutex ──

/**
 * Minimal async mutex. Serialises access to OlmMachine methods that
 * must not be called concurrently (`outgoingRequests`, `getMissingSessions`,
 * `shareRoomKey`).
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
      // Hand the lock to the next waiter (stays locked)
      next();
    } else {
      this.locked = false;
    }
  }
}

// ── Multi-tab coordination ──

const CHANNEL_NAME = 'frame-olm-machine';
let broadcastChannel: BroadcastChannel | null = null;

function setupBroadcastChannel(): void {
  if (typeof BroadcastChannel === 'undefined') return;

  broadcastChannel = new BroadcastChannel(CHANNEL_NAME);

  // Announce this tab's presence
  broadcastChannel.postMessage({ type: 'olm-machine-active' });

  broadcastChannel.onmessage = (event: MessageEvent) => {
    if (event.data?.type === 'olm-machine-active' && machine !== null) {
      console.warn(
        '[F.R.A.M.E.] Another tab is running an OlmMachine. ' +
          'Concurrent OlmMachine instances may cause key conflicts. ' +
          'Close other tabs to avoid issues.',
      );
    }
  };
}

function teardownBroadcastChannel(): void {
  broadcastChannel?.close();
  broadcastChannel = null;
}

// ── Singleton state ──

let machine: sdk.OlmMachine | null = null;
let currentUserId: string | null = null;
let currentDeviceId: string | null = null;
let wasmInitialised = false;
const mutex = new Mutex();

// ── Public API ──

/**
 * Initialise the WASM runtime and create an OlmMachine for the given
 * user/device. This automatically generates Curve25519 + Ed25519 keys.
 *
 * Safe to call multiple times — subsequent calls are no-ops if the
 * machine is already initialised for the same user/device.
 *
 * @param userId   Full Matrix-style user ID, e.g. `@alice:example.com`
 * @param deviceId Unique device identifier, e.g. `ABCDEFGHIJ`
 */
export async function initCrypto(
  userId: string,
  deviceId: string,
): Promise<void> {
  // Initialise WASM runtime once
  if (!wasmInitialised) {
    await sdk.initAsync();
    wasmInitialised = true;
  }

  // If already running for a DIFFERENT identity, tear down first to avoid
  // using wrong keys after an account switch.
  if (machine !== null) {
    if (currentUserId === userId && currentDeviceId === deviceId) {
      return; // Same identity — no-op
    }
    console.warn(
      `[F.R.A.M.E.] OlmMachine identity changed (${currentUserId}/${currentDeviceId} → ${userId}/${deviceId}). Destroying old machine.`,
    );
    destroyCrypto();
  }

  const uid = new sdk.UserId(userId);
  const did = new sdk.DeviceId(deviceId);
  machine = await sdk.OlmMachine.initialize(uid, did);
  currentUserId = userId;
  currentDeviceId = deviceId;

  setupBroadcastChannel();
}

/**
 * Return the initialised OlmMachine singleton.
 *
 * @throws Error if `initCrypto()` has not been called yet.
 */
export function getOlmMachine(): sdk.OlmMachine {
  if (machine === null) {
    throw new Error(
      'OlmMachine not initialised. Call initCrypto() first.',
    );
  }
  return machine;
}

/**
 * Extract Curve25519 + Ed25519 identity keys from the machine.
 *
 * @throws Error if machine is not initialised.
 */
export function getIdentityKeys(): IdentityKeys {
  const m = getOlmMachine();
  const keys = m.identityKeys;
  return {
    curve25519: keys.curve25519.toBase64(),
    ed25519: keys.ed25519.toBase64(),
  };
}

/**
 * Process all pending outgoing requests produced by the OlmMachine.
 *
 * The OlmMachine is a pure state-machine: it generates requests (key
 * uploads, key queries, key claims, etc.) that *we* must send to the
 * homeserver, then feed the response back via `markRequestAsSent`.
 *
 * This method is mutex-protected — only one caller processes requests
 * at a time.
 */
export async function processOutgoingRequests(): Promise<void> {
  const m = getOlmMachine();

  await mutex.acquire();
  try {
    const requests = await m.outgoingRequests() as OutgoingRequest[];

    for (const request of requests) {
      try {
        const response = await sendOutgoingRequest(request);
        await m.markRequestAsSent(
          request.id,
          request.type,
          response,
        );
      } catch (err) {
        // Log but continue processing remaining requests.
        // Transient network errors should not block the queue.
        console.error(
          `[F.R.A.M.E.] Failed to send outgoing request (type=${request.type}):`,
          err,
        );
      }
    }
  } finally {
    mutex.release();
  }
}

/**
 * Destroy the current OlmMachine and reset state.
 * Primarily for logout / account switch.
 */
export function destroyCrypto(): void {
  machine = null;
  currentUserId = null;
  currentDeviceId = null;
  teardownBroadcastChannel();
}

// ── Internal helpers ──

/**
 * Map an OlmMachine outgoing request to the correct homeserver
 * endpoint and return the raw response body as a string for
 * `markRequestAsSent`.
 */
async function sendOutgoingRequest(request: OutgoingRequest): Promise<string> {
  const body = JSON.parse(request.body);

  switch (request.type) {
    case sdk.RequestType.KeysUpload:
      return JSON.stringify(
        await apiRequest('/keys/upload', { method: 'POST', body }),
      );

    case sdk.RequestType.KeysQuery:
      return JSON.stringify(
        await apiRequest('/keys/query', { method: 'POST', body }),
      );

    case sdk.RequestType.KeysClaim:
      return JSON.stringify(
        await apiRequest('/keys/claim', { method: 'POST', body }),
      );

    default:
      console.warn(
        `[F.R.A.M.E.] Unhandled outgoing request type: ${request.type}`,
      );
      return '{}';
  }
}
