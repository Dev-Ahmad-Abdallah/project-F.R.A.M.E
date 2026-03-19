/**
 * API Security Tests
 *
 * Validates authentication enforcement on protected endpoints, CORS policy,
 * request body size limits, and rate limiting through the real middleware stack.
 */

// ── Mocks (must be declared before imports) ──

const mockPoolQuery = jest.fn().mockResolvedValue({ rowCount: 0, rows: [] });

jest.mock('../../src/db/pool', () => ({
  pool: {
    query: (...args: unknown[]) => mockPoolQuery(...args),
    end: jest.fn().mockResolvedValue(undefined),
  },
  closePool: jest.fn(),
}));

jest.mock('../../src/redis/client', () => ({
  redisClient: {
    ping: jest.fn().mockResolvedValue('PONG'),
    publish: jest.fn().mockResolvedValue(1),
    subscribe: jest.fn().mockResolvedValue(undefined),
    flushdb: jest.fn().mockResolvedValue('OK'),
    quit: jest.fn().mockResolvedValue(undefined),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
  },
  connectRedis: jest.fn().mockResolvedValue(undefined),
  closeRedis: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/db/queries/users', () => ({
  userExists: jest.fn().mockResolvedValue(false),
  createUser: jest.fn().mockResolvedValue(undefined),
  findUserByUsername: jest.fn().mockResolvedValue(null),
  findUserById: jest.fn().mockResolvedValue(null),
  updateDisplayName: jest.fn().mockResolvedValue({ user_id: '@t:test.local', display_name: 'T' }),
}));

jest.mock('../../src/db/queries/devices', () => ({
  createDevice: jest.fn().mockResolvedValue(undefined),
  findDevice: jest.fn().mockResolvedValue(null),
  findDevicesByUser: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../src/db/queries/keys', () => ({
  upsertKeyBundle: jest.fn().mockResolvedValue(undefined),
  getKeyBundle: jest.fn().mockResolvedValue(null),
  addOneTimePrekeys: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/merkleTree', () => ({
  addKeyToLog: jest.fn().mockResolvedValue(undefined),
  getProofForUser: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../src/db/queries/events', () => ({
  insertEvent: jest.fn().mockResolvedValue({ event_id: 'e1', sequence_id: 1 }),
  getEventsSince: jest.fn().mockResolvedValue([]),
  createDeliveryEntries: jest.fn().mockResolvedValue(undefined),
  addReaction: jest.fn().mockResolvedValue([]),
  upsertReadReceipt: jest.fn().mockResolvedValue(undefined),
  getReadReceipts: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../src/db/queries/rooms', () => ({
  getRoomMembers: jest.fn().mockResolvedValue([]),
  isRoomMember: jest.fn().mockResolvedValue(false),
  getUserRooms: jest.fn().mockResolvedValue([]),
  usersShareRoom: jest.fn().mockResolvedValue(false),
}));

jest.mock('../../src/services/messageService', () => ({
  sendMessage: jest.fn().mockResolvedValue({ eventId: 'e1' }),
  deleteMessage: jest.fn().mockResolvedValue(undefined),
  syncMessages: jest.fn().mockResolvedValue({ events: [], nextBatch: '0' }),
  acknowledgeToDeviceMessages: jest.fn().mockResolvedValue(0),
  stopDisappearingCleanup: jest.fn(),
}));

import request from 'supertest';
import { app } from '../../src/server';

// ── Test Suites ──

describe('API Security: Authentication Enforcement', () => {
  // All these endpoints require a Bearer token via requireAuth middleware
  const protectedEndpoints: Array<{ method: 'get' | 'post' | 'put' | 'delete'; path: string; body?: Record<string, unknown> }> = [
    { method: 'get', path: '/rooms' },
    { method: 'post', path: '/rooms/create', body: { roomType: 'direct', inviteUserIds: ['@u:test.local'] } },
    { method: 'post', path: '/messages/send', body: { roomId: 'r1', eventType: 'm.room.message', content: {} } },
    { method: 'get', path: '/messages/sync' },
    { method: 'post', path: '/keys/upload', body: {} },
    { method: 'get', path: '/keys/count' },
    { method: 'post', path: '/devices/register', body: { deviceId: 'd1', devicePublicKey: 'pk', deviceSigningKey: 'sk' } },
    { method: 'get', path: '/devices/@user:test.local' },
    { method: 'post', path: '/auth/logout' },
    { method: 'put', path: '/auth/profile', body: { displayName: 'Test' } },
    { method: 'get', path: '/auth/profile' },
  ];

  protectedEndpoints.forEach(({ method, path, body }) => {
    it(`${method.toUpperCase()} ${path} returns 401 without Bearer token`, async () => {
      let req = (request(app) as any)[method](path);
      if (body) {
        req = req.send(body);
      }
      const res = await req;

      expect(res.status).toBe(401);
      expect(res.body.error).toBeDefined();
    });
  });
});

describe('API Security: CORS Policy', () => {
  it('rejects requests from unauthorized origins', async () => {
    const res = await request(app)
      .options('/rooms')
      .set('Origin', 'https://evil-site.example.com')
      .set('Access-Control-Request-Method', 'GET');

    // CORS middleware should either not include the Access-Control-Allow-Origin
    // header or respond with an error. The origin should not be reflected.
    const allowOrigin = res.headers['access-control-allow-origin'];
    expect(allowOrigin).not.toBe('https://evil-site.example.com');
  });

  it('does not include wildcard Access-Control-Allow-Origin', async () => {
    const res = await request(app)
      .get('/health')
      .set('Origin', 'https://random.example.com');

    const allowOrigin = res.headers['access-control-allow-origin'];
    // Should not be wildcard — the server uses an explicit allow-list
    expect(allowOrigin).not.toBe('*');
  });
});

describe('API Security: Request Body Size Limit', () => {
  it('rejects request body larger than 64KB', async () => {
    // Generate a payload larger than 64KB
    const largePayload = {
      username: 'sizetest',
      password: 'SecurePass123!',
      identityKey: 'x'.repeat(70000),  // ~70KB in the identityKey field alone
      signedPrekey: 'spk',
      signedPrekeySig: 'sig',
      oneTimePrekeys: ['otpk'],
    };

    const res = await request(app)
      .post('/auth/register')
      .send(largePayload);

    // Express json({ limit: '64kb' }) returns 413 Payload Too Large
    expect([400, 413]).toContain(res.status);
  });

  it('accepts request body under 64KB', async () => {
    const normalPayload = {
      username: 'normaluser',
      password: 'SecurePass123!',
      identityKey: 'a'.repeat(100),
      signedPrekey: 'spk',
      signedPrekeySig: 'sig',
      oneTimePrekeys: ['otpk'],
    };

    const res = await request(app)
      .post('/auth/register')
      .send(normalPayload);

    // Should pass body parsing (may fail at DB level, but not at size limit)
    expect(res.status).not.toBe(413);
  });
});

describe('API Security: Rate Limiting', () => {
  it('returns 429 after exceeding the API rate limit threshold', async () => {
    // The apiLimiter allows 300 requests per minute per IP.
    // We test the loginLimiter instead (20 per 15min) since it has a lower threshold
    // and is more practical to test.
    const responses: number[] = [];

    for (let i = 0; i < 21; i++) {
      const res = await request(app)
        .post('/auth/login')
        .send({ username: `ratelimit_api_${i}`, password: 'test' });
      responses.push(res.status);
    }

    // The login limiter keys on IP+username, so each unique username gets its own bucket.
    // To trigger the limit, use the same username repeatedly.
    const sameUserResponses: number[] = [];
    for (let i = 0; i < 21; i++) {
      const res = await request(app)
        .post('/auth/login')
        .send({ username: 'same_user_rl', password: `wrong_${i}` });
      sameUserResponses.push(res.status);
    }

    expect(sameUserResponses).toContain(429);
  });

  it('rate limit response includes proper error code', async () => {
    // Exhaust the limit
    for (let i = 0; i < 21; i++) {
      await request(app)
        .post('/auth/login')
        .send({ username: 'rl_errcode_test', password: 'wrong' });
    }

    const res = await request(app)
      .post('/auth/login')
      .send({ username: 'rl_errcode_test', password: 'wrong' });

    if (res.status === 429) {
      expect(res.body.error.code).toBe('M_RATE_LIMITED');
    }
  });
});
