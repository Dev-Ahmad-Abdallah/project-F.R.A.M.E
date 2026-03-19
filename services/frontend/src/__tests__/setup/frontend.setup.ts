// Frontend test setup — polyfill Web Crypto for jsdom
export {};
const { webcrypto } = require('crypto');
if (!globalThis.crypto) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
}
