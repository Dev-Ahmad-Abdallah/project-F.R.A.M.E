import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, ApiError } from '../middleware/errorHandler';
import { requireAuth } from '../middleware/auth';
import { apiLimiter } from '../middleware/rateLimit';
import { validateBody } from '../middleware/validation';
import { getConfig } from '../config';
import { pool } from '../db/pool';

export const pushRouter = Router();

// ── Zod schema for push subscription ──
const pushSubscribeSchema = z.object({
  endpoint: z.string().url().min(1),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

// GET /push/vapid-key — returns the server's VAPID public key
pushRouter.get(
  '/vapid-key',
  requireAuth,
  apiLimiter,
  // eslint-disable-next-line @typescript-eslint/require-await
  asyncHandler(async (_req, res) => {
    const config = getConfig();
    const publicKey = config.VAPID_PUBLIC_KEY;

    if (!publicKey) {
      throw new ApiError(503, 'M_NOT_CONFIGURED', 'Push notifications are not configured on this server');
    }

    res.json({ publicKey });
  }),
);

// POST /push/subscribe — stores a push subscription for the authenticated user's device
pushRouter.post(
  '/subscribe',
  requireAuth,
  apiLimiter,
  validateBody(pushSubscribeSchema),
  asyncHandler(async (req, res) => {
    if (!req.auth) {
      throw new ApiError(401, 'M_UNAUTHORIZED', 'Not authenticated');
    }

    const { endpoint, keys } = req.body as z.infer<typeof pushSubscribeSchema>;
    const { sub: userId, deviceId } = req.auth;

    // Upsert: if the user+device already has a subscription, update it
    await pool.query(
      `INSERT INTO push_subscriptions (user_id, device_id, endpoint, p256dh, auth)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, device_id)
       DO UPDATE SET endpoint = $3, p256dh = $4, auth = $5, created_at = NOW()`,
      [userId, deviceId, endpoint, keys.p256dh, keys.auth],
    );

    res.status(201).json({ success: true });
  }),
);

// DELETE /push/unsubscribe — removes a push subscription for the authenticated user's device
pushRouter.delete(
  '/unsubscribe',
  requireAuth,
  apiLimiter,
  asyncHandler(async (req, res) => {
    if (!req.auth) {
      throw new ApiError(401, 'M_UNAUTHORIZED', 'Not authenticated');
    }

    const { sub: userId, deviceId } = req.auth;

    const result = await pool.query(
      'DELETE FROM push_subscriptions WHERE user_id = $1 AND device_id = $2',
      [userId, deviceId],
    );

    if (result.rowCount === 0) {
      throw new ApiError(404, 'M_NOT_FOUND', 'No push subscription found for this device');
    }

    res.json({ success: true });
  }),
);
