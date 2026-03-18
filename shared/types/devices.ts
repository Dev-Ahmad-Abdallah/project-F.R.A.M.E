// ── Device Types ──

export interface DeviceRegistration {
  deviceId: string;
  deviceDisplayName: string;
  devicePublicKey: string;
  deviceSigningKey: string;
}

export interface DeviceInfo {
  deviceId: string;
  userId: string;
  displayName: string;
  devicePublicKey: string;
  deviceSigningKey: string;
  lastSeen: string | null;
  createdAt: string;
  isVerified: boolean;
}

export interface DeviceListResponse {
  devices: DeviceInfo[];
}
