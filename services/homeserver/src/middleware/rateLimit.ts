import rateLimit, { type Store, type IncrementResponse, type Options, type RateLimitExceededEventHandler } from 'express-rate-limit';
import type { Request } from 'express';
import { redisClient } from '../redis/client';

// ── Redis-backed rate limit store ──
//
// Uses Redis INCR + PEXPIRE so that rate-limit counters survive server
// restarts and are shared across multiple homeserver instances.
// Falls back gracefully: if Redis is unavailable, the increment call
// resolves with totalHits=0 which effectively disables limiting rather
// than blocking requests.
//
// BUG FIX: The TTL is now only set when the key is first created (INCR
// returns 1). Previously, PEXPIRE was called on every increment, which
// continuously extended the window and prevented the counter from ever
// resetting for active users.

class RedisStore {
  /** Prefix for all Redis keys managed by this store (also exposed for express-rate-limit) */
  prefix: string;
  /** Window duration in milliseconds — used for key expiry */
  private _windowMs: number;
  /** Required by express-rate-limit: false because Redis keys are shared across instances */
  localKeys = false;

  constructor(keyPrefix: string, windowMs: number) {
    this.prefix = keyPrefix;
    this._windowMs = windowMs;
  }

  // Called once by express-rate-limit with the resolved options.
  init(_options: Options): void {
    // Nothing to initialise — Redis client is already connected.
  }

  async increment(key: string): Promise<IncrementResponse> {
    const redisKey = `${this.prefix}:${key}`;
    try {
      const totalHits = await redisClient.incr(redisKey);

      // Only set expiry when the key is first created (totalHits === 1).
      // This ensures the window has a fixed duration and isn't extended
      // by subsequent requests — the previous PEXPIRE-on-every-increment
      // bug caused counters to never reset for active users.
      if (totalHits === 1) {
        await redisClient.pexpire(redisKey, this._windowMs);
      }

      return { totalHits, resetTime: undefined };
    } catch (err) {
      console.error('[RateLimit] Redis increment failed, allowing request:', err);
      return { totalHits: 0, resetTime: undefined };
    }
  }

  async decrement(key: string): Promise<void> {
    const redisKey = `${this.prefix}:${key}`;
    try {
      const current = await redisClient.get(redisKey);
      if (current !== null && Number(current) > 0) {
        await redisClient.decr(redisKey);
      }
    } catch (err) {
      console.error('[RateLimit] Redis decrement failed:', err);
    }
  }

  async resetKey(key: string): Promise<void> {
    const redisKey = `${this.prefix}:${key}`;
    try {
      await redisClient.del(redisKey);
    } catch (err) {
      console.error('[RateLimit] Redis resetKey failed:', err);
    }
  }
}

// ── Shared handler that includes Retry-After header in rate-limit responses ──
const rateLimitHandler: RateLimitExceededEventHandler = (_req, res) => {
  const retryAfterSeconds = Math.ceil(
    (Number(res.getHeader('RateLimit-Reset')) || 60)
  );
  res.setHeader('Retry-After', String(retryAfterSeconds));
  res.status(429).json({
    error: {
      code: 'M_RATE_LIMITED',
      message: 'Rate limit exceeded. Try again later.',
      retryAfterMs: retryAfterSeconds * 1000,
    },
  });
};

// ── Rate limiters ──

// Login: 20 attempts per 15 minutes per IP+username combo
// Using IP + username as key prevents credential stuffing against a single account
// while still allowing multiple users behind the same IP
const loginWindowMs = 15 * 60 * 1000;
export const loginLimiter = rateLimit({
  windowMs: loginWindowMs,
  max: 20,
  store: new RedisStore('ratelimit:login', loginWindowMs) as unknown as Store,
  keyGenerator: (req: Request) => {
    const username = (req.body as Record<string, unknown>)?.username;
    const usernameKey = typeof username === 'string' ? username.toLowerCase() : 'unknown';
    return `${String(req.ip)}:${usernameKey}`;
  },
  handler: rateLimitHandler,
  standardHeaders: true,
  legacyHeaders: false,
});

// Registration: 15 attempts per hour per IP
const registerWindowMs = 60 * 60 * 1000;
export const registerLimiter = rateLimit({
  windowMs: registerWindowMs,
  max: 15,
  store: new RedisStore('ratelimit:register', registerWindowMs) as unknown as Store,
  handler: rateLimitHandler,
  standardHeaders: true,
  legacyHeaders: false,
});

// General API: 600 requests per minute per authenticated user (or IP for unauthenticated).
// This limiter covers user-facing operations like rooms, devices, profile, etc.
// High-frequency endpoints (sync, key upload) have their own dedicated limiters.
const apiWindowMs = 60 * 1000;
export const apiLimiter = rateLimit({
  windowMs: apiWindowMs,
  max: 600,
  store: new RedisStore('ratelimit:api', apiWindowMs) as unknown as Store,
  keyGenerator: (req: Request) => {
    // Prefer per-user limiting so users behind shared IPs (NAT/VPN) aren't penalised
    return req.auth?.sub ?? String(req.ip);
  },
  handler: rateLimitHandler,
  standardHeaders: true,
  legacyHeaders: false,
});

// Sync polling: 1200 requests per minute per user.
// Clients long-poll /messages/sync every 1-5 seconds — this must be very generous.
// At 1 req/sec that's 60/min, but burst reconnects can spike much higher.
const syncWindowMs = 60 * 1000;
export const syncLimiter = rateLimit({
  windowMs: syncWindowMs,
  max: 1200,
  store: new RedisStore('ratelimit:sync', syncWindowMs) as unknown as Store,
  keyGenerator: (req: Request) => {
    return req.auth?.sub ?? String(req.ip);
  },
  handler: rateLimitHandler,
  standardHeaders: true,
  legacyHeaders: false,
});

// Key upload: 600 requests per minute per user.
// OlmMachine uploads device_keys and one_time_keys frequently, especially
// after session creation and when OTK counts run low.
const keyUploadWindowMs = 60 * 1000;
export const keyUploadLimiter = rateLimit({
  windowMs: keyUploadWindowMs,
  max: 600,
  store: new RedisStore('ratelimit:keyupload', keyUploadWindowMs) as unknown as Store,
  keyGenerator: (req: Request) => {
    return req.auth?.sub ?? String(req.ip);
  },
  handler: rateLimitHandler,
  standardHeaders: true,
  legacyHeaders: false,
});

// Key query/claim: 300 requests per minute per user.
// Called during session setup and when verifying devices.
const keyQueryWindowMs = 60 * 1000;
export const keyQueryLimiter = rateLimit({
  windowMs: keyQueryWindowMs,
  max: 300,
  store: new RedisStore('ratelimit:keyquery', keyQueryWindowMs) as unknown as Store,
  keyGenerator: (req: Request) => {
    return req.auth?.sub ?? String(req.ip);
  },
  handler: rateLimitHandler,
  standardHeaders: true,
  legacyHeaders: false,
});

// Token refresh: 30 requests per minute per IP
const refreshWindowMs = 60 * 1000;
export const refreshLimiter = rateLimit({
  windowMs: refreshWindowMs,
  max: 30,
  store: new RedisStore('ratelimit:refresh', refreshWindowMs) as unknown as Store,
  handler: rateLimitHandler,
  standardHeaders: true,
  legacyHeaders: false,
});

// Message sending: 300 per minute per user (~5 msg/sec burst capacity)
// Chat apps generate lots of messages — groups, rapid replies, reactions.
const messageWindowMs = 60 * 1000;
export const messageLimiter = rateLimit({
  windowMs: messageWindowMs,
  max: 300,
  store: new RedisStore('ratelimit:message', messageWindowMs) as unknown as Store,
  keyGenerator: (req: Request) => {
    return req.auth?.sub ?? String(req.ip);
  },
  handler: rateLimitHandler,
  standardHeaders: true,
  legacyHeaders: false,
});
