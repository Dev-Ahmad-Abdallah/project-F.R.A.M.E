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
  const totalKeys = await addOneTimePrekeys(userId, deviceId, oneTimePrekeys);

  return {
    oneTimeKeyCount: totalKeys,
  };
}

export async function getKeyCount(userId: string, deviceId: string) {
  const count = await getOtkCount(userId, deviceId);
  return { oneTimeKeyCount: count };
}

// Query device keys for multiple users (required by vodozemac KeysQueryRequest)
export async function queryDeviceKeys(userIds: string[]) {
  const deviceKeys: Record<string, Record<string, unknown>> = {};

  for (const userId of userIds) {
    const devices = await findDevicesByUser(userId);
    const bundles: Record<string, unknown> = {};

    for (const device of devices) {
      const bundle = await pool.query(
        'SELECT * FROM key_bundles WHERE user_id = $1 AND device_id = $2',
        [userId, device.device_id]
      );

      if (bundle.rows[0]) {
        bundles[device.device_id] = {
          user_id: userId,
          device_id: device.device_id,
          algorithms: ['m.olm.v1.curve25519-aes-sha2', 'm.megolm.v1.aes-sha2'],
          keys: {
            [`curve25519:${device.device_id}`]: bundle.rows[0].identity_key,
            [`ed25519:${device.device_id}`]: device.device_signing_key,
          },
        };
      }
    }

    deviceKeys[userId] = bundles;
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
