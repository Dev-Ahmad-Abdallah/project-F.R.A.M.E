import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { loginLimiter, registerLimiter, apiLimiter } from '../middleware/rateLimit';
import { validateBody } from '../middleware/validation';
import { registerSchema, loginSchema, refreshSchema } from '../middleware/validation';
import { register, login, refreshAccessToken } from '../services/authService';

export const authRouter = Router();

// POST /auth/register — Register new user + upload initial public keys
authRouter.post(
  '/register',
  registerLimiter,
  validateBody(registerSchema),
  asyncHandler(async (req, res) => {
    const result = await register(req.body);
    res.status(201).json(result);
  })
);

// POST /auth/login — Authenticate, receive JWT
authRouter.post(
  '/login',
  loginLimiter,
  validateBody(loginSchema),
  asyncHandler(async (req, res) => {
    const result = await login(req.body);
    res.json(result);
  })
);

// POST /auth/refresh — Refresh access token (rate limited — Security Finding 6)
authRouter.post(
  '/refresh',
  apiLimiter,
  validateBody(refreshSchema),
  asyncHandler(async (req, res) => {
    const result = await refreshAccessToken(req.body.refreshToken);
    res.json(result);
  })
);
