import { pool } from '../pool';

export interface DeviceRow {
  device_id: string;
  user_id: string;
  device_public_key: string;
  device_signing_key: string;
  display_name: string | null;
  last_seen: Date | null;
  created_at: Date;
}

export async function createDevice(
  deviceId: string,
  userId: string,
  publicKey: string,
  signingKey: string,
  displayName?: string
): Promise<DeviceRow> {
  const result = await pool.query(
    `INSERT INTO devices (device_id, user_id, device_public_key, device_signing_key, display_name)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (device_id) DO NOTHING
     RETURNING *`,
    [deviceId, userId, publicKey, signingKey, displayName || null]
  );
  // If conflict occurred, fetch the existing device
  if (!result.rows[0]) {
    const existing = await findDevice(deviceId);
    return existing!;
  }
  return result.rows[0];
}

export async function findDevicesByUser(userId: string): Promise<DeviceRow[]> {
  const result = await pool.query(
    'SELECT * FROM devices WHERE user_id = $1 ORDER BY created_at',
    [userId]
  );
  return result.rows;
}

export async function findDevice(deviceId: string): Promise<DeviceRow | null> {
  const result = await pool.query(
    'SELECT * FROM devices WHERE device_id = $1',
    [deviceId]
  );
  return result.rows[0] || null;
}

export async function updateLastSeen(deviceId: string): Promise<void> {
  await pool.query(
    'UPDATE devices SET last_seen = NOW() WHERE device_id = $1',
    [deviceId]
  );
}

export async function deleteDevice(deviceId: string, userId: string): Promise<boolean> {
  const result = await pool.query(
    'DELETE FROM devices WHERE device_id = $1 AND user_id = $2',
    [deviceId, userId]
  );
  return result.rowCount !== null && result.rowCount > 0;
}
