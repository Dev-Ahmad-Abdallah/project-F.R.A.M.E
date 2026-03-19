import rateLimit, { type Store, type IncrementResponse, type Options } from 'express-rate-limit';
import type { Request } from 'express';
import { redisClient } from '../redis/client';

// ── Redis-backed rate limit store ──
//
// Uses Redis INCR + PEXPIRE so that rate-limit counters survive server
// restarts and are shared across multiple homeserver instances.
// Falls back gracefully: if Redis is unavailable, the increment call
// resolves with totalHits=0 which effectively disables limiting rather
// than blocking requests.

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
      const results = await redisClient
        .multi()
        .incr(redisKey)
        .pexpire(redisKey, this._windowMs)
        .exec();

      // ioredis multi().exec() returns [[err, result], ...] | null
      const totalHits = results?.[0]?.[1] as number ?? 0;
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
  message: {
    error: { code: 'M_RATE_LIMITED', message: 'Too many login attempts. Try again later.' },
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Registration: 15 attempts per hour per IP
const registerWindowMs = 60 * 60 * 1000;
export const registerLimiter = rateLimit({
  windowMs: registerWindowMs,
  max: 15,
  store: new RedisStore('ratelimit:register', registerWindowMs) as unknown as Store,
  message: {
    error: { code: 'M_RATE_LIMITED', message: 'Too many registration attempts. Try again later.' },
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// General API: 300 requests per minute per IP (100 users × ~3 req each)
const apiWindowMs = 60 * 1000;
export const apiLimiter = rateLimit({
  windowMs: apiWindowMs,
  max: 300,
  store: new RedisStore('ratelimit:api', apiWindowMs) as unknown as Store,
  message: {
    error: { code: 'M_RATE_LIMITED', message: 'Rate limit exceeded. Try again later.' },
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Token refresh: 30 requests per minute per IP
const refreshWindowMs = 60 * 1000;
export const refreshLimiter = rateLimit({
  windowMs: refreshWindowMs,
  max: 30,
  store: new RedisStore('ratelimit:refresh', refreshWindowMs) as unknown as Store,
  message: {
    error: { code: 'M_RATE_LIMITED', message: 'Too many refresh attempts. Try again later.' },
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Message sending: 120 per minute per IP
const messageWindowMs = 60 * 1000;
export const messageLimiter = rateLimit({
  windowMs: messageWindowMs,
  max: 120,
  store: new RedisStore('ratelimit:message', messageWindowMs) as unknown as Store,
  message: {
    error: { code: 'M_RATE_LIMITED', message: 'Message rate limit exceeded.' },
  },
  standardHeaders: true,
  legacyHeaders: false,
});
