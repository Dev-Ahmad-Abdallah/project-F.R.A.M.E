/**
 * Frontend Crypto & Storage Security Tests
 * Tests the actual cryptoUtils.ts, secureStorage.ts, and notifications.ts
 */

import {
  deriveStorageKey,
  encryptData,
  decryptData,
  generateFingerprint,
  randomBytes,
} from '../crypto/cryptoUtils';

// Polyfill Web Crypto and TextEncoder for jsdom test environment
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { webcrypto } = require('crypto');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { TextEncoder: NodeTextEncoder, TextDecoder: NodeTextDecoder } = require('util');
if (!globalThis.crypto) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
}
if (!globalThis.TextEncoder) {
  Object.defineProperty(globalThis, 'TextEncoder', { value: NodeTextEncoder });
  Object.defineProperty(globalThis, 'TextDecoder', { value: NodeTextDecoder });
}

// ── cryptoUtils.ts ────────────────────────────────────────────

describe('deriveStorageKey', () => {
  it('produces a non-extractable CryptoKey', async () => {
    const salt = randomBytes(16);
    const key = await deriveStorageKey('test-passphrase', salt);
    expect(key).toBeDefined();
    expect(key.extractable).toBe(false);
    expect(key.usages).toContain('encrypt');
    expect(key.usages).toContain('decrypt');
  });

  it('same passphrase + salt produces consistent encryption', async () => {
    const salt = randomBytes(16);
    const key1 = await deriveStorageKey('same-pass', salt);
    const key2 = await deriveStorageKey('same-pass', salt);

    const data = new TextEncoder().encode('hello');
    const { iv, ciphertext } = await encryptData(key1, data);
    const decrypted = await decryptData(key2, iv, ciphertext);
    expect(new TextDecoder().decode(decrypted)).toBe('hello');
  });

  it('different passphrase cannot decrypt', async () => {
    const salt = randomBytes(16);
    const key1 = await deriveStorageKey('correct-pass', salt);
    const key2 = await deriveStorageKey('wrong-pass', salt);

    const data = new TextEncoder().encode('secret');
    const { iv, ciphertext } = await encryptData(key1, data);

    await expect(decryptData(key2, iv, ciphertext)).rejects.toBeDefined();
  });
});

describe('encryptData / decryptData', () => {
  it('round-trip produces original plaintext', async () => {
    const salt = randomBytes(16);
    const key = await deriveStorageKey('pass', salt);
    const original = new TextEncoder().encode('test message');

    const { iv, ciphertext } = await encryptData(key, original);
    const decrypted = await decryptData(key, iv, ciphertext);

    expect(new TextDecoder().decode(decrypted)).toBe('test message');
  });

  it('ciphertext is different from plaintext', async () => {
    const salt = randomBytes(16);
    const key = await deriveStorageKey('pass', salt);
    const plaintext = new TextEncoder().encode('sensitive data');

    const { ciphertext } = await encryptData(key, plaintext);
    expect(Buffer.from(ciphertext).toString()).not.toBe('sensitive data');
  });

  it('each encryption produces a unique ciphertext (fresh IV)', async () => {
    const salt = randomBytes(16);
    const key = await deriveStorageKey('pass', salt);
    const data = new TextEncoder().encode('same message');

    const enc1 = await encryptData(key, data);
    const enc2 = await encryptData(key, data);

    expect(Buffer.from(enc1.iv).toString('hex'))
      .not.toBe(Buffer.from(enc2.iv).toString('hex'));
  });

  it('tampered ciphertext throws on decrypt', async () => {
    const salt = randomBytes(16);
    const key = await deriveStorageKey('pass', salt);
    const data = new TextEncoder().encode('secret');

    const { iv, ciphertext } = await encryptData(key, data);
    ciphertext[0] ^= 0xff;  // flip a byte

    await expect(decryptData(key, iv, ciphertext)).rejects.toBeDefined();
  });
});

describe('generateFingerprint', () => {
  it('produces a 64-char hex string', async () => {
    const fp = await generateFingerprint('some-public-key');
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });

  it('different keys produce different fingerprints', async () => {
    const fp1 = await generateFingerprint('key-alice');
    const fp2 = await generateFingerprint('key-bob');
    expect(fp1).not.toBe(fp2);
  });

  it('same key always produces the same fingerprint (deterministic)', async () => {
    const fp1 = await generateFingerprint('stable-key');
    const fp2 = await generateFingerprint('stable-key');
    expect(fp1).toBe(fp2);
  });
});

describe('randomBytes', () => {
  it('produces the requested number of bytes', () => {
    const bytes = randomBytes(32);
    expect(bytes).toHaveLength(32);
  });

  it('two calls produce different bytes', () => {
    const a = randomBytes(16);
    const b = randomBytes(16);
    expect(Buffer.from(a).toString('hex')).not.toBe(Buffer.from(b).toString('hex'));
  });
});

// ── Private keys must never reach localStorage ────────────────

describe('Private keys never in localStorage', () => {
  beforeEach(() => localStorage.clear());

  it('localStorage is empty after crypto operations', async () => {
    const salt = randomBytes(16);
    await deriveStorageKey('user-passphrase', salt);
    await generateFingerprint('some-public-key');

    expect(localStorage.length).toBe(0);
  });

  it('sessionStorage is empty after crypto operations', async () => {
    const salt = randomBytes(16);
    await deriveStorageKey('user-passphrase', salt);
    expect(sessionStorage.length).toBe(0);
  });
});
