// ── Authentication ──

export interface RegisterRequest {
  username: string;
  password: string;
  identityKey: string;
  signedPrekey: string;
  signedPrekeySig: string;
  oneTimePrekeys: string[];
}

export interface LoginRequest {
  username: string;
  password: string;
  deviceId?: string;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  userId: string;
  deviceId: string;
  homeserver: string;
  guest?: boolean;
}

export interface RefreshRequest {
  refreshToken: string;
}

export interface RefreshResponse {
  accessToken: string;
  refreshToken: string;
}

// ── Messages ──

export interface SendMessageRequest {
  roomId: string;
  eventType: string;
  content: EncryptedContent;
}

export interface EncryptedContent {
  algorithm: string;
  ciphertext: string;
  senderKey: string;
  sessionId: string;
  deviceId: string;
}

export interface SyncResponse {
  events: EncryptedEventEnvelope[];
  nextBatch: string;
  hasMore: boolean;
}

export interface EncryptedEventEnvelope {
  eventId: string;
  roomId: string;
  senderId: string;
  senderDeviceId: string;
  eventType: string;
  content: EncryptedContent;
  originServerTs: number;
  sequenceId: number;
}

// ── Rooms ──

export interface CreateRoomRequest {
  roomType: 'direct' | 'group';
  inviteUserIds: string[];
}

export interface RoomInfo {
  roomId: string;
  roomType: 'direct' | 'group';
  members: string[];
  createdAt: string;
}

// ── API Error ──

export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}

// ── Standard error codes ──
export const ErrorCodes = {
  M_FORBIDDEN: 'M_FORBIDDEN',
  M_NOT_FOUND: 'M_NOT_FOUND',
  M_UNAUTHORIZED: 'M_UNAUTHORIZED',
  M_RATE_LIMITED: 'M_RATE_LIMITED',
  M_BAD_JSON: 'M_BAD_JSON',
  M_UNKNOWN: 'M_UNKNOWN',
  M_USER_EXISTS: 'M_USER_EXISTS',
  M_INVALID_TOKEN: 'M_INVALID_TOKEN',
} as const;
