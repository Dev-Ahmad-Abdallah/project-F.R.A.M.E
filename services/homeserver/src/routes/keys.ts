import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { apiLimiter } from '../middleware/rateLimit';
import { asyncHandler, ApiError } from '../middleware/errorHandler';
import { validateBody, keyUploadSchema, keysQuerySchema, keysClaimSchema } from '../middleware/validation';
import crypto from 'crypto';
import { fetchKeyBundle, uploadPrekeys, getKeyCount, queryDeviceKeys, claimKeys, revokeDeviceKeys } from '../services/keyService';
import { canonicalJson } from '../services/federationService';
import { getProofForUser } from '../services/merkleTree';
import { updateDevice, updateDeviceKeysJson } from '../db/queries/devices';
import { upsertKeyBundle, addOneTimePrekeys } from '../db/queries/keys';

export const keysRouter = Router();

// Prevent proxy caching of sensitive key material on all key endpoints
keysRouter.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

interface DeviceKeysPayload {
  keys?: Record<string, string>;
  signatures?: Record<string, Record<string, string>>;
  unsigned?: Record<string, unknown>;
  [key: string]: unknown;
}

interface KeyUploadBody {
  device_keys?: DeviceKeysPayload;
  one_time_keys?: Record<string, unknown>;
  oneTimePrekeys?: string[];
  signedPrekey?: string;
  signedPrekeySig?: string;
}

interface KeysQueryBody {
  device_keys?: Record<string, string[] | Record<string, string>>;
}

interface KeysClaimBody {
  one_time_keys: Record<string, Record<string, string>>;
}

// POST /keys/upload — Upload one-time prekeys
keysRouter.post(
  '/upload',
  requireAuth,
  apiLimiter,
  validateBody(keyUploadSchema),
  asyncHandler(async (req, res) => {
    if (!req.auth) {
      throw new ApiError(401, 'M_UNAUTHORIZED', 'Not authenticated');
    }
    const userId = req.auth.sub;
    const deviceId = req.auth.deviceId;
    const body = req.body as KeyUploadBody;

    // If device_keys is included (OlmMachine KeysUploadRequest),
    // update the device's public keys and ensure key_bundle exists
    if (body.device_keys) {
      const dk = body.device_keys;
      const keys = dk.keys ?? {};
      const curve25519Key = keys[`curve25519:${deviceId}`];
      const ed25519Key = keys[`ed25519:${deviceId}`];

      // ── Signature verification (Fix: reject unsigned device_keys) ──
      const signatures = dk.signatures;
      if (!signatures || Object.keys(signatures).length === 0) {
        throw new ApiError(400, 'M_MISSING_PARAM', 'device_keys must include signatures');
      }

      // Verify the Ed25519 self-signature if we have the signing key
      if (ed25519Key) {
        const sigKeyLabel = `ed25519:${deviceId}`;
        const sigMap = new Map(Object.entries(signatures));
        const userSigsEntry = sigMap.get(userId);
        const userSigsMap = userSigsEntry ? new Map(Object.entries(userSigsEntry)) : undefined;
        const signatureBase64 = userSigsMap?.get(sigKeyLabel);
        if (!signatureBase64) {
          throw new ApiError(400, 'M_MISSING_PARAM', `device_keys missing signature for ${sigKeyLabel}`);
        }

        // Build the signing payload: device_keys without signatures and unsigned fields
        const dkRecord = dk as Record<string, unknown>;
        const signable = Object.fromEntries(
          Object.entries(dkRecord).filter(([key]) => key !== 'signatures' && key !== 'unsigned')
        );
        const payload = canonicalJson(signable);

        // Ed25519 key from OlmMachine is base64-encoded raw 32-byte public key
        const edKeyBytes = Buffer.from(ed25519Key, 'base64');
        // Wrap raw 32-byte Ed25519 public key in SPKI DER envelope
        const spkiPrefix = Buffer.from('302a300506032b6570032100', 'hex');
        const spkiDer = Buffer.concat([spkiPrefix, edKeyBytes]);
        const publicKeyObj = crypto.createPublicKey({ key: spkiDer, format: 'der', type: 'spki' });

        // Decode the unpadded-base64 signature (Matrix uses unpadded base64)
        const sigBytes = Buffer.from(signatureBase64, 'base64');
        const valid = crypto.verify(null, Buffer.from(payload), publicKeyObj, sigBytes);
        if (!valid) {
          throw new ApiError(400, 'M_UNKNOWN', 'device_keys Ed25519 signature verification failed');
        }
      }

      if (curve25519Key && ed25519Key) {
        await updateDevice(deviceId, curve25519Key, ed25519Key);
        // Store the full signed device_keys JSON so /keys/query preserves signatures
        await updateDeviceKeysJson(deviceId, dk);
        // Ensure a key_bundle row exists for this device
        await upsertKeyBundle(userId, deviceId, curve25519Key, '', '', []);
      }
    }

    // Process OlmMachine-format one_time_keys (signed objects keyed by algorithm:id)
    if (body.one_time_keys && typeof body.one_time_keys === 'object') {
      const otkEntries = Object.entries(body.one_time_keys);
      if (otkEntries.length > 0) {
        const otkValues = otkEntries.map(([, v]) => JSON.stringify(v));
        await addOneTimePrekeys(userId, deviceId, otkValues);
      }
    }

    const result = await uploadPrekeys(
      userId,
      deviceId,
      body.oneTimePrekeys ?? [],
      body.signedPrekey,
      body.signedPrekeySig
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
    const body = req.body as KeysQueryBody;
    const userIds: string[] = body.device_keys ? Object.keys(body.device_keys) : [];
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
    const body = req.body as KeysClaimBody;
    const result = await claimKeys(body.one_time_keys);
    res.json(result);
  })
);

// GET /keys/count — Get remaining OTK count for own device
keysRouter.get(
  '/count',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!req.auth) {
      throw new ApiError(401, 'M_UNAUTHORIZED', 'Not authenticated');
    }
    const result = await getKeyCount(req.auth.sub, req.auth.deviceId);
    res.json(result);
  })
);

// POST /keys/revoke — Revoke all keys for a device (marks as revoked + deletes key bundle)
keysRouter.post(
  '/revoke',
  requireAuth,
  apiLimiter,
  asyncHandler(async (req, res) => {
    if (!req.auth) {
      throw new ApiError(401, 'M_UNAUTHORIZED', 'Not authenticated');
    }
    const { deviceId } = req.body as { deviceId?: string };
    if (!deviceId || typeof deviceId !== 'string') {
      throw new ApiError(400, 'M_BAD_JSON', 'Missing or invalid deviceId in request body');
    }
    const result = await revokeDeviceKeys(req.auth.sub, deviceId);
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
