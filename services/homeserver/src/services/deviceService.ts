import { createDevice, findDevicesByUser, findDevice, deleteDevice, updateLastSeen } from '../db/queries/devices';
import { getUserRooms } from '../db/queries/rooms';
import { redisClient } from '../redis/client';
import { ApiError } from '../middleware/errorHandler';

export async function registerDevice(
  userId: string,
  deviceId: string,
  publicKey: string,
  signingKey: string,
  displayName?: string
) {
  const existing = await findDevice(deviceId);
  if (existing) {
    throw new ApiError(409, 'M_USER_EXISTS', 'Device ID already registered');
  }

  // Enforce maximum device limit per user
  const userDevices = await findDevicesByUser(userId);
  if (userDevices.length >= 10) {
    throw new ApiError(400, 'M_LIMIT_EXCEEDED', 'Maximum 10 devices per user');
  }

  const device = await createDevice(deviceId, userId, publicKey, signingKey, displayName);

  return {
    deviceId: device.device_id,
    userId: device.user_id,
    displayName: device.display_name,
    createdAt: device.created_at,
  };
}

export async function listDevices(userId: string) {
  const devices = await findDevicesByUser(userId);

  return {
    devices: devices.map((d) => ({
      deviceId: d.device_id,
      userId: d.user_id,
      deviceDisplayName: d.display_name,
      displayName: d.display_name,
      devicePublicKey: d.device_public_key,
      deviceSigningKey: d.device_signing_key,
      lastSeen: d.last_seen,
      createdAt: d.created_at,
    })),
  };
}

export async function removeDevice(deviceId: string, userId: string) {
  const deleted = await deleteDevice(deviceId, userId);
  if (!deleted) {
    throw new ApiError(404, 'M_NOT_FOUND', 'Device not found or not owned by user');
  }

  // Notify all rooms the user belongs to that Megolm sessions should be rotated.
  // Connected clients subscribed to key-rotation:{roomId} will invalidate their
  // outbound sessions so the revoked device is excluded from future key shares.
  try {
    const rooms = await getUserRooms(userId);
    const payload = JSON.stringify({ userId, deviceId, reason: 'device-revoked' });
    await Promise.all(
      rooms.map((room) =>
        redisClient.publish(`key-rotation:${room.room_id}`, payload),
      ),
    );
  } catch (err) {
    // Log but don't fail the device removal — key rotation is best-effort.
    // The next message sent will still trigger a new session if needed.
    console.error(
      '[F.R.A.M.E.] Failed to publish key-rotation notifications after device removal:',
      err,
    );
  }

  return { removed: true, success: true };
}

export async function heartbeat(deviceId: string) {
  await updateLastSeen(deviceId);
}
