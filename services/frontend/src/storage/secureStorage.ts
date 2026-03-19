/**
 * Secure IndexedDB storage for F.R.A.M.E.
 *
 * All values are encrypted at rest with AES-256-GCM. The encryption
 * key is derived from a user passphrase via PBKDF2 (100 000 iterations).
 *
 * Uses the `idb` library for a clean async/await IndexedDB wrapper.
 *
 * Stores:
 *   - keys         — identity keys, signed pre-keys
 *   - sessions     — Olm / Megolm session pickles
 *   - messages     — encrypted message cache
 *   - devices      — known device records
 *   - verification — cross-signing & verification state
 *
 * SECURITY:
 *   - The passphrase is never stored; only the derived CryptoKey lives
 *     in memory for the duration of the session.
 *   - PBKDF2 salt is persisted in a separate unencrypted meta store so
 *     the same salt is reused across page loads.
 */

import { openDB, type IDBPDatabase } from 'idb';
import {
  deriveStorageKey,
  encryptData,
  decryptData,
  randomBytes,
} from '../crypto/cryptoUtils';

// ── Constants ──

const DB_NAME = 'frame-store';
const DB_VERSION = 1;
const SALT_LENGTH = 16;

/**
 * The five application object stores plus one meta store for the
 * PBKDF2 salt.
 */
const STORES = [
  'keys',
  'sessions',
  'messages',
  'devices',
  'verification',
  '_meta',
] as const;

export type StoreName = (typeof STORES)[number];

// ── Module state ──

let db: IDBPDatabase | null = null;
let storageKey: CryptoKey | null = null;

// ── Helpers ──

function ensureReady(): { db: IDBPDatabase; key: CryptoKey } {
  if (!db || !storageKey) {
    throw new Error(
      'SecureStorage not initialised. Call initStorage() first.',
    );
  }
  return { db, key: storageKey };
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Encode a serialisable value to bytes for encryption.
 */
function serialise(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value));
}

/**
 * Decode bytes back to the original value after decryption.
 */
function deserialise<T>(bytes: Uint8Array): T {
  return JSON.parse(decoder.decode(bytes)) as T;
}

// ── Public API ──

/**
 * Open (or create) the IndexedDB database and derive the storage
 * encryption key from the user's passphrase.
 *
 * Must be called once before any `getEncrypted` / `setEncrypted` call.
 *
 * @param passphrase - User-supplied passphrase for at-rest encryption
 */
export async function initStorage(passphrase: string): Promise<void> {
  // Open / upgrade database
  db = await openDB(DB_NAME, DB_VERSION, {
    upgrade(database) {
      for (const store of STORES) {
        if (!database.objectStoreNames.contains(store)) {
          database.createObjectStore(store);
        }
      }
    },
  });

  // Retrieve or generate PBKDF2 salt
  let salt: Uint8Array;
  const existingSalt = (await db.get('_meta', 'salt')) as Uint8Array | undefined;

  if (existingSalt) {
    salt = existingSalt;
  } else {
    salt = randomBytes(SALT_LENGTH);
    await db.put('_meta', salt, 'salt');
  }

  // Derive AES-256-GCM key
  storageKey = await deriveStorageKey(passphrase, salt);
}

/**
 * Read and decrypt a value from the specified store.
 *
 * @returns The decrypted value, or `undefined` if the key does not exist.
 */
export async function getEncrypted<T = unknown>(
  store: StoreName,
  key: string,
): Promise<T | undefined> {
  const { db: database, key: cryptoKey } = ensureReady();

  const record = (await database.get(store, key)) as
    { iv: Uint8Array; ciphertext: Uint8Array } | undefined;

  if (!record) return undefined;

  const plaintext = await decryptData(
    cryptoKey,
    new Uint8Array(record.iv),
    new Uint8Array(record.ciphertext),
  );

  return deserialise<T>(plaintext);
}

/**
 * Encrypt and write a value to the specified store.
 *
 * @param store - Target object store name
 * @param key   - Key within the store
 * @param value - Any JSON-serialisable value
 */
export async function setEncrypted(
  store: StoreName,
  key: string,
  value: unknown,
): Promise<void> {
  const { db: database, key: cryptoKey } = ensureReady();

  const plaintext = serialise(value);
  const { iv, ciphertext } = await encryptData(cryptoKey, plaintext);

  await database.put(store, { iv, ciphertext }, key);
}

/**
 * Delete all data across all stores and close the database.
 *
 * Used on logout or account deletion.
 */
export async function clearAll(): Promise<void> {
  if (!db) return;

  const tx = db.transaction(
    STORES as unknown as string[],
    'readwrite',
  );

  await Promise.all([
    ...STORES.map((store) => tx.objectStore(store).clear()),
    tx.done,
  ]);

  db.close();
  db = null;
  storageKey = null;
}
