import { getKeyBundle, claimOneTimePrekey, addOneTimePrekeys, getOtkCount } from '../db/queries/keys';
import { findDevicesByUser } from '../db/queries/devices';
import { pool } from '../db/pool';
import { ApiError } from '../middleware/errorHandler';

export async function fetchKeyBundle(userId: string) {
  const bundle = await getKeyBundle(userId);
  if (!bundle) {
    throw new ApiError(404, 'M_NOT_FOUND', 'No key bundle found for user');
  }

  // Claim one OTK (consumed — removed from pool)
  const claimedOtk = await claimOneTimePrekey(userId, bundle.device_id);

  return {
    userId: bundle.user_id,
    deviceId: bundle.device_id,
    identityKey: bundle.identity_key,
    signedPrekey: bundle.signed_prekey,
    signedPrekeySig: bundle.signed_prekey_signature,
    oneTimePrekey: claimedOtk,
  };
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

// Query device keys for multiple users (required by vodozemac KeysQueryRequest)
// Single batch query instead of N+1 per user/device
export async function queryDeviceKeys(userIds: string[]) {
  if (userIds.length === 0) return { device_keys: {} };

  const result = await pool.query(
    `SELECT d.user_id, d.device_id, d.device_signing_key,
            kb.identity_key, kb.signed_prekey, kb.signed_prekey_signature
     FROM devices d
     LEFT JOIN key_bundles kb ON d.user_id = kb.user_id AND d.device_id = kb.device_id
     WHERE d.user_id = ANY($1::text[])
       AND d.device_public_key != 'pending'
       AND d.device_signing_key != 'pending'`,
    [userIds]
  );

  const deviceKeys: Record<string, Record<string, unknown>> = {};

  for (const row of result.rows) {
    if (!deviceKeys[row.user_id]) deviceKeys[row.user_id] = {};
    if (row.identity_key && row.device_signing_key) {
      deviceKeys[row.user_id][row.device_id] = {
        user_id: row.user_id,
        device_id: row.device_id,
        algorithms: ['m.olm.v1.curve25519-aes-sha2', 'm.megolm.v1.aes-sha2'],
        keys: {
          [`curve25519:${row.device_id}`]: row.identity_key,
          [`ed25519:${row.device_id}`]: row.device_signing_key,
        },
      };
    }
  }

  // Ensure all requested users have an entry (even if empty)
  for (const userId of userIds) {
    if (!deviceKeys[userId]) deviceKeys[userId] = {};
  }

  return { device_keys: deviceKeys };
}

// Claim one-time keys for devices (required by vodozemac KeysClaimRequest)
export async function claimKeys(
  oneTimeKeys: Record<string, Record<string, string>>
) {
  const claimedKeys: Record<string, Record<string, unknown>> = {};

  for (const [userId, devices] of Object.entries(oneTimeKeys)) {
    claimedKeys[userId] = {};

    for (const [deviceId, _algorithm] of Object.entries(devices)) {
      const claimed = await claimOneTimePrekey(userId, deviceId);
      if (claimed) {
        claimedKeys[userId][deviceId] = {
          [`signed_curve25519:${deviceId}`]: claimed,
        };
      }
    }
  }

  return { one_time_keys: claimedKeys };
}
