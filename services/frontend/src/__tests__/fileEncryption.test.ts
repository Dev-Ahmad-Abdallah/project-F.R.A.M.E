/**
 * Tests for AES-256-GCM file encryption/decryption and formatFileSize.
 */

// Polyfill Web Crypto for jsdom test environment
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { webcrypto } = require('crypto');
if (!globalThis.crypto) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
}

import { encryptFile, decryptFile, formatFileSize } from '../crypto/fileEncryption';

// ── encryptFile / decryptFile round-trip ──

describe('encryptFile / decryptFile', () => {
  it('round-trip produces the original data', async () => {
    const original = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
    const { encryptedBytes, key, iv } = await encryptFile(original);
    const decrypted = await decryptFile(encryptedBytes, key, iv);

    expect(Array.from(decrypted)).toEqual(Array.from(original));
  });

  it('works with empty data', async () => {
    const original = new Uint8Array(0);
    const { encryptedBytes, key, iv } = await encryptFile(original);
    const decrypted = await decryptFile(encryptedBytes, key, iv);

    expect(decrypted).toHaveLength(0);
  });

  it('works with larger data (1 KB)', async () => {
    const original = new Uint8Array(1024);
    for (let i = 0; i < 1024; i++) original[i] = i % 256;

    const { encryptedBytes, key, iv } = await encryptFile(original);
    const decrypted = await decryptFile(encryptedBytes, key, iv);

    expect(Array.from(decrypted)).toEqual(Array.from(original));
  });

  it('ciphertext differs from plaintext', async () => {
    const original = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const { encryptedBytes } = await encryptFile(original);

    // Encrypted data includes GCM auth tag, so it's always longer
    expect(encryptedBytes.length).toBeGreaterThan(original.length);
    // Also check the bytes aren't identical
    const same = encryptedBytes.length === original.length &&
      encryptedBytes.every((b, i) => b === original[i]);
    expect(same).toBe(false);
  });

  it('different files produce different ciphertext', async () => {
    const file1 = new Uint8Array([1, 2, 3]);
    const file2 = new Uint8Array([4, 5, 6]);

    const enc1 = await encryptFile(file1);
    const enc2 = await encryptFile(file2);

    // Different keys
    expect(enc1.key).not.toBe(enc2.key);
    // Different IVs
    expect(enc1.iv).not.toBe(enc2.iv);
  });

  it('same file encrypted twice produces different ciphertext (fresh key/IV)', async () => {
    const original = new Uint8Array([10, 20, 30]);
    const enc1 = await encryptFile(original);
    const enc2 = await encryptFile(original);

    expect(enc1.key).not.toBe(enc2.key);
    expect(enc1.iv).not.toBe(enc2.iv);
  });
});

// ── decryptFile with wrong key ──

describe('decryptFile with wrong key', () => {
  it('fails when given the wrong key', async () => {
    const original = new Uint8Array([1, 2, 3, 4, 5]);
    const { encryptedBytes, iv } = await encryptFile(original);

    // Encrypt a different file to get a different key
    const { key: wrongKey } = await encryptFile(new Uint8Array([99]));

    await expect(decryptFile(encryptedBytes, wrongKey, iv)).rejects.toBeDefined();
  });

  it('fails when ciphertext is tampered with', async () => {
    const original = new Uint8Array([10, 20, 30]);
    const { encryptedBytes, key, iv } = await encryptFile(original);

    // Flip a byte
    const tampered = new Uint8Array(encryptedBytes);
    tampered[0] ^= 0xff;

    await expect(decryptFile(tampered, key, iv)).rejects.toBeDefined();
  });
});

// ── formatFileSize ──

describe('formatFileSize', () => {
  it('formats bytes', () => {
    expect(formatFileSize(0)).toBe('0 B');
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(1023)).toBe('1023 B');
  });

  it('formats kilobytes', () => {
    expect(formatFileSize(1024)).toBe('1.0 KB');
    expect(formatFileSize(1536)).toBe('1.5 KB');
    expect(formatFileSize(10240)).toBe('10.0 KB');
  });

  it('formats megabytes', () => {
    expect(formatFileSize(1024 * 1024)).toBe('1.0 MB');
    expect(formatFileSize(1.5 * 1024 * 1024)).toBe('1.5 MB');
    expect(formatFileSize(100 * 1024 * 1024)).toBe('100.0 MB');
  });

  it('boundary: exactly 1024 bytes = 1.0 KB', () => {
    expect(formatFileSize(1024)).toBe('1.0 KB');
  });

  it('boundary: exactly 1 MB', () => {
    expect(formatFileSize(1024 * 1024)).toBe('1.0 MB');
  });
});
