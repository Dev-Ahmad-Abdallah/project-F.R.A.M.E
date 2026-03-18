/**
 * Web Crypto API wrappers for F.R.A.M.E.
 *
 * Provides PBKDF2 key derivation, AES-256-GCM encrypt/decrypt,
 * fingerprint generation, and secure random bytes.
 *
 * SECURITY: Never log or expose raw key material.
 */

const PBKDF2_ITERATIONS = 100_000;
const AES_KEY_LENGTH = 256;
const IV_LENGTH = 12; // 96-bit IV recommended for AES-GCM

/**
 * Derive an AES-256-GCM CryptoKey from a passphrase using PBKDF2.
 *
 * @param passphrase - User-supplied passphrase
 * @param salt - At least 16 bytes; generate with `randomBytes(16)`
 * @returns Non-extractable CryptoKey for AES-GCM
 */
export async function deriveStorageKey(
  passphrase: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: AES_KEY_LENGTH },
    false, // non-extractable — key never leaves SubtleCrypto
    ['encrypt', 'decrypt'],
  );
}

/**
 * AES-256-GCM encrypt with a fresh random IV.
 *
 * @returns `{ iv, ciphertext }` — both Uint8Array. Caller must persist
 *          the IV alongside the ciphertext for decryption.
 */
export async function encryptData(
  key: CryptoKey,
  data: Uint8Array,
): Promise<{ iv: Uint8Array; ciphertext: Uint8Array }> {
  const iv = randomBytes(IV_LENGTH);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    data as BufferSource,
  );

  return { iv, ciphertext: new Uint8Array(ciphertext) };
}

/**
 * AES-256-GCM decrypt.
 *
 * @throws DOMException if key/IV/ciphertext are mismatched (tampered).
 */
export async function decryptData(
  key: CryptoKey,
  iv: Uint8Array,
  ciphertext: Uint8Array,
): Promise<Uint8Array> {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    ciphertext as BufferSource,
  );

  return new Uint8Array(plaintext);
}

/**
 * SHA-256 fingerprint of a public key, returned as a lowercase hex string.
 * Used for safety-number display and key verification UI.
 *
 * @param publicKey - Base64-encoded (or raw string) public key
 */
export async function generateFingerprint(publicKey: string): Promise<string> {
  const encoder = new TextEncoder();
  const digest = await crypto.subtle.digest(
    'SHA-256',
    encoder.encode(publicKey),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Cryptographically secure random bytes via `crypto.getRandomValues`.
 */
export function randomBytes(n: number): Uint8Array {
  const buf = new Uint8Array(n);
  crypto.getRandomValues(buf);
  return buf;
}
