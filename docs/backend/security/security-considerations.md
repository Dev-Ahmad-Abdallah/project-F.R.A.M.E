# Backend Security Considerations

**Owner:** Ahmed Ali Abdallah (234742)

---

## Implementation Guidelines

### API Security

1. **Input validation on every endpoint** — use schema validation (e.g., Joi, Zod) for all request bodies
2. **Parameterized queries only** — never concatenate user input into SQL
3. **Request body size limits** — max 64KB for messages, 10MB for attachments
4. **Helmet.js** — set security headers on all responses
5. **CORS whitelist** — only allow known frontend origins
6. **Error responses** — standardized codes, never expose stack traces or internal errors

### Authentication

1. **bcrypt for passwords** — cost factor 12 minimum
2. **JWT secrets in environment variables** — never hardcoded
3. **Short-lived access tokens** (15 min) — limit stolen token window
4. **Refresh token rotation** — new token on each use, invalidate old
5. **Rate limit login** — 5 attempts per 15 min per IP
6. **Account lockout** — after 10 failed attempts, require email/admin verification

### Database

1. **SSL connections to PostgreSQL** — encrypted in transit
2. **Connection pooling** — manage connections efficiently, prevent exhaustion
3. **Parameterized queries** — no SQL injection vectors
4. **Encrypted backups** — database backups encrypted at rest
5. **Minimal privileges** — application DB user has only needed permissions (no DROP, no GRANT)
6. **Audit logging** — track schema changes and admin operations

### Redis

1. **Password authentication** — require auth even in private network
2. **Memory limits** — set maxmemory to prevent OOM on Railway
3. **Key expiry** — all temporary data has TTL (queues, rate limits, online status)
4. **No persistent secrets in Redis** — use for ephemeral data only
5. **Monitor memory usage** — alert before hitting limits

### Federation

1. **Validate all incoming events** — check signatures, format, room membership
2. **Server signing key rotation** — rotate periodically, publish old keys for verification
3. **Rate limit federation endpoints** — prevent amplification and DoS
4. **Reject unsigned requests** — no anonymous federation traffic
5. **Circuit breaker** — temporarily block misbehaving peers
6. **Backfill limits** — cap events returned per request

### Logging

1. **Never log message content** — not plaintext, not ciphertext
2. **Never log private keys or tokens** — mask sensitive fields
3. **Log request metadata** — method, path, status code, response time, user_id
4. **Structured logging** — JSON format for easy parsing
5. **Log retention** — define maximum retention period
6. **Access control on logs** — restrict who can view production logs

---

## Common Pitfalls

| Pitfall | Why Dangerous | Correct Approach |
|---------|---------------|-----------------|
| Storing passwords in plaintext | Full credential exposure on breach | bcrypt with high cost factor |
| Using `SELECT *` | May return sensitive columns unintentionally | Select only needed columns |
| Not validating JWT expiry | Expired tokens accepted | Check `exp` claim on every request |
| Logging full request bodies | May contain keys or tokens | Log only metadata |
| Hardcoding DB credentials | Exposed in source code | Use environment variables |
| Not rate limiting | Enables brute force and DoS | Rate limit all public endpoints |
| Returning detailed error messages | Information disclosure | Generic error messages in production |
| No connection pooling | DB connection exhaustion | Use pg-pool |

---

## Security Checklist (Pre-Release)

- [ ] All SQL queries are parameterized (no string concatenation)
- [ ] Passwords hashed with bcrypt (cost 12+)
- [ ] JWT secret in environment variable, not in code
- [ ] All endpoints have rate limiting
- [ ] CORS configured to allow only known origins
- [ ] Helmet.js enabled (security headers)
- [ ] Request body size limits enforced
- [ ] No message content or keys in application logs
- [ ] PostgreSQL SSL enabled
- [ ] Redis requires authentication
- [ ] Federation events validated (signature + format)
- [ ] Error responses don't expose internal details
- [ ] Health check endpoint exists (for Railway)
- [ ] Database migrations are backwards-compatible
