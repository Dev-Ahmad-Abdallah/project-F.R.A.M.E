import rateLimit from 'express-rate-limit';

// Login: 5 attempts per 15 minutes per IP
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: {
    error: { code: 'M_RATE_LIMITED', message: 'Too many login attempts. Try again later.' },
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Registration: 3 attempts per hour per IP
export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: {
    error: { code: 'M_RATE_LIMITED', message: 'Too many registration attempts. Try again later.' },
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// General API: 60 requests per minute per IP
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: {
    error: { code: 'M_RATE_LIMITED', message: 'Rate limit exceeded. Try again later.' },
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Message sending: 30 per minute per IP
export const messageLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: {
    error: { code: 'M_RATE_LIMITED', message: 'Message rate limit exceeded.' },
  },
  standardHeaders: true,
  legacyHeaders: false,
});
