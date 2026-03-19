import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { apiLimiter } from '../middleware/rateLimit';
import { asyncHandler } from '../middleware/errorHandler';
import { validateBody, keyUploadSchema, keysQuerySchema, keysClaimSchema } from '../middleware/validation';
import { fetchKeyBundle, uploadPrekeys, getKeyCount, queryDeviceKeys, claimKeys } from '../services/keyService';
import { getProofForUser } from '../services/merkleTree';

export const keysRouter = Router();

// POST /keys/upload — Upload one-time prekeys
keysRouter.post(
  '/upload',
  requireAuth,
  apiLimiter,
  validateBody(keyUploadSchema),
  asyncHandler(async (req, res) => {
    const result = await uploadPrekeys(
      req.auth!.sub,
      req.auth!.deviceId,
      req.body.oneTimePrekeys,
      req.body.signedPrekey,
      req.body.signedPrekeySig
    );
    res.json(result);
  })
);

// POST /keys/query — Query device keys for users (required by vodozemac OlmMachine)
keysRouter.post(
  '/query',
  requireAuth,
  apiLimiter,
  validateBody(keysQuerySchema),
  asyncHandler(async (req, res) => {
    const userIds: string[] = req.body.device_keys ? Object.keys(req.body.device_keys) : [];
    const result = await queryDeviceKeys(userIds);
    res.json(result);
  })
);

// POST /keys/claim — Claim one-time keys for devices (required by vodozemac OlmMachine)
keysRouter.post(
  '/claim',
  requireAuth,
  apiLimiter,
  validateBody(keysClaimSchema),
  asyncHandler(async (req, res) => {
    const result = await claimKeys(req.body.one_time_keys);
    res.json(result);
  })
);

// GET /keys/count — Get remaining OTK count for own device
keysRouter.get(
  '/count',
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await getKeyCount(req.auth!.sub, req.auth!.deviceId);
    res.json(result);
  })
);

// GET /keys/:userId — Fetch user's key bundle (claims one OTK)
keysRouter.get(
  '/:userId',
  requireAuth,
  apiLimiter,
  asyncHandler(async (req, res) => {
    const result = await fetchKeyBundle(req.params.userId);
    res.json(result);
  })
);

// GET /keys/transparency/:userId — Fetch Merkle proof
keysRouter.get(
  '/transparency/:userId',
  requireAuth,
  apiLimiter,
  asyncHandler(async (req, res) => {
    const proof = await getProofForUser(req.params.userId);
    if (!proof) {
      res.status(404).json({
        error: { code: 'M_NOT_FOUND', message: 'No transparency log entry found for user' },
      });
      return;
    }
    res.json(proof);
  })
);
