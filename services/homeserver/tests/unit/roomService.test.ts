/**
 * Room Service unit tests.
 * All DB query helpers are mocked.
 */

const mockDbCreateRoom = jest.fn();
const mockAddRoomMember = jest.fn();
const mockGetUserRoomsWithMembers = jest.fn();
const mockGetRoomMembersWithDeviceCounts = jest.fn();
const mockIsRoomMember = jest.fn();
const mockUpdateRoomName = jest.fn();
const mockUpdateRoomSettings = jest.fn();
const mockRemoveRoomMember = jest.fn();

const mockFindUserById = jest.fn();

const mockPoolQuery = jest.fn();

jest.mock('../../src/db/queries/rooms', () => ({
  createRoom: (...args: any[]) => mockDbCreateRoom(...args),
  addRoomMember: (...args: any[]) => mockAddRoomMember(...args),
  getUserRoomsWithMembers: (...args: any[]) => mockGetUserRoomsWithMembers(...args),
  getRoomMembersWithDeviceCounts: (...args: any[]) => mockGetRoomMembersWithDeviceCounts(...args),
  isRoomMember: (...args: any[]) => mockIsRoomMember(...args),
  updateRoomName: (...args: any[]) => mockUpdateRoomName(...args),
  updateRoomSettings: (...args: any[]) => mockUpdateRoomSettings(...args),
  removeRoomMember: (...args: any[]) => mockRemoveRoomMember(...args),
}));

jest.mock('../../src/db/pool', () => ({
  pool: { query: (...args: any[]) => mockPoolQuery(...args) },
}));

jest.mock('../../src/db/queries/users', () => ({
  findUserById: (...args: any[]) => mockFindUserById(...args),
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

import { createRoom, inviteToRoom, getRoomMemberList, renameRoom, updateSettings, leaveRoom, joinRoom, joinRoomWithPassword } from '../../src/services/roomService';

beforeEach(() => {
  jest.clearAllMocks();
  // Default pool.query mock for any unexpected queries (anonymous names, settings, etc.)
  mockPoolQuery.mockResolvedValue({ rows: [], rowCount: 0 });
});

// ── createRoom() ──

describe('createRoom', () => {
  it('creates room and adds invited members', async () => {
    const fakeRoom = {
      room_id: '!abc123:test.frame.local',
      room_type: 'group',
      creator_user_id: '@alice:test.frame.local',
    };
    mockDbCreateRoom.mockResolvedValue(fakeRoom);
    mockAddRoomMember.mockResolvedValue(undefined);
    mockFindUserById.mockResolvedValue({ user_id: '@bob:test.frame.local' });

    const result = await createRoom(
      '@alice:test.frame.local',
      'group',
      ['@bob:test.frame.local', '@charlie:test.frame.local'],
    );

    expect(result.roomId).toBe('!abc123:test.frame.local');
    expect(result.room).toBe(fakeRoom);

    // Should create the room (now includes inviteUserIds as 5th arg)
    expect(mockDbCreateRoom).toHaveBeenCalledWith(
      'group',
      '@alice:test.frame.local',
      'test.frame.local',
      undefined,
      ['@bob:test.frame.local', '@charlie:test.frame.local'],
    );
  });

  it('creates direct room with single invite', async () => {
    const fakeRoom = {
      room_id: '!dm:test.frame.local',
      room_type: 'direct',
      creator_user_id: '@alice:test.frame.local',
    };
    mockDbCreateRoom.mockResolvedValue(fakeRoom);
    mockAddRoomMember.mockResolvedValue(undefined);
    mockFindUserById.mockResolvedValue({ user_id: '@bob:test.frame.local' });

    const result = await createRoom(
      '@alice:test.frame.local',
      'direct',
      ['@bob:test.frame.local'],
    );

    expect(result.roomId).toBe('!dm:test.frame.local');
    // Members are now added inside dbCreateRoom, not via separate addRoomMember calls
    expect(mockDbCreateRoom).toHaveBeenCalledWith(
      'direct',
      '@alice:test.frame.local',
      'test.frame.local',
      undefined,
      ['@bob:test.frame.local'],
    );
  });
});

// ── inviteToRoom() ──

describe('inviteToRoom', () => {
  it('adds member when requester is a room member', async () => {
    mockIsRoomMember
      .mockResolvedValueOnce(true)   // requester is member
      .mockResolvedValueOnce(false); // target is NOT already a member
    mockFindUserById.mockResolvedValue({ user_id: '@bob:test.frame.local' });
    mockAddRoomMember.mockResolvedValue(undefined);

    const result = await inviteToRoom(
      '!room:test.frame.local',
      '@alice:test.frame.local',
      '@bob:test.frame.local',
    );

    expect(result.success).toBe(true);
    expect(mockAddRoomMember).toHaveBeenCalledWith(
      '!room:test.frame.local',
      '@bob:test.frame.local',
      'member',
    );
  });

  it('throws 403 when requester is not a member', async () => {
    mockIsRoomMember.mockResolvedValue(false);

    await expect(
      inviteToRoom('!room:test.frame.local', '@outsider:test.frame.local', '@bob:test.frame.local'),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'M_FORBIDDEN',
    });

    expect(mockAddRoomMember).not.toHaveBeenCalled();
  });

  it('throws 400 when targetUserId is empty', async () => {
    mockIsRoomMember.mockResolvedValue(true);

    await expect(
      inviteToRoom('!room:test.frame.local', '@alice:test.frame.local', ''),
    ).rejects.toMatchObject({
      statusCode: 400,
    });
  });
});

// ── getRoomMemberList() ──

describe('getRoomMemberList', () => {
  it('returns members with device counts when requester is a member', async () => {
    mockIsRoomMember.mockResolvedValue(true);
    const mockMembers = [
      { user_id: '@alice:test.frame.local', role: 'admin', device_count: 2 },
      { user_id: '@bob:test.frame.local', role: 'member', device_count: 1 },
    ];
    mockGetRoomMembersWithDeviceCounts.mockResolvedValue(mockMembers);

    const result = await getRoomMemberList('!room:test.frame.local', '@alice:test.frame.local');

    expect(result).toEqual(mockMembers);
    expect(result.length).toBe(2);
  });

  it('throws 403 when requester is not a member', async () => {
    mockIsRoomMember.mockResolvedValue(false);

    await expect(
      getRoomMemberList('!room:test.frame.local', '@outsider:test.frame.local'),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'M_FORBIDDEN',
    });

    expect(mockGetRoomMembersWithDeviceCounts).not.toHaveBeenCalled();
  });
});

// ── renameRoom() ──

describe('renameRoom', () => {
  it('renames room when requester is a member', async () => {
    mockIsRoomMember.mockResolvedValue(true);
    mockUpdateRoomName.mockResolvedValue({ room_id: '!room:test.frame.local', name: 'New Name' });

    const result = await renameRoom('!room:test.frame.local', '@alice:test.frame.local', 'New Name');

    expect(result.success).toBe(true);
    expect(result.name).toBe('New Name');
    expect(mockUpdateRoomName).toHaveBeenCalledWith('!room:test.frame.local', 'New Name');
  });

  it('throws 403 when requester is not a member', async () => {
    mockIsRoomMember.mockResolvedValue(false);

    await expect(
      renameRoom('!room:test.frame.local', '@outsider:test.frame.local', 'New Name'),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'M_FORBIDDEN',
    });

    expect(mockUpdateRoomName).not.toHaveBeenCalled();
  });

  it('throws 400 when name is empty', async () => {
    mockIsRoomMember.mockResolvedValue(true);

    await expect(
      renameRoom('!room:test.frame.local', '@alice:test.frame.local', ''),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'M_BAD_JSON',
    });

    expect(mockUpdateRoomName).not.toHaveBeenCalled();
  });

  it('throws 400 when name is only whitespace', async () => {
    mockIsRoomMember.mockResolvedValue(true);

    await expect(
      renameRoom('!room:test.frame.local', '@alice:test.frame.local', '   '),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'M_BAD_JSON',
    });

    expect(mockUpdateRoomName).not.toHaveBeenCalled();
  });

  it('throws 400 when name exceeds 128 characters', async () => {
    mockIsRoomMember.mockResolvedValue(true);
    const longName = 'a'.repeat(129);

    await expect(
      renameRoom('!room:test.frame.local', '@alice:test.frame.local', longName),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'M_BAD_JSON',
    });

    expect(mockUpdateRoomName).not.toHaveBeenCalled();
  });
});

// ── updateSettings() ──

describe('updateSettings', () => {
  it('updates settings when requester is a member', async () => {
    mockIsRoomMember.mockResolvedValue(true);
    mockPoolQuery.mockResolvedValue({ rows: [{ settings: {} }] });
    mockUpdateRoomSettings.mockResolvedValue({
      room_id: '!room:test.frame.local',
      settings: { disappearingMessages: { enabled: true, ttl: 3600 } },
    });

    const result = await updateSettings(
      '!room:test.frame.local',
      '@alice:test.frame.local',
      { disappearingMessages: { enabled: true, ttl: 3600 } },
    );

    expect(result.success).toBe(true);
    expect(result.settings).toEqual({ disappearingMessages: { enabled: true, ttl: 3600 } });
  });

  it('throws 403 when requester is not a member', async () => {
    mockIsRoomMember.mockResolvedValue(false);

    await expect(
      updateSettings('!room:test.frame.local', '@outsider:test.frame.local', { theme: 'dark' }),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'M_FORBIDDEN',
    });

    expect(mockUpdateRoomSettings).not.toHaveBeenCalled();
  });

  it('merges new settings with existing ones', async () => {
    mockIsRoomMember.mockResolvedValue(true);
    mockPoolQuery.mockResolvedValue({ rows: [{ settings: { existingKey: 'value' } }] });
    mockUpdateRoomSettings.mockResolvedValue({
      room_id: '!room:test.frame.local',
      settings: { existingKey: 'value', newKey: 'newValue' },
    });

    const result = await updateSettings(
      '!room:test.frame.local',
      '@alice:test.frame.local',
      { newKey: 'newValue' },
    );

    expect(result.success).toBe(true);
    // Verify that dbUpdateRoomSettings was called with merged settings
    expect(mockUpdateRoomSettings).toHaveBeenCalledWith(
      '!room:test.frame.local',
      expect.objectContaining({ existingKey: 'value', newKey: 'newValue' }),
    );
  });

  it('handles disappearing messages settings', async () => {
    mockIsRoomMember.mockResolvedValue(true);
    mockPoolQuery.mockResolvedValue({ rows: [{ settings: {} }] });
    const dmSettings = { disappearingMessages: { enabled: true, ttl: 86400 } };
    mockUpdateRoomSettings.mockResolvedValue({
      room_id: '!room:test.frame.local',
      settings: dmSettings,
    });

    const result = await updateSettings(
      '!room:test.frame.local',
      '@alice:test.frame.local',
      dmSettings,
    );

    expect(result.success).toBe(true);
    expect(mockUpdateRoomSettings).toHaveBeenCalledWith(
      '!room:test.frame.local',
      expect.objectContaining(dmSettings),
    );
  });
});

// ── leaveRoom() ──

describe('leaveRoom', () => {
  it('removes member and returns success', async () => {
    mockIsRoomMember.mockResolvedValue(true);
    mockRemoveRoomMember.mockResolvedValue(true);

    const result = await leaveRoom('!room:test.frame.local', '@alice:test.frame.local');

    expect(result.success).toBe(true);
    expect(mockRemoveRoomMember).toHaveBeenCalledWith('!room:test.frame.local', '@alice:test.frame.local');
  });

  it('throws 403 when user is not a member', async () => {
    mockIsRoomMember.mockResolvedValue(false);

    await expect(
      leaveRoom('!room:test.frame.local', '@outsider:test.frame.local'),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'M_FORBIDDEN',
    });

    expect(mockRemoveRoomMember).not.toHaveBeenCalled();
  });

  it('throws 404 when removeRoomMember returns false', async () => {
    mockIsRoomMember.mockResolvedValue(true);
    mockRemoveRoomMember.mockResolvedValue(false);

    await expect(
      leaveRoom('!room:test.frame.local', '@alice:test.frame.local'),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'M_NOT_FOUND',
    });
  });
});

// ── joinRoom() ──

describe('joinRoom', () => {
  it('throws 403 for private rooms', async () => {
    mockPoolQuery.mockResolvedValue({
      rows: [{ room_id: '!private:test.frame.local', settings: { isPrivate: true } }],
    });
    mockIsRoomMember.mockResolvedValue(false);

    await expect(
      joinRoom('!private:test.frame.local', '@bob:test.frame.local'),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'M_FORBIDDEN',
    });

    expect(mockAddRoomMember).not.toHaveBeenCalled();
  });

  it('throws 403 for password-protected rooms without password', async () => {
    mockPoolQuery.mockResolvedValue({
      rows: [{ room_id: '!pw:test.frame.local', settings: { passwordHash: '$2b$10$hashedpw' } }],
    });
    mockIsRoomMember.mockResolvedValue(false);

    await expect(
      joinRoom('!pw:test.frame.local', '@bob:test.frame.local'),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'M_FORBIDDEN',
    });

    expect(mockAddRoomMember).not.toHaveBeenCalled();
  });

  it('returns joined:true if already a member', async () => {
    mockPoolQuery.mockResolvedValue({
      rows: [{ room_id: '!room:test.frame.local', settings: {} }],
    });
    mockIsRoomMember.mockResolvedValue(true);

    const result = await joinRoom('!room:test.frame.local', '@alice:test.frame.local');

    expect(result.joined).toBe(true);
    expect(mockAddRoomMember).not.toHaveBeenCalled();
  });

  it('throws 404 when room does not exist', async () => {
    mockPoolQuery.mockResolvedValue({ rows: [] });

    await expect(
      joinRoom('!nonexistent:test.frame.local', '@bob:test.frame.local'),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'M_NOT_FOUND',
    });
  });
});

// ── joinRoomWithPassword() ──

describe('joinRoomWithPassword', () => {
  it('succeeds with correct password', async () => {
    const bcrypt = require('bcrypt');
    const passwordHash = await bcrypt.hash('secret123', 10);

    mockPoolQuery.mockResolvedValue({
      rows: [{ settings: { passwordHash } }],
    });
    mockIsRoomMember.mockResolvedValue(false);
    mockAddRoomMember.mockResolvedValue(undefined);

    const result = await joinRoomWithPassword(
      '!room:test.frame.local',
      '@bob:test.frame.local',
      'secret123',
    );

    expect(result.joined).toBe(true);
    expect(mockAddRoomMember).toHaveBeenCalledWith(
      '!room:test.frame.local',
      '@bob:test.frame.local',
      'member',
    );
  });

  it('throws 403 with wrong password', async () => {
    const bcrypt = require('bcrypt');
    const passwordHash = await bcrypt.hash('correctPassword', 10);

    mockPoolQuery.mockResolvedValue({
      rows: [{ settings: { passwordHash } }],
    });
    mockIsRoomMember.mockResolvedValue(false);

    await expect(
      joinRoomWithPassword('!room:test.frame.local', '@bob:test.frame.local', 'wrongPassword'),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'M_FORBIDDEN',
    });

    expect(mockAddRoomMember).not.toHaveBeenCalled();
  });

  it('throws 403 for invite-only room without password', async () => {
    mockPoolQuery.mockResolvedValue({
      rows: [{ settings: { isPrivate: true } }],
    });
    mockIsRoomMember.mockResolvedValue(false);

    await expect(
      joinRoomWithPassword('!room:test.frame.local', '@bob:test.frame.local', 'anypass'),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'M_FORBIDDEN',
    });

    expect(mockAddRoomMember).not.toHaveBeenCalled();
  });

  it('throws 403 when password-protected room and no password provided', async () => {
    const bcrypt = require('bcrypt');
    const passwordHash = await bcrypt.hash('secret', 10);

    mockPoolQuery.mockResolvedValue({
      rows: [{ settings: { passwordHash } }],
    });
    mockIsRoomMember.mockResolvedValue(false);

    await expect(
      joinRoomWithPassword('!room:test.frame.local', '@bob:test.frame.local'),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'M_FORBIDDEN',
    });

    expect(mockAddRoomMember).not.toHaveBeenCalled();
  });

  it('returns joined:true if already a member', async () => {
    mockPoolQuery.mockResolvedValue({
      rows: [{ settings: { passwordHash: 'hash' } }],
    });
    mockIsRoomMember.mockResolvedValue(true);

    const result = await joinRoomWithPassword(
      '!room:test.frame.local',
      '@alice:test.frame.local',
      'any',
    );

    expect(result.joined).toBe(true);
    expect(mockAddRoomMember).not.toHaveBeenCalled();
  });
});

// ── inviteToRoom() — non-existent user ──

describe('inviteToRoom - non-existent user', () => {
  it('throws 404 when target user does not exist', async () => {
    mockIsRoomMember
      .mockResolvedValueOnce(true); // requester is member
    mockFindUserById.mockResolvedValue(null); // target doesn't exist

    await expect(
      inviteToRoom('!room:test.frame.local', '@alice:test.frame.local', '@ghost:test.frame.local'),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'M_NOT_FOUND',
    });

    expect(mockAddRoomMember).not.toHaveBeenCalled();
  });
});
