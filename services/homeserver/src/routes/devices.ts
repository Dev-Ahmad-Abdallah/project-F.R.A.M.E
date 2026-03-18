import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { apiLimiter } from '../middleware/rateLimit';
import { asyncHandler } from '../middleware/errorHandler';
import { validateBody, deviceRegisterSchema } from '../middleware/validation';
import { registerDevice, listDevices, removeDevice, heartbeat } from '../services/deviceService';

export const devicesRouter = Router();

// POST /devices/register — Register new device public key
devicesRouter.post(
  '/register',
  requireAuth,
  apiLimiter,
  validateBody(deviceRegisterSchema),
  asyncHandler(async (req, res) => {
    const result = await registerDevice(
      req.auth!.sub,
      req.body.deviceId,
      req.body.devicePublicKey,
      req.body.deviceSigningKey,
      req.body.deviceDisplayName
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
    const result = await listDevices(req.params.userId);
    res.json(result);
  })
);

// DELETE /devices/:deviceId — Remove/revoke a device
devicesRouter.delete(
  '/:deviceId',
  requireAuth,
  apiLimiter,
  asyncHandler(async (req, res) => {
    const result = await removeDevice(req.params.deviceId, req.auth!.sub);
    res.json(result);
  })
);

// POST /devices/heartbeat — Update device last-seen
devicesRouter.post(
  '/heartbeat',
  requireAuth,
  asyncHandler(async (req, res) => {
    await heartbeat(req.auth!.deviceId);
    res.json({ ok: true });
  })
);
