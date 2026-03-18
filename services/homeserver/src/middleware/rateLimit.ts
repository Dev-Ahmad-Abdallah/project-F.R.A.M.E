import rateLimit from 'express-rate-limit';

// Login: 20 attempts per 15 minutes per IP (supports 100 users behind shared IP)
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
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
