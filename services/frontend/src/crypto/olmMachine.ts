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

// Type-only import — zero runtime cost, erased by TypeScript compiler
import type * as SdkTypes from '@matrix-org/matrix-sdk-crypto-wasm';
import { apiRequest } from '../api/client';

// Lazy-load the WASM module — saves 2MB+ on initial page load.
// The static `import * as sdk` was pulling ~2MB of WASM into the initial bundle.
let sdk: typeof import('@matrix-org/matrix-sdk-crypto-wasm');
async function loadSdk() {
  if (!sdk) sdk = await import('@matrix-org/matrix-sdk-crypto-wasm');
  return sdk;
}

// ── Types ──

export interface IdentityKeys {
  /** Curve25519 public key (base64) */
  curve25519: string;
  /** Ed25519 public key (base64) */
  ed25519: string;
}

/** Request types produced by OlmMachine.outgoingRequests() */
type OutgoingRequest = SdkTypes.KeysUploadRequest | SdkTypes.KeysQueryRequest | SdkTypes.KeysClaimRequest | SdkTypes.ToDeviceRequest;

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

/**
 * Flag set to true when another tab is already running an OlmMachine.
 * Checked in initCrypto() to prevent concurrent instances that cause key conflicts.
 */
let anotherTabActive = false;

/**
 * Returns true if another tab has been detected running an OlmMachine.
 */
export function isOtherTabActive(): boolean {
  return anotherTabActive;
}

function setupBroadcastChannel(): void {
  if (typeof BroadcastChannel === 'undefined') return;

  broadcastChannel = new BroadcastChannel(CHANNEL_NAME);

  // Announce this tab's presence
  broadcastChannel.postMessage({ type: 'olm-machine-active' });

  broadcastChannel.onmessage = (event: MessageEvent) => {
    const msgData = event.data as Record<string, unknown> | undefined;
    if (msgData?.type === 'olm-machine-active') {
      if (machine !== null) {
        // Another tab started while we are already running — warn but keep running
        // (we are the primary tab).
        console.warn(
          '[F.R.A.M.E.] Another tab attempted to start an OlmMachine. ' +
            'This tab is the primary crypto instance.',
        );
      } else {
        // We haven't initialised yet but another tab is active — block init
        anotherTabActive = true;
      }
    }
  };
}

function teardownBroadcastChannel(): void {
  broadcastChannel?.close();
  broadcastChannel = null;
  anotherTabActive = false;
}

// ── Singleton state ──

let machine: SdkTypes.OlmMachine | null = null;
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
  // Block initialisation if another tab is already running an OlmMachine.
  // Concurrent instances sharing the same IndexedDB store cause key conflicts
  // and message decryption failures.
  if (anotherTabActive) {
    throw new Error(
      'F.R.A.M.E. encryption is already active in another tab. ' +
        'Please close the other tab and reload this page to use encryption here.',
    );
  }

  // Lazy-load + initialise WASM runtime once
  const sdkModule = await loadSdk();
  if (!wasmInitialised) {
    await sdkModule.initAsync();
    wasmInitialised = true;
  }

  // If already running for a DIFFERENT identity, tear down first to avoid
  // using wrong keys after an account switch.
  if (machine !== null) {
    if (currentUserId === userId && currentDeviceId === deviceId) {
      return; // Same identity — no-op
    }
    console.warn(
      `[F.R.A.M.E.] OlmMachine identity changed (${currentUserId ?? 'null'}/${currentDeviceId ?? 'null'} → ${userId}/${deviceId}). Destroying old machine.`,
    );
    destroyCrypto();
  }

  const uid = new sdkModule.UserId(userId);
  const did = new sdkModule.DeviceId(deviceId);

  // Use IndexedDB-backed store for persistent E2EE state across sessions.
  // The store name is unique per user/device to avoid key confusion.
  const storeName = `frame-crypto-${userId}-${deviceId}`;
  const storePassphrase = `${userId}:${deviceId}:frame-olm-store`;
  machine = await sdkModule.OlmMachine.initialize(uid, did, storeName, storePassphrase);
  currentUserId = userId;
  currentDeviceId = deviceId;

  setupBroadcastChannel();
  startPrekeyMonitor();
}

/**
 * Return the initialised OlmMachine singleton.
 *
 * @throws Error if `initCrypto()` has not been called yet.
 */
export function getOlmMachine(): SdkTypes.OlmMachine {
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

// ── Key Backup Export / Import ──

/**
 * Export all Megolm room keys, encrypted with a user-supplied passphrase.
 *
 * The export uses the OlmMachine's built-in `exportRoomKeys` to serialise
 * every inbound group session, then wraps the result in AES-256-GCM
 * encryption derived from the passphrase via PBKDF2 (100 000 iterations).
 *
 * @param passphrase  User-chosen passphrase to protect the export
 * @returns JSON string containing `{ version, iv, salt, data }` ready
 *          for download as a `.frame-keys` file.
 */
export async function exportRoomKeys(passphrase: string): Promise<string> {
  const m = getOlmMachine();

  // Export every inbound Megolm session (predicate always returns true)
  const exported: string = await m.exportRoomKeys(() => true);

  // Derive an AES-256-GCM key from the passphrase
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  const aesKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );

  // Encrypt the exported JSON
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    new TextEncoder().encode(exported),
  );

  return JSON.stringify({
    version: 1,
    iv: Array.from(iv),
    salt: Array.from(salt),
    data: Array.from(new Uint8Array(ciphertext)),
  });
}

/**
 * Result returned after importing room keys.
 */
export interface KeyImportResult {
  importedCount: number;
  totalCount: number;
}

/**
 * Import Megolm room keys from an encrypted backup file.
 *
 * Decrypts the file contents using the passphrase, then feeds the
 * plaintext key JSON into the OlmMachine's `importExportedRoomKeys`.
 *
 * @param encryptedJson  The JSON string produced by `exportRoomKeys`
 * @param passphrase     The passphrase used during export
 * @returns Number of keys imported and total keys in the file
 * @throws Error if passphrase is wrong or data is corrupted
 */
export async function importRoomKeys(
  encryptedJson: string,
  passphrase: string,
): Promise<KeyImportResult> {
  const m = getOlmMachine();

  const payload = JSON.parse(encryptedJson) as {
    version: number;
    iv: number[];
    salt: number[];
    data: number[];
  };

  if (payload.version !== 1) {
    throw new Error(`Unsupported key backup version: ${payload.version}`);
  }

  // Derive the same AES key from passphrase + stored salt
  const salt = new Uint8Array(payload.salt);
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  const aesKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );

  // Decrypt the payload
  const iv = new Uint8Array(payload.iv);
  const ciphertext = new Uint8Array(payload.data);
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      aesKey,
      ciphertext,
    );
  } catch {
    throw new Error(
      'Decryption failed. The passphrase may be incorrect or the backup file is corrupted.',
    );
  }

  const exportedKeysJson = new TextDecoder().decode(plaintext);

  // Import into the OlmMachine
  const result = await m.importExportedRoomKeys(
    exportedKeysJson,
    (_progress: bigint, _total: bigint) => {
      // Progress callback — could wire to UI in the future
    },
  );

  return {
    importedCount: result.importedCount,
    totalCount: result.totalCount,
  };
}

// ── Prekey replenishment ──

const PREKEY_REPLENISH_THRESHOLD = 10;
const PREKEY_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
let prekeyCheckTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Check the server-side one-time key (OTK) count and replenish if below
 * threshold. When the count drops below {@link PREKEY_REPLENISH_THRESHOLD},
 * `processOutgoingRequests()` is called — the OlmMachine will automatically
 * include a KeysUploadRequest with fresh OTKs.
 */
export async function checkAndReplenishPrekeys(): Promise<void> {
  try {
    const response = await apiRequest<{ count: number }>('/keys/count', {
      method: 'GET',
    });

    if (response.count < PREKEY_REPLENISH_THRESHOLD) {
      await processOutgoingRequests();
    }
  } catch (err) {
    console.error('[F.R.A.M.E.] Failed to check/replenish prekeys:', err);
  }
}

/**
 * Start a periodic timer that checks and replenishes prekeys every 5 minutes.
 * Called automatically after OlmMachine initialisation.
 */
function startPrekeyMonitor(): void {
  stopPrekeyMonitor();
  prekeyCheckTimer = setInterval(() => {
    void checkAndReplenishPrekeys();
  }, PREKEY_CHECK_INTERVAL_MS);
}

/**
 * Stop the periodic prekey replenishment timer.
 */
function stopPrekeyMonitor(): void {
  if (prekeyCheckTimer !== null) {
    clearInterval(prekeyCheckTimer);
    prekeyCheckTimer = null;
  }
}

/**
 * Destroy the current OlmMachine and reset state.
 * Primarily for logout / account switch.
 */
export function destroyCrypto(): void {
  stopPrekeyMonitor();
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
  const sdkModule = await loadSdk();
  const body = JSON.parse(request.body) as Record<string, unknown>;
  switch (request.type) {
    case sdkModule.RequestType.KeysUpload:
      return JSON.stringify(
        await apiRequest<Record<string, unknown>>('/keys/upload', { method: 'POST', body }),
      );

    case sdkModule.RequestType.KeysQuery:
      return JSON.stringify(
        await apiRequest<Record<string, unknown>>('/keys/query', { method: 'POST', body }),
      );

    case sdkModule.RequestType.KeysClaim:
      return JSON.stringify(
        await apiRequest<Record<string, unknown>>('/keys/claim', { method: 'POST', body }),
      );

    case sdkModule.RequestType.ToDevice: {
      // ToDeviceRequest has event_type and txn_id properties
      const toDeviceReq = request as SdkTypes.ToDeviceRequest;
      const eventType = toDeviceReq.event_type;
      const txnId = toDeviceReq.txn_id;
      return JSON.stringify(
        await apiRequest<Record<string, unknown>>(
          `/sendToDevice/${encodeURIComponent(eventType)}/${encodeURIComponent(txnId)}`,
          { method: 'PUT', body },
        ),
      );
    }

    default:
      console.warn(
        `[F.R.A.M.E.] Unhandled outgoing request type: ${request.type}`,
      );
      return '{}';
  }
}
