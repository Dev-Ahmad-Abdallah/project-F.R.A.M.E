/**
 * Room Service unit tests.
 * All DB query helpers are mocked.
 */

const mockDbCreateRoom = jest.fn();
const mockAddRoomMember = jest.fn();
const mockGetUserRoomsWithMembers = jest.fn();
const mockGetRoomMembersWithDeviceCounts = jest.fn();
const mockIsRoomMember = jest.fn();

const mockFindUserById = jest.fn();

jest.mock('../../src/db/queries/rooms', () => ({
  createRoom: (...args: any[]) => mockDbCreateRoom(...args),
  addRoomMember: (...args: any[]) => mockAddRoomMember(...args),
  getUserRoomsWithMembers: (...args: any[]) => mockGetUserRoomsWithMembers(...args),
  getRoomMembersWithDeviceCounts: (...args: any[]) => mockGetRoomMembersWithDeviceCounts(...args),
  isRoomMember: (...args: any[]) => mockIsRoomMember(...args),
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

import { createRoom, inviteToRoom, getRoomMemberList } from '../../src/services/roomService';

beforeEach(() => {
  jest.clearAllMocks();
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

    const result = await createRoom(
      '@alice:test.frame.local',
      'group',
      ['@bob:test.frame.local', '@charlie:test.frame.local'],
    );

    expect(result.roomId).toBe('!abc123:test.frame.local');
    expect(result.room).toBe(fakeRoom);

    // Should create the room
    expect(mockDbCreateRoom).toHaveBeenCalledWith('group', '@alice:test.frame.local', 'test.frame.local', undefined);

    // Should add each invited member
    expect(mockAddRoomMember).toHaveBeenCalledTimes(2);
    expect(mockAddRoomMember).toHaveBeenCalledWith('!abc123:test.frame.local', '@bob:test.frame.local', 'member');
    expect(mockAddRoomMember).toHaveBeenCalledWith('!abc123:test.frame.local', '@charlie:test.frame.local', 'member');
  });

  it('creates direct room with single invite', async () => {
    const fakeRoom = {
      room_id: '!dm:test.frame.local',
      room_type: 'direct',
      creator_user_id: '@alice:test.frame.local',
    };
    mockDbCreateRoom.mockResolvedValue(fakeRoom);
    mockAddRoomMember.mockResolvedValue(undefined);

    const result = await createRoom(
      '@alice:test.frame.local',
      'direct',
      ['@bob:test.frame.local'],
    );

    expect(result.roomId).toBe('!dm:test.frame.local');
    expect(mockAddRoomMember).toHaveBeenCalledTimes(1);
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
