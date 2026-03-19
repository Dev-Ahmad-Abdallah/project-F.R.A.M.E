// Frontend test setup — polyfill Web Crypto for jsdom
const { webcrypto } = require('crypto');
if (!globalThis.crypto) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
}
