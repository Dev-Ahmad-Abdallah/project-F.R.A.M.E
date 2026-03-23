/**
 * Device management logic for F.R.A.M.E.
 *
 * Handles device registration, listing, removal, and detection of
 * unknown/new devices by comparing the server device list against
 * locally stored known devices.
 */

import {
  registerDevice,
  listDevices,
  removeDevice as apiRemoveDevice,
  verifyDeviceOnServer,
  type DeviceInfo,
  type RegisterDeviceParams,
} from '../api/devicesAPI';
import { listRooms } from '../api/roomsAPI';
import { getEncrypted, setEncrypted } from '../storage/secureStorage';
import { generateFingerprint, randomBytes } from '../crypto/cryptoUtils';
import { getIdentityKeys } from '../crypto/olmMachine';
import { invalidateOutboundSession } from '../crypto/sessionManager';

// ── Constants ──

const KNOWN_DEVICES_KEY = 'known-device-list';

// ── Types ──

export interface KnownDevice {
  deviceId: string;
  deviceDisplayName?: string;
  devicePublicKey: string;
  fingerprint: string;
  verified: boolean;
  lastSeen?: string;
}

// ── Public API ──

/**
 * Register the current device with the backend.
 *
 * Generates a unique device ID, registers it, and stores it in
 * the known device list as verified (since it is our own device).
 *
 * @param userId - The current user's ID
 * @returns The registered device info
 */
export async function registerCurrentDevice(
  userId: string,
): Promise<KnownDevice> {
  const deviceId = generateDeviceId();
  const deviceDisplayName = detectDeviceDisplayName();

  // Use real identity keys from OlmMachine if available, fall back to placeholder
  let devicePublicKey: string;
  let deviceSigningKey: string;

  try {
    const identityKeys = getIdentityKeys();
    devicePublicKey = identityKeys.curve25519;
    deviceSigningKey = identityKeys.ed25519;
  } catch {
    // OlmMachine not yet initialised — fall back to placeholder keys
    const keyBytes = randomBytes(32);
    devicePublicKey = Array.from(keyBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    const signingKeyBytes = randomBytes(32);
    deviceSigningKey = Array.from(signingKeyBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  const params: RegisterDeviceParams = {
    deviceId,
    deviceDisplayName,
    devicePublicKey,
    deviceSigningKey,
  };

  await registerDevice(params);

  // Auto-verify the first device on the server
  try {
    await verifyDeviceOnServer(deviceId);
  } catch {
    // May fail if this isn't the first device — server verification
    // will be handled by the gate flow in that case.
  }

  const fingerprint = await generateFingerprint(devicePublicKey);

  const knownDevice: KnownDevice = {
    deviceId,
    deviceDisplayName,
    devicePublicKey,
    fingerprint,
    verified: true, // Our own device is implicitly verified
    lastSeen: new Date().toISOString(),
  };

  // Persist to known device list
  const known = await getKnownDevices(userId);
  known.push(knownDevice);
  await setEncrypted('devices', `${KNOWN_DEVICES_KEY}:${userId}`, known);

  return knownDevice;
}

/**
 * Fetch the full device list for a user from the backend.
 */
export async function getDeviceList(userId: string): Promise<DeviceInfo[]> {
  const response = await listDevices(userId);
  return response.devices;
}

/**
 * Remove a device via the backend API and update the local known list.
 *
 * After removal, invalidates the outbound Megolm session for every room
 * the user belongs to. This ensures the next message in each room triggers
 * a fresh key share that excludes the revoked device.
 */
export async function removeDevice(
  userId: string,
  deviceId: string,
): Promise<void> {
  await apiRemoveDevice(deviceId);

  // Remove from local known devices
  const known = await getKnownDevices(userId);
  const filtered = known.filter((d) => d.deviceId !== deviceId);
  await setEncrypted('devices', `${KNOWN_DEVICES_KEY}:${userId}`, filtered);

  // Invalidate outbound Megolm sessions for all rooms so the revoked device
  // is excluded from future key shares. Failures are logged but not thrown —
  // the backend also publishes key-rotation notifications as a fallback.
  try {
    const rooms = await listRooms();
    await Promise.all(
      rooms.map((room) => invalidateOutboundSession(room.roomId)),
    );
  } catch (err) {
    console.error(
      '[F.R.A.M.E.] Failed to invalidate Megolm sessions after device removal:',
      err,
    );
  }
}

/**
 * Compare the server's device list with our locally known devices.
 *
 * Returns any devices present on the server that are NOT in our
 * known device list — these are potentially unauthorized.
 *
 * @param userId - The user whose devices to check
 * @param knownDevices - The locally known device list
 * @returns Array of unknown DeviceInfo objects
 */
export function detectNewDevices(
  serverDevices: DeviceInfo[],
  knownDevices: KnownDevice[],
): DeviceInfo[] {
  const knownIds = new Set(knownDevices.map((d) => d.deviceId));
  return serverDevices.filter((d) => !knownIds.has(d.deviceId));
}

/**
 * Retrieve the locally stored known device list for a user.
 */
export async function getKnownDevices(userId: string): Promise<KnownDevice[]> {
  const stored = await getEncrypted<KnownDevice[]>(
    'devices',
    `${KNOWN_DEVICES_KEY}:${userId}`,
  );
  return stored ?? [];
}

/**
 * Mark a device as verified in the known device list AND on the server.
 */
export async function verifyDevice(
  userId: string,
  deviceId: string,
): Promise<void> {
  // Update local known device list
  const known = await getKnownDevices(userId);
  const device = known.find((d) => d.deviceId === deviceId);
  if (device) {
    device.verified = true;
    await setEncrypted('devices', `${KNOWN_DEVICES_KEY}:${userId}`, known);
  }

  // Also mark as verified on the server
  try {
    await verifyDeviceOnServer(deviceId);
  } catch (err) {
    console.error('[F.R.A.M.E.] Failed to verify device on server:', err);
  }
}

/**
 * Add a newly discovered device to the known list (unverified).
 */
export async function addKnownDevice(
  userId: string,
  device: DeviceInfo,
): Promise<KnownDevice> {
  const fingerprint = await generateFingerprint(device.devicePublicKey);
  const knownDevice: KnownDevice = {
    deviceId: device.deviceId,
    deviceDisplayName: device.deviceDisplayName,
    devicePublicKey: device.devicePublicKey,
    fingerprint,
    verified: false,
    lastSeen: device.lastSeen,
  };

  const known = await getKnownDevices(userId);
  // Deduplicate: only add if this deviceId isn't already known
  if (!known.some((d) => d.deviceId === knownDevice.deviceId)) {
    known.push(knownDevice);
    await setEncrypted('devices', `${KNOWN_DEVICES_KEY}:${userId}`, known);
  }

  return knownDevice;
}

// ── Helpers ──

function generateDeviceId(): string {
  const bytes = randomBytes(16);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function detectDeviceDisplayName(): string {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return 'Android Device';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS Device';
  if (/Mac/i.test(ua)) return 'Mac';
  if (/Windows/i.test(ua)) return 'Windows PC';
  if (/Linux/i.test(ua)) return 'Linux Device';
  return 'Unknown Device';
}
