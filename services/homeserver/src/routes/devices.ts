import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { apiLimiter } from '../middleware/rateLimit';
import { asyncHandler } from '../middleware/errorHandler';
import { validateBody, deviceRegisterSchema } from '../middleware/validation';
import { registerDevice, listDevices, removeDevice, heartbeat } from '../services/deviceService';
import { usersShareRoom } from '../db/queries/rooms';
import { ApiError } from '../middleware/errorHandler';

export const devicesRouter = Router();

// POST /devices/register — Register new device public key
devicesRouter.post(
  '/register',
  requireAuth,
  apiLimiter,
  validateBody(deviceRegisterSchema),
  asyncHandler(async (req, res) => {
    if (!req.auth) {
      throw new ApiError(401, 'M_UNAUTHORIZED', 'Not authenticated');
    }
    const body = req.body as {
      deviceId: string;
      devicePublicKey: string;
      deviceSigningKey: string;
      deviceDisplayName?: string;
    };
    const result = await registerDevice(
      req.auth.sub,
      body.deviceId,
      body.devicePublicKey,
      body.deviceSigningKey,
      body.deviceDisplayName
    );
    res.status(201).json(result);
  })
);

// GET /devices/:userId — List all devices for a user
devicesRouter.get(
  '/:userId',
  requireAuth,
  apiLimiter,
  asyncHandler(async (req, res) => {
    if (!req.auth) {
      throw new ApiError(401, 'M_UNAUTHORIZED', 'Not authenticated');
    }
    const requestingUserId = req.auth.sub;
    const targetUserId = req.params.userId;

    // Users can only list their own devices or devices of users they share a room with
    if (requestingUserId !== targetUserId) {
      const shared = await usersShareRoom(requestingUserId, targetUserId);
      if (!shared) {
        throw new ApiError(403, 'M_FORBIDDEN', 'You can only view devices of users you share a room with');
      }
    }

    const result = await listDevices(targetUserId);
    res.json(result);
  })
);

// DELETE /devices/:deviceId — Remove/revoke a device
devicesRouter.delete(
  '/:deviceId',
  requireAuth,
  apiLimiter,
  asyncHandler(async (req, res) => {
    if (!req.auth) {
      throw new ApiError(401, 'M_UNAUTHORIZED', 'Not authenticated');
    }
    const result = await removeDevice(req.params.deviceId, req.auth.sub);
    res.json(result);
  })
);

// POST /devices/heartbeat — Update device last-seen
devicesRouter.post(
  '/heartbeat',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!req.auth) {
      throw new ApiError(401, 'M_UNAUTHORIZED', 'Not authenticated');
    }
    await heartbeat(req.auth.deviceId);
    res.json({ ok: true });
  })
);
