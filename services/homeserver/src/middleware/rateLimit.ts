import rateLimit from 'express-rate-limit';
import type { Request } from 'express';

// Login: 20 attempts per 15 minutes per IP+username combo
// Using IP + username as key prevents credential stuffing against a single account
// while still allowing multiple users behind the same IP
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyGenerator: (req: Request) => {
    const username = (req.body as Record<string, unknown>)?.username;
    const usernameKey = typeof username === 'string' ? username.toLowerCase() : 'unknown';
    return `${req.ip}:${usernameKey}`;
  },
  message: {
    error: { code: 'M_RATE_LIMITED', message: 'Too many login attempts. Try again later.' },
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Registration: 15 attempts per hour per IP
export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 15,
  message: {
    error: { code: 'M_RATE_LIMITED', message: 'Too many registration attempts. Try again later.' },
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// General API: 300 requests per minute per IP (100 users × ~3 req each)
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  message: {
    error: { code: 'M_RATE_LIMITED', message: 'Rate limit exceeded. Try again later.' },
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Token refresh: 30 requests per minute per IP
export const refreshLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: {
    error: { code: 'M_RATE_LIMITED', message: 'Too many refresh attempts. Try again later.' },
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Message sending: 120 per minute per IP
export const messageLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: {
    error: { code: 'M_RATE_LIMITED', message: 'Message rate limit exceeded.' },
  },
  standardHeaders: true,
  legacyHeaders: false,
});
