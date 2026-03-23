/**
 * Cross-signing infrastructure for F.R.A.M.E.
 *
 * Provides a user-level Ed25519 master signing key that can cross-sign
 * device keys. This allows other devices (and other users) to verify
 * that a device belongs to a specific user by checking the cross-signature
 * against the user's master public key.
 *
 * Key storage: The private key is encrypted with AES-256-GCM (derived
 * from a storage passphrase via PBKDF2) and persisted in IndexedDB.
 * The public key is uploaded to the homeserver.
 *
 * SECURITY: Private key material is only held in memory during signing
 *           operations and is never logged or transmitted.
 */

import { apiRequest } from '../api/client';
import { deriveStorageKey, encryptData, decryptData, randomBytes } from './cryptoUtils';

// ── Constants ──

const IDB_DB_NAME = 'frame-cross-signing';
const IDB_STORE_NAME = 'keys';
const IDB_MASTER_KEY_ID = 'master-signing-key';
const IDB_MASTER_PUBLIC_KEY_ID = 'master-public-key';
const _STORAGE_PASSPHRASE_KEY = 'frame-cross-signing-passphrase';

// ── IndexedDB helpers ──

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
        db.createObjectStore(IDB_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE_NAME, 'readonly');
    const store = tx.objectStore(IDB_STORE_NAME);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
    const store = tx.objectStore(IDB_STORE_NAME);
    const req = store.put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ── Passphrase derivation ──

/**
 * Get or generate the storage passphrase used to encrypt the master private key.
 * Kept in memory only — never written to sessionStorage/localStorage.
 * This means the passphrase is lost on page reload, which is acceptable
 * since cross-signing keys are re-derived from the OlmMachine on init.
 */
let _memoryPassphrase: string | null = null;

function getStoragePassphrase(): string {
  if (!_memoryPassphrase) {
    _memoryPassphrase = Array.from(randomBytes(32))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  return _memoryPassphrase;
}

// ── Helpers: base64 <-> ArrayBuffer ──

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    // eslint-disable-next-line security/detect-object-injection
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    // eslint-disable-next-line security/detect-object-injection
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// ── Core API ──

/**
 * Generate an Ed25519 master signing key pair.
 *
 * - The private key is encrypted with the user's storage passphrase
 *   and persisted in IndexedDB.
 * - The public key is stored in IndexedDB and uploaded to the server.
 *
 * @returns The base64-encoded public key.
 */
export async function generateMasterKey(): Promise<string> {
  // Generate Ed25519 key pair via Web Crypto
  // Note: Ed25519 support requires a modern browser (Chrome 113+, Firefox 127+).
  // We use the "Ed25519" named curve with the "sign"/"verify" usages.
  const keyPair = await crypto.subtle.generateKey(
    { name: 'Ed25519' } as EcKeyGenParams,
    true, // extractable — we need to export and encrypt the private key
    ['sign', 'verify'],
  );

  // Export keys to raw format
  const publicKeyRaw = await crypto.subtle.exportKey('raw', keyPair.publicKey);
  const privateKeyPkcs8 = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);

  const publicKeyBase64 = arrayBufferToBase64(publicKeyRaw);

  // Encrypt the private key before storing in IndexedDB
  const passphrase = getStoragePassphrase();
  const salt = randomBytes(16);
  const storageKey = await deriveStorageKey(passphrase, salt);
  const { iv, ciphertext } = await encryptData(storageKey, new Uint8Array(privateKeyPkcs8));

  // Store encrypted private key in IndexedDB
  await idbSet(IDB_MASTER_KEY_ID, {
    salt: Array.from(salt),
    iv: Array.from(iv),
    ciphertext: Array.from(ciphertext),
  });

  // Store public key in IndexedDB for easy retrieval
  await idbSet(IDB_MASTER_PUBLIC_KEY_ID, publicKeyBase64);

  // Upload public key to server
  await apiRequest('/devices/master-key', {
    method: 'PUT',
    body: { masterSigningKey: publicKeyBase64 },
  });

  console.info('[F.R.A.M.E.] Master signing key generated and uploaded.');
  return publicKeyBase64;
}

/**
 * Retrieve the master public key from IndexedDB.
 *
 * @returns The base64-encoded public key, or null if not generated yet.
 */
export async function getMasterPublicKey(): Promise<string | null> {
  const stored = await idbGet<string>(IDB_MASTER_PUBLIC_KEY_ID);
  return stored ?? null;
}

/**
 * Load the master private key from IndexedDB and decrypt it.
 *
 * @returns The imported CryptoKey for signing operations.
 * @throws Error if no master key exists or decryption fails.
 */
async function loadMasterPrivateKey(): Promise<CryptoKey> {
  const stored = await idbGet<{
    salt: number[];
    iv: number[];
    ciphertext: number[];
  }>(IDB_MASTER_KEY_ID);

  if (!stored) {
    throw new Error('No master signing key found. Call generateMasterKey() first.');
  }

  const passphrase = getStoragePassphrase();
  const salt = new Uint8Array(stored.salt);
  const iv = new Uint8Array(stored.iv);
  const ciphertext = new Uint8Array(stored.ciphertext);

  const storageKey = await deriveStorageKey(passphrase, salt);
  const privateKeyRaw = await decryptData(storageKey, iv, ciphertext);

  // Import the private key for signing
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    privateKeyRaw,
    { name: 'Ed25519' } as EcKeyImportParams,
    false, // non-extractable once imported
    ['sign'],
  );

  return privateKey;
}

/**
 * Sign a device's public key with the master signing key.
 *
 * Creates a cross-signature proving the user trusts this device.
 * The signed payload is: `cross-sign:<devicePublicKey>` encoded as UTF-8.
 *
 * @param devicePublicKey Base64-encoded device public key to sign.
 * @returns Base64-encoded Ed25519 signature.
 */
export async function signDeviceKey(devicePublicKey: string): Promise<string> {
  const privateKey = await loadMasterPrivateKey();

  // Create a canonical payload to sign
  const payload = new TextEncoder().encode(`cross-sign:${devicePublicKey}`);

  const signature = await crypto.subtle.sign(
    { name: 'Ed25519' } as EcdsaParams,
    privateKey,
    payload,
  );

  const signatureBase64 = arrayBufferToBase64(signature);
  console.info('[F.R.A.M.E.] Device key cross-signed successfully.');
  return signatureBase64;
}

/**
 * Verify a cross-signature on a device public key.
 *
 * @param masterPublicKey  Base64-encoded master public key of the signing user.
 * @param signature        Base64-encoded Ed25519 signature.
 * @param devicePublicKey  Base64-encoded device public key that was signed.
 * @returns True if the signature is valid.
 */
export async function verifyCrossSignature(
  masterPublicKey: string,
  signature: string,
  devicePublicKey: string,
): Promise<boolean> {
  try {
    // Import the master public key for verification
    const publicKey = await crypto.subtle.importKey(
      'raw',
      base64ToArrayBuffer(masterPublicKey),
      { name: 'Ed25519' } as EcKeyImportParams,
      false,
      ['verify'],
    );

    // Reconstruct the canonical payload
    const payload = new TextEncoder().encode(`cross-sign:${devicePublicKey}`);

    const valid = await crypto.subtle.verify(
      { name: 'Ed25519' } as EcdsaParams,
      publicKey,
      base64ToArrayBuffer(signature),
      payload,
    );

    return valid;
  } catch (err) {
    console.error('[F.R.A.M.E.] Cross-signature verification failed:', err);
    return false;
  }
}

/**
 * Fetch a user's master public key from the server.
 *
 * @param userId The user ID to look up.
 * @returns The base64-encoded master public key, or null if none exists.
 */
export async function fetchMasterPublicKey(userId: string): Promise<string | null> {
  try {
    const response = await apiRequest<{ userId: string; masterSigningKey: string }>(
      `/devices/master-key/${encodeURIComponent(userId)}`,
      { method: 'GET' },
    );
    return response.masterSigningKey;
  } catch {
    return null;
  }
}
