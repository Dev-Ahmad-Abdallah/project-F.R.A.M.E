import { pool } from '../pool';

export interface DeviceRow {
  device_id: string;
  user_id: string;
  device_public_key: string;
  device_signing_key: string;
  display_name: string | null;
  last_seen: Date | null;
  created_at: Date;
  device_keys_json: Record<string, unknown> | null;
}

export async function createDevice(
  deviceId: string,
  userId: string,
  publicKey: string,
  signingKey: string,
  displayName?: string
): Promise<DeviceRow> {
  const result = await pool.query<DeviceRow>(
    `INSERT INTO devices (device_id, user_id, device_public_key, device_signing_key, display_name)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (device_id) DO NOTHING
     RETURNING *`,
    [deviceId, userId, publicKey, signingKey, displayName || null]
  );
  // If conflict occurred, fetch the existing device
  if (!result.rows[0]) {
    const existing = await findDevice(deviceId);
    if (!existing) {
      throw new Error(`Device ${deviceId} not found after conflict`);
    }
    return existing;
  }
  return result.rows[0];
}

export async function findDevicesByUser(userId: string): Promise<DeviceRow[]> {
  const result = await pool.query<DeviceRow>(
    'SELECT * FROM devices WHERE user_id = $1 ORDER BY created_at',
    [userId]
  );
  return result.rows;
}

export async function findDevice(deviceId: string): Promise<DeviceRow | null> {
  const result = await pool.query<DeviceRow>(
    'SELECT * FROM devices WHERE device_id = $1',
    [deviceId]
  );
  return result.rows[0] || null;
}

export async function updateDevice(deviceId: string, publicKey: string, signingKey: string): Promise<void> {
  await pool.query(
    'UPDATE devices SET device_public_key = $2, device_signing_key = $3 WHERE device_id = $1',
    [deviceId, publicKey, signingKey]
  );
}

export async function updateLastSeen(deviceId: string): Promise<void> {
  await pool.query(
    'UPDATE devices SET last_seen = NOW() WHERE device_id = $1',
    [deviceId]
  );
}

export async function updateDeviceKeysJson(deviceId: string, deviceKeysJson: Record<string, unknown>): Promise<void> {
  await pool.query(
    'UPDATE devices SET device_keys_json = $2 WHERE device_id = $1',
    [deviceId, JSON.stringify(deviceKeysJson)]
  );
}

export async function countDevicesByUser(userId: string): Promise<number> {
  const result = await pool.query<{ count: string }>(
    'SELECT COUNT(*) FROM devices WHERE user_id = $1',
    [userId]
  );
  return parseInt(result.rows[0].count, 10);
}

export async function deleteDevice(deviceId: string, userId: string): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verify ownership first
    const check = await client.query(
      'SELECT device_id FROM devices WHERE device_id = $1 AND user_id = $2',
      [deviceId, userId]
    );
    if (check.rowCount === 0) {
      await client.query('ROLLBACK');
      return false;
    }

    // Clean up all foreign-key references before deleting the device
    await client.query('DELETE FROM delivery_state WHERE device_id = $1', [deviceId]);
    await client.query('DELETE FROM refresh_tokens WHERE device_id = $1', [deviceId]);
    await client.query('DELETE FROM key_bundles WHERE user_id = $1 AND device_id = $2', [userId, deviceId]);
    await client.query('DELETE FROM to_device_messages WHERE recipient_device_id = $1', [deviceId]);

    const result = await client.query(
      'DELETE FROM devices WHERE device_id = $1 AND user_id = $2',
      [deviceId, userId]
    );

    await client.query('COMMIT');
    return result.rowCount !== null && result.rowCount > 0;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
