/**
 * Client-side file encryption/decryption for F.R.A.M.E.
 *
 * Uses AES-256-GCM via the Web Crypto API. Each file gets a unique
 * random key and IV. The key material is shared through the existing
 * Megolm E2EE message pipeline — the server never sees it.
 */

/**
 * Encrypt a file using AES-256-GCM with a random key.
 */
export async function encryptFile(plainBytes: Uint8Array): Promise<{
  encryptedBytes: Uint8Array;
  key: string; // base64-encoded AES key
  iv: string;  // base64-encoded IV
}> {
  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true, // extractable so we can share the key
    ['encrypt', 'decrypt'],
  );

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plainBytes,
  );

  const exportedKey = await crypto.subtle.exportKey('raw', key);

  return {
    encryptedBytes: new Uint8Array(encrypted),
    key: btoa(String.fromCharCode(...new Uint8Array(exportedKey))),
    iv: btoa(String.fromCharCode(...iv)),
  };
}

/**
 * Decrypt a file using AES-256-GCM.
 */
export async function decryptFile(
  encryptedBytes: Uint8Array,
  keyBase64: string,
  ivBase64: string,
): Promise<Uint8Array> {
  const keyBytes = Uint8Array.from(atob(keyBase64), (c) => c.charCodeAt(0));
  const iv = Uint8Array.from(atob(ivBase64), (c) => c.charCodeAt(0));

  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    encryptedBytes,
  );

  return new Uint8Array(decrypted);
}

/**
 * Format a byte count as a human-readable file size.
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
