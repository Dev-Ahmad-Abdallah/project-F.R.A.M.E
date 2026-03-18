# Feature: Monitoring & Logging

**Owner:** Hossam Elsayed (235174)
**Priority:** Week 3
**Status:** Planned

---

## Overview

Monitoring and logging provide operational visibility into F.R.A.M.E.'s runtime behavior. The goal is to detect anomalies, track performance, and support incident response — without compromising user privacy by logging message content.

---

## Logging Architecture

```
Application (Express.js)
  │
  │  Structured JSON logs (stdout)
  │
  ▼
Railway Log Collector
  │
  │  Auto-collected from stdout/stderr
  │
  ▼
Railway Log Viewer (Dashboard)
  │
  └── Optional: Forward to external service (Datadog, Grafana Cloud, etc.)
```

---

## What to Log

| Category | Log | Format |
|----------|-----|--------|
| **HTTP Requests** | Method, path, status, response time, user_id | `{"method":"POST","path":"/messages/send","status":200,"ms":45,"user":"@alice"}` |
| **Authentication** | Login attempts (success/fail), token refresh | `{"event":"login_failed","user":"@alice","ip":"...","reason":"bad_password"}` |
| **Federation** | Inbound/outbound events, peer identity | `{"event":"federation_send","peer":"frame-b.railway.app","event_id":"$abc"}` |
| **Errors** | Unhandled exceptions, validation failures | `{"level":"error","message":"DB connection failed","code":"ECONNREFUSED"}` |
| **Health** | Service start/stop, health check results | `{"event":"service_start","version":"1.0.0","port":3000}` |

## What to NEVER Log

| Data | Why |
|------|-----|
| Message plaintext | Defeats E2EE |
| Ciphertext content | Unnecessary, potentially reversible |
| Private keys | Total security compromise |
| JWT tokens | Token theft via log access |
| Full request bodies | May contain sensitive data |
| User passwords | Even hashed — unnecessary exposure |

---

## Monitoring Metrics

### Application Metrics

| Metric | Why It Matters | Alert Threshold |
|--------|---------------|-----------------|
| Request latency (p95) | User experience | > 2 seconds |
| Error rate (5xx) | Service health | > 5% of requests |
| Active connections | Capacity planning | > 80% of limit |
| Message queue depth | Delivery backlog | > 100 pending |
| Login failure rate | Brute force detection | > 10/min from single IP |
| Federation error rate | Peer health | > 20% of federation requests |

### Infrastructure Metrics (Railway Dashboard)

| Metric | Source | Alert Threshold |
|--------|--------|-----------------|
| CPU usage | Railway metrics | > 80% sustained |
| Memory usage | Railway metrics | > 80% of allocation |
| Disk usage | Railway metrics | > 80% |
| Redis memory | Railway metrics | > 70% of max |
| PostgreSQL connections | Railway metrics | > 80% of limit |

---

## Health Check Endpoint

```
GET /health

Response:
{
  "status": "ok",
  "uptime": 3600,
  "version": "1.0.0",
  "services": {
    "database": "connected",
    "redis": "connected"
  }
}
```

Railway uses this to determine if the service is healthy. If it returns non-200, Railway triggers a restart.

---

## Anomaly Detection

| Anomaly | Detection | Response |
|---------|-----------|----------|
| Spike in login failures | Rate > 10/min from IP | Temporary IP block |
| Unusual federation traffic | Rate > 5x normal from peer | Federation circuit breaker |
| Memory leak | Steadily increasing memory over hours | Alert + investigate |
| Queue growth | Delivery queue depth increasing | Scale workers or investigate blockage |
| Error spike | 5xx rate > 5% | Alert + investigate |

---

## Privacy-Preserving Logging

The logging strategy must balance operational visibility with user privacy:

1. **Aggregate, don't individualize** — log counts and rates, not per-user activity patterns
2. **Minimize identifiers** — use user_id in error logs only when needed for debugging
3. **Short retention** — define max log retention (e.g., 30 days)
4. **Access control** — restrict log access to authorized team members
5. **No communication graph** — don't log "user A sent message to user B"

---

## Security Considerations

1. **Log injection prevention** — sanitize user-controlled data before logging
2. **Structured logging** — JSON format prevents log injection via line breaks
3. **Log access control** — Railway dashboard access limited to team members
4. **No secrets in logs** — mask tokens, keys, passwords in all log output
5. **Alert on anomalies** — don't just collect logs; act on them
