import { createDevice, findDevicesByUser, findDevice, deleteDevice, updateLastSeen } from '../db/queries/devices';
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
  return { removed: true, success: true };
}

export async function heartbeat(deviceId: string) {
  await updateLastSeen(deviceId);
}
