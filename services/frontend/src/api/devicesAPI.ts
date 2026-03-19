/**
 * Device API functions for F.R.A.M.E.
 *
 * All requests go through the central client.ts fetch wrapper.
 */

import { apiRequest } from './client';

export interface RegisterDeviceParams {
  deviceId: string;
  deviceDisplayName?: string;
  devicePublicKey: string;
  deviceSigningKey: string;
}

export interface DeviceInfo {
  deviceId: string;
  deviceDisplayName?: string;
  devicePublicKey: string;
  deviceSigningKey: string;
  lastSeen?: string;
  verified?: boolean;
}

export interface RegisterDeviceResponse {
  deviceId: string;
}

export interface ListDevicesResponse {
  devices: DeviceInfo[];
}

export interface RemoveDeviceResponse {
  removed: boolean;
}

/**
 * Register a new device with its public key material.
 */
export async function registerDevice(
  params: RegisterDeviceParams,
): Promise<RegisterDeviceResponse> {
  return apiRequest<RegisterDeviceResponse>('/devices/register', {
    method: 'POST',
    body: params,
  });
}

/**
 * List all devices for a given user.
 */
export async function listDevices(
  userId: string,
): Promise<ListDevicesResponse> {
  return apiRequest<ListDevicesResponse>(`/devices/${encodeURIComponent(userId)}`);
}

/**
 * Mark a device as verified (server-side).
 */
export async function verifyDeviceOnServer(
  deviceId: string,
): Promise<{ verified: boolean }> {
  return apiRequest<{ verified: boolean }>(
    `/devices/${encodeURIComponent(deviceId)}/verify`,
    { method: 'PUT' },
  );
}

/**
 * Remove / revoke a device by its ID.
 */
export async function removeDevice(
  deviceId: string,
): Promise<RemoveDeviceResponse> {
  return apiRequest<RemoveDeviceResponse>(
    `/devices/${encodeURIComponent(deviceId)}`,
    { method: 'DELETE' },
  );
}
