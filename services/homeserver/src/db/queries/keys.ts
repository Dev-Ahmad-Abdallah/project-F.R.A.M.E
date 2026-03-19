import { pool } from '../pool';

export interface KeyBundleRow {
  user_id: string;
  device_id: string;
  identity_key: string;
  signed_prekey: string;
  signed_prekey_signature: string;
  one_time_prekeys: string[];
  updated_at: Date;
}

export async function upsertKeyBundle(
  userId: string,
  deviceId: string,
  identityKey: string,
  signedPrekey: string,
  signedPrekeySig: string,
  oneTimePrekeys: string[]
): Promise<KeyBundleRow> {
  const result = await pool.query(
    `INSERT INTO key_bundles (user_id, device_id, identity_key, signed_prekey, signed_prekey_signature, one_time_prekeys)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     ON CONFLICT (user_id, device_id)
     DO UPDATE SET
       signed_prekey = EXCLUDED.signed_prekey,
       signed_prekey_signature = EXCLUDED.signed_prekey_signature,
       one_time_prekeys = key_bundles.one_time_prekeys || EXCLUDED.one_time_prekeys,
       updated_at = NOW()
     RETURNING *`,
    [userId, deviceId, identityKey, signedPrekey, signedPrekeySig, JSON.stringify(oneTimePrekeys)]
  );
  return result.rows[0];
}

export async function getKeyBundle(userId: string): Promise<KeyBundleRow | null> {
  const result = await pool.query(
    'SELECT * FROM key_bundles WHERE user_id = $1 LIMIT 1',
    [userId]
  );
  return result.rows[0] || null;
}

export async function claimOneTimePrekey(
  userId: string,
  deviceId: string
): Promise<string | null> {
  // Atomically pop one key using CTE with FOR UPDATE SKIP LOCKED to prevent race conditions
  const result = await pool.query(
    `WITH claimed AS (
       SELECT ctid, one_time_prekeys->0 AS claimed_key
       FROM key_bundles
       WHERE user_id = $1 AND device_id = $2
         AND jsonb_array_length(one_time_prekeys) > 0
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
     UPDATE key_bundles
     SET one_time_prekeys = one_time_prekeys - 0,
         updated_at = NOW()
     FROM claimed
     WHERE key_bundles.ctid = claimed.ctid
     RETURNING claimed.claimed_key`,
    [userId, deviceId]
  );

  if (!result.rows[0]) return null;
  return result.rows[0].claimed_key;
}

export async function addOneTimePrekeys(
  userId: string,
  deviceId: string,
  newKeys: string[]
): Promise<number> {
  const MAX_OTK_COUNT = 200;

  // First get current count to determine how many we can add
  const countResult = await pool.query(
    `SELECT jsonb_array_length(one_time_prekeys) AS count
     FROM key_bundles
     WHERE user_id = $1 AND device_id = $2`,
    [userId, deviceId]
  );

  const currentCount = countResult.rows[0]?.count || 0;
  const remaining = MAX_OTK_COUNT - currentCount;

  if (remaining <= 0) {
    return currentCount;
  }

  // Only add keys up to the limit
  const keysToAdd = newKeys.slice(0, remaining);

  const result = await pool.query(
    `UPDATE key_bundles
     SET one_time_prekeys = one_time_prekeys || $3::jsonb,
         updated_at = NOW()
     WHERE user_id = $1 AND device_id = $2
     RETURNING jsonb_array_length(one_time_prekeys) AS total`,
    [userId, deviceId, JSON.stringify(keysToAdd)]
  );
  return result.rows[0]?.total || 0;
}

export async function getOtkCount(userId: string, deviceId: string): Promise<number> {
  const result = await pool.query(
    `SELECT jsonb_array_length(one_time_prekeys) AS count
     FROM key_bundles
     WHERE user_id = $1 AND device_id = $2`,
    [userId, deviceId]
  );
  return result.rows[0]?.count || 0;
}
