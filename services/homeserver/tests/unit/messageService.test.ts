/**
 * Message Service unit tests.
 * All DB query helpers and external dependencies are mocked.
 */

const mockInsertEvent = jest.fn();
const mockGetEventsByUser = jest.fn();
const mockCreateDeliveryEntries = jest.fn();
const mockGetPendingDeliveries = jest.fn();
const mockMarkDelivered = jest.fn();
const mockSoftDeleteEvent = jest.fn();

const mockIsRoomMember = jest.fn();
const mockGetRoomMembers = jest.fn();

const mockPoolQuery = jest.fn();

jest.mock('../../src/db/queries/events', () => ({
  insertEvent: (...args: any[]) => mockInsertEvent(...args),
  getEventsByUser: (...args: any[]) => mockGetEventsByUser(...args),
  createDeliveryEntries: (...args: any[]) => mockCreateDeliveryEntries(...args),
  getPendingDeliveries: (...args: any[]) => mockGetPendingDeliveries(...args),
  markDelivered: (...args: any[]) => mockMarkDelivered(...args),
  softDeleteEvent: (...args: any[]) => mockSoftDeleteEvent(...args),
}));

jest.mock('../../src/db/queries/rooms', () => ({
  isRoomMember: (...args: any[]) => mockIsRoomMember(...args),
  getRoomMembers: (...args: any[]) => mockGetRoomMembers(...args),
}));

jest.mock('../../src/db/pool', () => ({
  pool: { query: (...args: any[]) => mockPoolQuery(...args) },
}));

jest.mock('../../src/redis/client', () => ({
  redisClient: {
    publish: jest.fn().mockResolvedValue(1),
  },
  redisSubscriber: {
    subscribe: jest.fn().mockResolvedValue(undefined),
    unsubscribe: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
    removeListener: jest.fn(),
  },
}));

jest.mock('../../src/services/federationService', () => ({
  relayEventToPeers: jest.fn().mockResolvedValue(undefined),
  relayEventToAllPeers: jest.fn().mockResolvedValue(undefined),
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

import { sendMessage, syncMessages, deleteMessage } from '../../src/services/messageService';

beforeEach(() => {
  jest.clearAllMocks();
  // Default pool.query mock for unexpected queries (anonymous names, settings, etc.)
  mockPoolQuery.mockResolvedValue({ rows: [], rowCount: 0 });
});

// ── sendMessage() ──

describe('sendMessage', () => {
  it('inserts event and creates delivery entries', async () => {
    mockIsRoomMember.mockResolvedValue(true);
    mockInsertEvent.mockResolvedValue({
      event_id: '$evt1',
      room_id: '!room1:test',
      sender_id: '@alice:test.frame.local',
      sender_device_id: 'DEV1',
      event_type: 'm.room.encrypted',
      content: { ciphertext: 'abc' },
      sequence_id: 42,
      origin_ts: new Date(),
    });
    mockGetRoomMembers.mockResolvedValue([
      { user_id: '@alice:test.frame.local' },
      { user_id: '@bob:test.frame.local' },
    ]);
    // Mock pool.query for device lookup
    mockPoolQuery.mockResolvedValue({
      rows: [
        { device_id: 'DEV1' },
        { device_id: 'DEV2' },
      ],
    });
    mockCreateDeliveryEntries.mockResolvedValue(undefined);

    const result = await sendMessage({
      roomId: '!room1:test',
      senderId: '@alice:test.frame.local',
      senderDeviceId: 'DEV1',
      eventType: 'm.room.encrypted',
      content: { ciphertext: 'abc' },
    });

    expect(result.eventId).toBeDefined();
    expect(typeof result.eventId).toBe('string');
    expect(result.sequenceId).toBe(42);
    expect(mockIsRoomMember).toHaveBeenCalledWith('!room1:test', '@alice:test.frame.local');
    expect(mockInsertEvent).toHaveBeenCalled();
    expect(mockCreateDeliveryEntries).toHaveBeenCalled();
  });

  it('throws 403 if sender is not a room member', async () => {
    mockIsRoomMember.mockResolvedValue(false);

    await expect(
      sendMessage({
        roomId: '!room1:test',
        senderId: '@alice:test.frame.local',
        senderDeviceId: 'DEV1',
        eventType: 'm.room.encrypted',
        content: { ciphertext: 'abc' },
      }),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'M_FORBIDDEN',
    });
  });
});

// ── syncMessages() ──

describe('syncMessages', () => {
  it('returns events since a given sequence ID', async () => {
    const fakeEvents = [
      {
        event_id: '$evt1',
        room_id: '!room1:test',
        sender_id: '@bob:test.frame.local',
        sender_device_id: 'DEV2',
        event_type: 'm.room.encrypted',
        content: { ciphertext: 'xyz' },
        origin_ts: new Date(),
        sequence_id: 43,
      },
    ];
    mockGetEventsByUser.mockResolvedValue(fakeEvents);
    mockMarkDelivered.mockResolvedValue(undefined);
    // pool.query is called for: stale cleanup, to-device fetch, mark delivered
    // (cleanupExpiredMessages now runs only via setInterval, not on every sync)
    mockPoolQuery
      .mockResolvedValueOnce({ rowCount: 0 })           // delete stale claimed
      .mockResolvedValueOnce({ rows: [] })              // to-device messages fetch
      .mockResolvedValueOnce({ rowCount: 1 });          // mark delivered

    const result = await syncMessages(
      '@alice:test.frame.local',
      'DEV1',
      42,
      50,
      0,
    );

    expect(result.events).toHaveLength(1);
    expect(result.nextBatch).toBe('43');
    expect(result.hasMore).toBe(false);
  });

  it('returns empty result when no events exist', async () => {
    mockGetEventsByUser.mockResolvedValue([]);
    // pool.query is called for: stale cleanup, to-device fetch
    // (cleanupExpiredMessages now runs only via setInterval, not on every sync)
    mockPoolQuery
      .mockResolvedValueOnce({ rowCount: 0 })           // delete stale claimed
      .mockResolvedValueOnce({ rows: [] });             // to-device messages fetch

    const result = await syncMessages(
      '@alice:test.frame.local',
      'DEV1',
      0,
      50,
      0,
    );

    expect(result.events).toHaveLength(0);
    expect(result.nextBatch).toBe('0');
    expect(result.hasMore).toBe(false);
  });
});

// ── deleteMessage() ──

describe('deleteMessage', () => {
  it('soft-deletes own message', async () => {
    // pool.query is called twice: once for SELECT sender_id, once for UPDATE
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ sender_id: '@alice:test.frame.local' }] })
      .mockResolvedValueOnce({ rowCount: 1 });

    await expect(
      deleteMessage('$evt1', '@alice:test.frame.local'),
    ).resolves.toBeUndefined();

    expect(mockPoolQuery).toHaveBeenCalledTimes(2);
  });

  it('throws 404 when event not found', async () => {
    mockPoolQuery.mockResolvedValue({ rows: [] });

    await expect(
      deleteMessage('$nonexistent', '@alice:test.frame.local'),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'M_NOT_FOUND',
    });
  });

  it('throws 403 when a different user tries to delete', async () => {
    mockPoolQuery.mockResolvedValue({
      rows: [{ sender_id: '@alice:test.frame.local' }],
    });

    await expect(
      deleteMessage('$evt1', '@malicious:test.frame.local'),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'M_FORBIDDEN',
    });
  });
});
