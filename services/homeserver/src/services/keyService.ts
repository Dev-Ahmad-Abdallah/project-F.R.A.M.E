import { getKeyBundle, claimOneTimePrekey, addOneTimePrekeys, getOtkCount, deleteKeyBundle } from '../db/queries/keys';
import { pool } from '../db/pool';
import { ApiError } from '../middleware/errorHandler';
import crypto from 'crypto';

export async function fetchKeyBundle(userId: string) {
  const bundle = await getKeyBundle(userId);
  if (!bundle) {
    throw new ApiError(404, 'M_NOT_FOUND', 'No key bundle found for user');
  }

  // Claim one OTK (consumed — removed from pool)
  const claimedOtk = await claimOneTimePrekey(userId, bundle.device_id);

  const result: Record<string, unknown> = {
    userId: bundle.user_id,
    deviceId: bundle.device_id,
    identityKey: bundle.identity_key,
    signedPrekey: bundle.signed_prekey,
    signedPrekeySig: bundle.signed_prekey_signature,
    oneTimePrekey: claimedOtk,
  };

  // Warn when no OTK was available — the device needs to upload more
  if (claimedOtk === null) {
    result.otk_warning = 'NO_OTK_AVAILABLE';
  }

  return result;
}

export async function uploadPrekeys(
  userId: string,
  deviceId: string,
  oneTimePrekeys: string[],
  signedPrekey?: string,
  signedPrekeySig?: string
) {
  // Update signed prekey if provided
  if (signedPrekey && signedPrekeySig) {
    await pool.query(
      `UPDATE key_bundles SET signed_prekey = $1, signed_prekey_signature = $2
       WHERE user_id = $3 AND device_id = $4`,
      [signedPrekey, signedPrekeySig, userId, deviceId]
    );
  }

  const totalKeys = await addOneTimePrekeys(userId, deviceId, oneTimePrekeys ?? []);

  return {
    oneTimeKeyCount: totalKeys,
    one_time_key_counts: {
      signed_curve25519: totalKeys,
    },
  };
}

export async function getKeyCount(userId: string, deviceId: string) {
  const count = await getOtkCount(userId, deviceId);
  return { oneTimeKeyCount: count };
}

interface DeviceKeyRow {
  user_id: string;
  device_id: string;
  device_signing_key: string;
  device_keys_json: Record<string, unknown> | null;
  identity_key: string;
  signed_prekey: string;
  signed_prekey_signature: string;
}

// Query device keys for multiple users (required by vodozemac KeysQueryRequest)
// Single batch query instead of N+1 per user/device
export async function queryDeviceKeys(userIds: string[]) {
  if (userIds.length === 0) return { device_keys: {} };

  const result = await pool.query<DeviceKeyRow>(
    `SELECT d.user_id, d.device_id, d.device_signing_key, d.device_keys_json,
            kb.identity_key, kb.signed_prekey, kb.signed_prekey_signature
     FROM devices d
     JOIN key_bundles kb ON d.user_id = kb.user_id AND d.device_id = kb.device_id
     WHERE d.user_id = ANY($1::text[])
       AND d.device_public_key != 'pending'
       AND d.device_signing_key != 'pending'`,
    [userIds]
  );

  // SERVER-ENFORCED KEY TRANSPARENCY: Only serve device keys that have a
  // corresponding entry in the key_transparency_log. This prevents the server
  // from silently injecting rogue devices — every key MUST be auditable in the
  // append-only transparency log before clients ever see it.
  const identityKeys = result.rows
    .map((r) => r.identity_key)
    .filter(Boolean);

  const transparentKeys = new Set<string>();
  if (identityKeys.length > 0) {
    const logResult = await pool.query<{ key_hash: string }>(
      `SELECT DISTINCT key_hash FROM key_transparency_log
       WHERE user_id = ANY($1::text[])`,
      [userIds],
    );
    for (const logRow of logResult.rows) {
      transparentKeys.add(logRow.key_hash);
    }
  }

  const deviceKeys = new Map<string, Map<string, unknown>>();

  for (const row of result.rows) {
    // Verify this device's identity key has a transparency log entry.
    // The log stores SHA-256(identityKey), matching addKeyToLog() in merkleTree.ts.
    if (row.identity_key) {
      const keyHash = crypto
        .createHash('sha256')
        .update(row.identity_key)
        .digest('hex');
      if (!transparentKeys.has(keyHash)) {
        // Exclude device — its key has no transparency proof. This blocks
        // rogue device injection that bypasses the transparency log.
        continue;
      }
    }

    if (!deviceKeys.has(row.user_id)) deviceKeys.set(row.user_id, new Map<string, unknown>());
    const userDevices = deviceKeys.get(row.user_id);
    if (row.device_keys_json) {
      // Use the stored signed device_keys JSON directly (preserves signatures)
      userDevices?.set(row.device_id, row.device_keys_json);
    } else if (row.identity_key && row.device_signing_key) {
      // Fallback: reconstruct unsigned device_keys from individual columns
      const curveKey = `curve25519:${row.device_id}`;
      const edKey = `ed25519:${row.device_id}`;
      userDevices?.set(row.device_id, {
        user_id: row.user_id,
        device_id: row.device_id,
        algorithms: ['m.olm.v1.curve25519-aes-sha2', 'm.megolm.v1.aes-sha2'],
        keys: {
          [curveKey]: row.identity_key,
          [edKey]: row.device_signing_key,
        },
      });
    }
  }

  // Ensure all requested users have an entry (even if empty)
  for (const userId of userIds) {
    if (!deviceKeys.has(userId)) {
      deviceKeys.set(userId, new Map<string, unknown>());
    }
  }

  // Convert Maps to plain objects for JSON response
  const deviceKeysObj: Record<string, Record<string, unknown>> = Object.fromEntries(
    Array.from(deviceKeys.entries()).map(([userId, devicesMap]) => [
      userId,
      Object.fromEntries(Array.from(devicesMap.entries())),
    ])
  );

  return { device_keys: deviceKeysObj };
}

// Low OTK threshold — if a device's remaining OTK count drops below this,
// include a warning so the client can replenish proactively.
const LOW_OTK_THRESHOLD = 10;

// Claim one-time keys for devices (required by vodozemac KeysClaimRequest)
export async function claimKeys(
  oneTimeKeys: Record<string, Record<string, string>>
) {
  const claimedKeys = new Map<string, Map<string, unknown>>();
  const lowOtkDevices: Array<{ userId: string; deviceId: string; remaining: number }> = [];

  for (const [userId, devices] of Object.entries(oneTimeKeys)) {
    claimedKeys.set(userId, new Map<string, unknown>());

    for (const [deviceId] of Object.entries(devices)) {
      const claimed = await claimOneTimePrekey(userId, deviceId);
      if (claimed) {
        // OTKs may be stored as JSON strings — parse if needed
        let parsedOtk: unknown = claimed;
        if (typeof claimed === 'string') {
          try { parsedOtk = JSON.parse(claimed) as unknown; } catch { /* use as-is */ }
        }
        const keyName = `signed_curve25519:${deviceId}`;
        claimedKeys.get(userId)?.set(deviceId, {
          [keyName]: parsedOtk,
        });

        // Check remaining OTK count after claiming
        const remaining = await getOtkCount(userId, deviceId);
        if (remaining < LOW_OTK_THRESHOLD) {
          lowOtkDevices.push({ userId, deviceId, remaining });
        }
      }
    }
  }

  // Convert Maps to plain objects for JSON response
  const claimedKeysObj: Record<string, Record<string, unknown>> = Object.fromEntries(
    Array.from(claimedKeys.entries()).map(([userId, devicesMap]) => [
      userId,
      Object.fromEntries(Array.from(devicesMap.entries())),
    ])
  );

  const result: Record<string, unknown> = { one_time_keys: claimedKeysObj };

  // Include low OTK warning so claiming clients can notify device owners
  if (lowOtkDevices.length > 0) {
    result.low_otk_warning = lowOtkDevices;
  }

  return result;
}

/**
 * Revoke all keys for a specific device.
 *
 * This marks the device's keys as revoked by:
 *   1. Marking the device's signing key as 'revoked' in the devices table
 *   2. Deleting the device's key_bundle (identity key, signed prekey, OTKs)
 *
 * After revocation, the device can no longer participate in E2EE sessions
 * and other users will no longer be able to establish Olm sessions with it.
 *
 * @param userId    The user who owns the device
 * @param deviceId  The device to revoke keys for
 */
export async function revokeDeviceKeys(
  userId: string,
  deviceId: string,
): Promise<{ revoked: boolean }> {
  // Mark device keys as revoked in the devices table
  const deviceResult = await pool.query(
    `UPDATE devices
     SET device_public_key = 'revoked', device_signing_key = 'revoked', device_keys_json = NULL
     WHERE device_id = $1 AND user_id = $2`,
    [deviceId, userId],
  );

  if (deviceResult.rowCount === 0) {
    throw new ApiError(404, 'M_NOT_FOUND', 'Device not found or not owned by user');
  }

  // Delete the key bundle so no new Olm sessions can be established
  await deleteKeyBundle(userId, deviceId);

  return { revoked: true };
}
