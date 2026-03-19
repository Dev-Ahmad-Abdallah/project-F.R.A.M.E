import { Router } from 'express';
import { asyncHandler, ApiError } from '../middleware/errorHandler';
import { loginLimiter, registerLimiter, apiLimiter, refreshLimiter } from '../middleware/rateLimit';
import { validateBody } from '../middleware/validation';
import { registerSchema, loginSchema, refreshSchema, profileUpdateSchema, statusUpdateSchema } from '../middleware/validation';
import { requireAuth } from '../middleware/auth';
import { register, login, refreshAccessToken, revokeAllTokens } from '../services/authService';
import { updateDisplayName, findUserById } from '../db/queries/users';
import { redisClient } from '../redis/client';
import type { RegisterParams, LoginParams } from '../services/authService';

export const authRouter = Router();

// POST /auth/register — Register new user + upload initial public keys
authRouter.post(
  '/register',
  registerLimiter,
  validateBody(registerSchema),
  asyncHandler(async (req, res) => {
    const result = await register(req.body as RegisterParams);
    res.status(201).json(result);
  })
);

// POST /auth/login — Authenticate, receive JWT
authRouter.post(
  '/login',
  loginLimiter,
  validateBody(loginSchema),
  asyncHandler(async (req, res) => {
    const result = await login(req.body as LoginParams);
    res.json(result);
  })
);

// POST /auth/logout — Invalidate all refresh tokens server-side
authRouter.post(
  '/logout',
  requireAuth,
  apiLimiter,
  asyncHandler(async (req, res) => {
    if (!req.auth) {
      res.status(401).json({ error: { code: 'M_UNAUTHORIZED', message: 'Not authenticated' } });
      return;
    }
    await revokeAllTokens(req.auth.sub);
    res.json({ success: true });
  })
);

// POST /auth/refresh — Refresh access token (dedicated limiter — Security Finding 6)
authRouter.post(
  '/refresh',
  refreshLimiter,
  validateBody(refreshSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as { refreshToken: string };
    const result = await refreshAccessToken(body.refreshToken);
    res.json(result);
  })
);

// PUT /auth/profile — Update user display name
authRouter.put(
  '/profile',
  requireAuth,
  apiLimiter,
  validateBody(profileUpdateSchema),
  asyncHandler(async (req, res) => {
    if (!req.auth) {
      throw new ApiError(401, 'M_UNAUTHORIZED', 'Not authenticated');
    }
    const { displayName } = req.body as { displayName: string };
    const user = await updateDisplayName(req.auth.sub, displayName);
    res.json({
      userId: user.user_id,
      displayName: user.display_name,
    });
  })
);

// GET /auth/profile — Get own profile info
authRouter.get(
  '/profile',
  requireAuth,
  apiLimiter,
  asyncHandler(async (req, res) => {
    if (!req.auth) {
      throw new ApiError(401, 'M_UNAUTHORIZED', 'Not authenticated');
    }
    const user = await findUserById(req.auth.sub);
    if (!user) {
      throw new ApiError(404, 'M_NOT_FOUND', 'User not found');
    }

    // Fetch ephemeral status from Redis
    const statusData = await redisClient.get(`status:${req.auth.sub}`);
    const parsed = statusData ? JSON.parse(statusData) as { status: string; statusMessage?: string } : null;

    res.json({
      userId: user.user_id,
      username: user.username,
      displayName: user.display_name,
      homeserver: user.homeserver,
      status: parsed?.status ?? 'online',
      statusMessage: parsed?.statusMessage ?? null,
    });
  })
);

// PUT /auth/status — Update user presence status
authRouter.put(
  '/status',
  requireAuth,
  apiLimiter,
  validateBody(statusUpdateSchema),
  asyncHandler(async (req, res) => {
    if (!req.auth) {
      throw new ApiError(401, 'M_UNAUTHORIZED', 'Not authenticated');
    }
    const { status, statusMessage } = req.body as { status: string; statusMessage?: string };

    // Store ephemeral status in Redis with 5-minute TTL (auto-expires to offline)
    const value = JSON.stringify({ status, statusMessage: statusMessage || null });
    if (status === 'offline') {
      await redisClient.del(`status:${req.auth.sub}`);
    } else {
      await redisClient.set(`status:${req.auth.sub}`, value, 'EX', 300);
    }

    res.json({ status, statusMessage: statusMessage || null });
  })
);

// GET /auth/status/:userId — Get another user's status
authRouter.get(
  '/status/:userId',
  requireAuth,
  apiLimiter,
  asyncHandler(async (req, res) => {
    if (!req.auth) {
      throw new ApiError(401, 'M_UNAUTHORIZED', 'Not authenticated');
    }
    const { userId } = req.params;
    const statusData = await redisClient.get(`status:${userId}`);
    const parsed = statusData ? JSON.parse(statusData) as { status: string; statusMessage?: string } : null;

    res.json({
      userId,
      status: parsed?.status ?? 'offline',
      statusMessage: parsed?.statusMessage ?? null,
    });
  })
);
