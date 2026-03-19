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

jest.mock('../../src/db/queries/devices', () => ({
  findDevicesByUser: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../src/db/pool', () => ({
  pool: {
    query: (...args: any[]) => mockPoolQuery(...args),
  },
}));

jest.mock('../../src/redis/client', () => ({
  redisClient: {
    publish: jest.fn().mockResolvedValue(1),
  },
  redisSubscriber: {
    on: jest.fn(),
    subscribe: jest.fn().mockResolvedValue(undefined),
    unsubscribe: jest.fn().mockResolvedValue(undefined),
    removeListener: jest.fn(),
  },
}));

jest.mock('../../src/services/federationService', () => ({
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
});

// ── sendMessage() ──

describe('sendMessage', () => {
  it('creates event and delivery entries for room member devices', async () => {
    const fakeEvent = {
      event_id: '$abc123',
      room_id: '!room:test.frame.local',
      sender_id: '@alice:test.frame.local',
      sender_device_id: 'DEVICE_A',
      event_type: 'm.room.message',
      content: { body: 'hello' },
      sequence_id: 42,
      origin_server: 'test.frame.local',
      origin_ts: new Date(),
      deleted_at: null,
      created_at: new Date(),
    };

    mockIsRoomMember.mockResolvedValue(true);
    mockInsertEvent.mockResolvedValue(fakeEvent);
    mockGetRoomMembers.mockResolvedValue([
      { user_id: '@alice:test.frame.local', role: 'admin' },
      { user_id: '@bob:test.frame.local', role: 'member' },
    ]);
    // Pool query for device IDs
    mockPoolQuery.mockResolvedValue({
      rows: [
        { device_id: 'DEVICE_A' },
        { device_id: 'DEVICE_B' },
      ],
    });
    mockCreateDeliveryEntries.mockResolvedValue(undefined);

    const result = await sendMessage({
      roomId: '!room:test.frame.local',
      senderId: '@alice:test.frame.local',
      senderDeviceId: 'DEVICE_A',
      eventType: 'm.room.message',
      content: { body: 'hello' },
    });

    expect(result.eventId).toBeDefined();
    expect(result.sequenceId).toBe(42);

    // Should verify membership
    expect(mockIsRoomMember).toHaveBeenCalledWith('!room:test.frame.local', '@alice:test.frame.local');

    // Should insert the event
    expect(mockInsertEvent).toHaveBeenCalledTimes(1);

    // Should create delivery entries (excluding sender device)
    expect(mockCreateDeliveryEntries).toHaveBeenCalledWith(
      expect.any(String),
      ['DEVICE_B'], // DEVICE_A filtered out as sender device
    );
  });

  it('throws 403 when sender is not a room member', async () => {
    mockIsRoomMember.mockResolvedValue(false);

    await expect(
      sendMessage({
        roomId: '!room:test.frame.local',
        senderId: '@outsider:test.frame.local',
        senderDeviceId: 'DEVICE_X',
        eventType: 'm.room.message',
        content: { body: 'hello' },
      }),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'M_FORBIDDEN',
    });

    expect(mockInsertEvent).not.toHaveBeenCalled();
  });
});

// ── syncMessages() ──

describe('syncMessages', () => {
  it('returns events since sequence ID', async () => {
    const fakeEvents = [
      {
        event_id: '$evt1',
        room_id: '!room:test.frame.local',
        sender_id: '@bob:test.frame.local',
        sender_device_id: 'DEVICE_B',
        event_type: 'm.room.message',
        content: { body: 'hey' },
        sequence_id: 10,
        origin_ts: new Date(),
        deleted_at: null,
        created_at: new Date(),
      },
      {
        event_id: '$evt2',
        room_id: '!room:test.frame.local',
        sender_id: '@bob:test.frame.local',
        sender_device_id: 'DEVICE_B',
        event_type: 'm.room.message',
        content: { body: 'world' },
        sequence_id: 11,
        origin_ts: new Date(),
        deleted_at: null,
        created_at: new Date(),
      },
    ];

    // First pool.query call: clean up stale to-device messages
    // Second pool.query call: fetch unclaimed to-device messages
    // Third pool.query call: batch mark delivered
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })  // DELETE stale
      .mockResolvedValueOnce({ rows: [] })                 // UPDATE to-device (none)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });  // UPDATE delivery_state

    mockGetEventsByUser.mockResolvedValue(fakeEvents);

    const result = await syncMessages('@alice:test.frame.local', 'DEVICE_A', 5, 50, 0);

    expect(result.events).toHaveLength(2);
    expect(result.nextBatch).toBe('11');
    expect(result.hasMore).toBe(false);
    expect(result.events[0]).toMatchObject({
      eventId: '$evt1',
      roomId: '!room:test.frame.local',
    });

    // Should query events since sequence 5
    expect(mockGetEventsByUser).toHaveBeenCalledWith('@alice:test.frame.local', 5, 50);
  });

  it('returns empty result when no events exist', async () => {
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [] });

    mockGetEventsByUser.mockResolvedValue([]);

    const result = await syncMessages('@alice:test.frame.local', 'DEVICE_A', 0, 50, 0);

    expect(result.events).toHaveLength(0);
    expect(result.nextBatch).toBe('0');
    expect(result.hasMore).toBe(false);
  });
});

// ── deleteMessage() ──

describe('deleteMessage', () => {
  it('soft-deletes event and returns success', async () => {
    mockSoftDeleteEvent.mockResolvedValue(true);

    const result = await deleteMessage('$evt1', '@alice:test.frame.local');

    expect(result).toEqual({ success: true });
    expect(mockSoftDeleteEvent).toHaveBeenCalledWith('$evt1', '@alice:test.frame.local');
  });

  it('throws 404 when event not found or user is not the sender', async () => {
    mockSoftDeleteEvent.mockResolvedValue(false);

    await expect(
      deleteMessage('$nonexistent', '@alice:test.frame.local'),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'M_NOT_FOUND',
    });
  });

  it('throws 404 when a different user tries to delete', async () => {
    mockSoftDeleteEvent.mockResolvedValue(false);

    await expect(
      deleteMessage('$evt1', '@malicious:test.frame.local'),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'M_NOT_FOUND',
    });

    expect(mockSoftDeleteEvent).toHaveBeenCalledWith('$evt1', '@malicious:test.frame.local');
  });
});
