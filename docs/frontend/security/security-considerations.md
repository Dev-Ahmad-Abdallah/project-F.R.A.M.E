# Frontend Security Considerations

**Owner:** Mohamed Hussain (235697)

---

## Implementation Guidelines

### Cryptography

1. **Never implement your own crypto** — use vodozemac (via `matrix-sdk-crypto-wasm`) for Olm/Megolm, Web Crypto API for primitives
2. **Pin vodozemac/matrix-sdk-crypto-wasm version** — upgrade only after reviewing changelogs for security fixes
3. **Zero-out key material** — after use, overwrite buffers with zeros (JavaScript limitation: no guaranteed secure wipe, but best effort)
4. **Use Web Workers for heavy crypto** — prevent UI thread blocking during key generation / encryption
5. **Validate all crypto inputs** — check key lengths, curve points, signature formats before processing
6. **Handle crypto errors gracefully** — never expose error details that reveal internal state

### Key Management

1. **Generate keys using Web Crypto API** — `crypto.getRandomValues()` for randomness, `crypto.subtle.generateKey()` for key pairs
2. **Never log private keys** — not to console, not to error trackers, not to analytics
3. **Rotate one-time prekeys proactively** — replenish when count drops below 10
4. **Store verification status locally** — don't trust server's claim about whether a key is verified
5. **Alert on any key change** — even if it looks legitimate, user must acknowledge

### Message Rendering

1. **DOMPurify on EVERY render path** — no exceptions, no shortcuts
2. **Allowlist approach** — only permit known-safe HTML tags and attributes
3. **Sanitize markdown output** — markdown-to-HTML renderers can produce dangerous HTML
4. **No `innerHTML` without sanitization** — use `textContent` for plain text, DOMPurify for rich content
5. **CSP headers** — add Content-Security-Policy to prevent inline script execution as defense-in-depth

### Storage

1. **Request persistent storage** — `navigator.storage.persist()` to prevent browser eviction
2. **Encrypt all IndexedDB values** — no plaintext sensitive data
3. **Use transactions** — atomic operations prevent partial state on crash
4. **No secrets in localStorage** — ever
5. **Clear sensitive data on logout** — wipe keys, sessions, messages from IndexedDB

### Authentication

1. **JWT in memory only** — JavaScript variable, not localStorage, not cookies
2. **Short-lived access tokens** — 15 minutes recommended
3. **Longer-lived refresh tokens** — but stored securely (httpOnly cookie if possible)
4. **Handle 401 transparently** — auto-refresh, retry, or redirect to login
5. **No credentials in URLs** — always in headers or POST body

### Notifications

1. **Push payloads must be opaque** — coordinate with backend to send empty payloads
2. **Service Worker decrypts locally** — before any notification display
3. **Generic notification text only** — "New message" with no identifying information
4. **Test on all target browsers** — Service Worker support varies

### Device Management

1. **New device = untrusted until verified** — QR code approval required
2. **Monitor device list for changes** — alert on unexpected additions
3. **Limit max devices** — prevent resource exhaustion from too many sessions
4. **Revocation must trigger key rotation** — compromised device shouldn't read future messages

---

## Common Pitfalls to Avoid

| Pitfall | Why It's Dangerous | Correct Approach |
|---------|-------------------|-----------------|
| Using `Math.random()` for crypto | Predictable, not cryptographically secure | Use `crypto.getRandomValues()` |
| Storing JWT in localStorage | Accessible to XSS attacks | Store in memory (JavaScript variable) |
| Using `innerHTML` for messages | XSS attack vector | DOMPurify.sanitize() first |
| Logging decrypted content | Defeats E2EE if logs are exfiltrated | Never log plaintext messages |
| Trusting server's key claims | Server could substitute keys | Always verify with Merkle proof |
| Hardcoding homeserver URL | Prevents federation flexibility | Use configuration / environment variable |
| Ignoring crypto errors | May indicate attack or corruption | Fail closed — reject and alert |
| Not rotating Megolm sessions | Limits post-compromise security | Rotate on member change + periodically |

---

## Browser-Specific Concerns

| Browser | Concern | Mitigation |
|---------|---------|-----------|
| All | IndexedDB storage limits vary | Request persistent storage; handle eviction |
| Safari | Service Worker limitations (no background sync) | Test thoroughly; provide fallback |
| Firefox | Stricter CORS policies | Ensure backend sets correct CORS headers |
| All | Web Crypto API availability | Check `window.crypto.subtle` existence |
| Mobile | App may be killed in background → SW stops | Re-sync on app foreground |

---

## Security Checklist (Pre-Release)

- [ ] No private keys or plaintext messages logged to console
- [ ] DOMPurify applied before every message render
- [ ] Service Worker push handler never passes raw payload to notification API
- [ ] IndexedDB stores contain no unencrypted private key material
- [ ] All fetch calls go through `src/api/client.ts`
- [ ] No raw `fetch()` calls with hardcoded URLs
- [ ] JWT not stored in localStorage or cookies
- [ ] New device can only be linked via explicit user action on trusted device
- [ ] Key change triggers visible alert before allowing communication
- [ ] Error responses don't leak internal state or stack traces
- [ ] CSP headers configured (no inline scripts, no eval)
- [ ] No `eval()`, `Function()`, or dynamic script loading
