/**
 * Device Service unit tests.
 *
 * All external dependencies (DB query helpers, Redis, rooms) are mocked
 * so tests run without infrastructure.
 */

// ── Mocks must be declared before imports ──

const mockCreateDevice = jest.fn();
const mockFindDevicesByUser = jest.fn();
const mockFindDevice = jest.fn();
const mockDeleteDevice = jest.fn();
const mockUpdateLastSeen = jest.fn();

jest.mock('../../src/db/queries/devices', () => ({
  createDevice: (...args: any[]) => mockCreateDevice(...args),
  findDevicesByUser: (...args: any[]) => mockFindDevicesByUser(...args),
  findDevice: (...args: any[]) => mockFindDevice(...args),
  deleteDevice: (...args: any[]) => mockDeleteDevice(...args),
  updateLastSeen: (...args: any[]) => mockUpdateLastSeen(...args),
}));

const mockGetUserRooms = jest.fn();

jest.mock('../../src/db/queries/rooms', () => ({
  getUserRooms: (...args: any[]) => mockGetUserRooms(...args),
}));

const mockRedisPublish = jest.fn();

jest.mock('../../src/redis/client', () => ({
  redisClient: {
    publish: (...args: any[]) => mockRedisPublish(...args),
  },
}));

jest.mock('../../src/config', () => ({
  getConfig: () => ({
    HOMESERVER_DOMAIN: 'test.frame.local',
    JWT_SECRET: 'test-secret-that-is-at-least-32-chars-long!!',
    BCRYPT_SALT_ROUNDS: 10,
    FEDERATION_SIGNING_KEY: 'fake-key',
    FEDERATION_PEERS: '',
    DATABASE_URL: 'postgres://localhost/test',
    REDIS_URL: 'redis://localhost',
    PORT: 3000,
    NODE_ENV: 'test',
    CORS_ORIGINS: '',
    DB_SSL_REJECT_UNAUTHORIZED: false,
  }),
}));

import { registerDevice, listDevices, removeDevice, heartbeat } from '../../src/services/deviceService';

beforeEach(() => {
  jest.clearAllMocks();
});

// ── registerDevice() ──

describe('registerDevice', () => {
  const userId = '@alice:test.frame.local';
  const deviceId = 'DEVICE_ABC';
  const publicKey = 'pub-key-123';
  const signingKey = 'sign-key-456';
  const displayName = "Alice's phone";

  it('creates device and returns formatted result', async () => {
    mockFindDevice.mockResolvedValue(null);
    mockFindDevicesByUser.mockResolvedValue([]);
    mockCreateDevice.mockResolvedValue({
      device_id: deviceId,
      user_id: userId,
      display_name: displayName,
      created_at: new Date('2026-01-01'),
    });

    const result = await registerDevice(userId, deviceId, publicKey, signingKey, displayName);

    expect(result.deviceId).toBe(deviceId);
    expect(result.userId).toBe(userId);
    expect(result.displayName).toBe(displayName);
    expect(result.createdAt).toEqual(new Date('2026-01-01'));

    expect(mockFindDevice).toHaveBeenCalledWith(deviceId);
    expect(mockFindDevicesByUser).toHaveBeenCalledWith(userId);
    expect(mockCreateDevice).toHaveBeenCalledWith(deviceId, userId, publicKey, signingKey, displayName);
  });

  it('throws 409 for duplicate device ID', async () => {
    mockFindDevice.mockResolvedValue({
      device_id: deviceId,
      user_id: '@bob:test.frame.local',
    });

    await expect(
      registerDevice(userId, deviceId, publicKey, signingKey),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'M_USER_EXISTS',
    });

    expect(mockCreateDevice).not.toHaveBeenCalled();
  });

  it('throws 400 when user has reached max device limit (10)', async () => {
    mockFindDevice.mockResolvedValue(null);
    // Simulate 10 existing devices
    const tenDevices = Array.from({ length: 10 }, (_, i) => ({
      device_id: `DEV_${i}`,
      user_id: userId,
    }));
    mockFindDevicesByUser.mockResolvedValue(tenDevices);

    await expect(
      registerDevice(userId, deviceId, publicKey, signingKey),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'M_LIMIT_EXCEEDED',
    });

    expect(mockCreateDevice).not.toHaveBeenCalled();
  });

  it('allows registration when user has fewer than 10 devices', async () => {
    mockFindDevice.mockResolvedValue(null);
    const nineDevices = Array.from({ length: 9 }, (_, i) => ({
      device_id: `DEV_${i}`,
      user_id: userId,
    }));
    mockFindDevicesByUser.mockResolvedValue(nineDevices);
    mockCreateDevice.mockResolvedValue({
      device_id: deviceId,
      user_id: userId,
      display_name: null,
      created_at: new Date(),
    });

    const result = await registerDevice(userId, deviceId, publicKey, signingKey);

    expect(result.deviceId).toBe(deviceId);
    expect(mockCreateDevice).toHaveBeenCalledTimes(1);
  });
});

// ── listDevices() ──

describe('listDevices', () => {
  it('returns devices in correct format', async () => {
    const now = new Date();
    mockFindDevicesByUser.mockResolvedValue([
      {
        device_id: 'DEV1',
        user_id: '@alice:test.frame.local',
        display_name: 'Phone',
        device_public_key: 'pub1',
        device_signing_key: 'sign1',
        last_seen: now,
        created_at: now,
      },
      {
        device_id: 'DEV2',
        user_id: '@alice:test.frame.local',
        display_name: 'Laptop',
        device_public_key: 'pub2',
        device_signing_key: 'sign2',
        last_seen: null,
        created_at: now,
      },
    ]);

    const result = await listDevices('@alice:test.frame.local');

    expect(result.devices).toHaveLength(2);
    expect(result.devices[0]).toEqual({
      deviceId: 'DEV1',
      userId: '@alice:test.frame.local',
      deviceDisplayName: 'Phone',
      displayName: 'Phone',
      devicePublicKey: 'pub1',
      deviceSigningKey: 'sign1',
      lastSeen: now,
      createdAt: now,
    });
    expect(result.devices[1].deviceId).toBe('DEV2');
    expect(result.devices[1].lastSeen).toBeNull();
  });

  it('returns empty array when user has no devices', async () => {
    mockFindDevicesByUser.mockResolvedValue([]);

    const result = await listDevices('@alice:test.frame.local');

    expect(result.devices).toHaveLength(0);
    expect(result.devices).toEqual([]);
  });
});

// ── removeDevice() ──

describe('removeDevice', () => {
  it('removes own device and publishes key-rotation events', async () => {
    mockDeleteDevice.mockResolvedValue(true);
    mockGetUserRooms.mockResolvedValue([
      { room_id: '!room1:test.frame.local' },
      { room_id: '!room2:test.frame.local' },
    ]);
    mockRedisPublish.mockResolvedValue(1);

    const result = await removeDevice('DEV1', '@alice:test.frame.local');

    expect(result.removed).toBe(true);
    expect(result.success).toBe(true);
    expect(mockDeleteDevice).toHaveBeenCalledWith('DEV1', '@alice:test.frame.local');

    // Should publish key-rotation for each room
    expect(mockRedisPublish).toHaveBeenCalledTimes(2);
    expect(mockRedisPublish).toHaveBeenCalledWith(
      'key-rotation:!room1:test.frame.local',
      expect.stringContaining('"reason":"device-revoked"'),
    );
    expect(mockRedisPublish).toHaveBeenCalledWith(
      'key-rotation:!room2:test.frame.local',
      expect.stringContaining('"reason":"device-revoked"'),
    );
  });

  it('throws 404 when device not found or not owned by user', async () => {
    mockDeleteDevice.mockResolvedValue(false);

    await expect(
      removeDevice('DEV_OTHER', '@alice:test.frame.local'),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'M_NOT_FOUND',
    });
  });

  it('succeeds even if Redis publish fails (best-effort notification)', async () => {
    mockDeleteDevice.mockResolvedValue(true);
    mockGetUserRooms.mockResolvedValue([{ room_id: '!room:test.frame.local' }]);
    mockRedisPublish.mockRejectedValue(new Error('Redis connection refused'));

    // Should not throw even though Redis failed
    const result = await removeDevice('DEV1', '@alice:test.frame.local');

    expect(result.removed).toBe(true);
    expect(result.success).toBe(true);
  });
});

// ── heartbeat() ──

describe('heartbeat', () => {
  it('updates last_seen timestamp for device', async () => {
    mockUpdateLastSeen.mockResolvedValue(undefined);

    await heartbeat('DEV1');

    expect(mockUpdateLastSeen).toHaveBeenCalledWith('DEV1');
    expect(mockUpdateLastSeen).toHaveBeenCalledTimes(1);
  });
});
