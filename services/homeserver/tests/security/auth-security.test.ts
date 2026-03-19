/**
 * Authentication Security Tests
 *
 * Validates JWT handling, brute-force protection, input sanitization,
 * and password policy enforcement against the real Express middleware stack.
 */

// ── Mocks (must be declared before imports) ──

const mockPoolQuery = jest.fn().mockResolvedValue({ rowCount: 0, rows: [] });
const mockPoolEnd = jest.fn().mockResolvedValue(undefined);

jest.mock('../../src/db/pool', () => ({
  pool: {
    query: (...args: unknown[]) => mockPoolQuery(...args),
    end: () => mockPoolEnd(),
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
  updateDisplayName: jest.fn().mockResolvedValue({ user_id: '@test:test.local', display_name: 'Test' }),
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
import jwt from 'jsonwebtoken';
import { app } from '../../src/server';

const JWT_SECRET = 'test-secret-minimum-32-characters-long-for-validation';
const DOMAIN = 'test.local';

// ── Test Suites ──

describe('Auth Security: JWT Validation', () => {
  it('rejects an expired JWT with 401', async () => {
    // Sign a token that expired 1 second ago
    const expiredToken = jwt.sign(
      { sub: '@user:test.local', deviceId: 'DEV01', iss: DOMAIN },
      JWT_SECRET,
      { algorithm: 'HS256', expiresIn: '0s' },
    );

    // Small delay to ensure it is expired
    await new Promise((r) => setTimeout(r, 50));

    const res = await request(app)
      .get('/rooms')
      .set('Authorization', `Bearer ${expiredToken}`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toMatch(/M_TOKEN_EXPIRED|M_INVALID_TOKEN/);
  });

  it('rejects a refresh token used as an access token', async () => {
    const refreshToken = jwt.sign(
      { sub: '@user:test.local', deviceId: 'DEV01', type: 'refresh', iss: DOMAIN },
      JWT_SECRET,
      { algorithm: 'HS256', expiresIn: '7d' },
    );

    const res = await request(app)
      .get('/rooms')
      .set('Authorization', `Bearer ${refreshToken}`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('M_INVALID_TOKEN');
  });

  it('rejects a JWT signed with the wrong secret', async () => {
    const badToken = jwt.sign(
      { sub: '@user:test.local', deviceId: 'DEV01', iss: DOMAIN },
      'completely-different-secret-that-is-long-enough',
      { algorithm: 'HS256', expiresIn: '15m' },
    );

    const res = await request(app)
      .get('/rooms')
      .set('Authorization', `Bearer ${badToken}`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('M_INVALID_TOKEN');
  });
});

describe('Auth Security: Brute Force Protection', () => {
  it('rate limits login after rapid attempts', async () => {
    // The loginLimiter allows 20 per 15min window per IP+username combo.
    // Send 21 requests rapidly — the last should be rate-limited.
    const responses: number[] = [];

    for (let i = 0; i < 21; i++) {
      const res = await request(app)
        .post('/auth/login')
        .send({ username: 'bruteforce_target', password: `wrong_${i}` });
      responses.push(res.status);
    }

    // At least one response should be 429 (rate limited)
    expect(responses).toContain(429);
  });
});

describe('Auth Security: SQL Injection Prevention', () => {
  const sqlPayloads = [
    "' OR '1'='1",
    "'; DROP TABLE users; --",
    "' UNION SELECT username, password_hash FROM users --",
    "admin'--",
    "') OR ('1'='1",
  ];

  sqlPayloads.forEach((payload) => {
    it(`blocks SQL injection in login username: ${payload.slice(0, 30)}...`, async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({ username: payload, password: 'anything' });

      // Must NOT succeed and must NOT expose DB internals
      expect(res.status).not.toBe(200);
      const body = JSON.stringify(res.body);
      expect(body).not.toMatch(/postgresql|sqlite|syntax error|relation|column/i);
    });
  });
});

describe('Auth Security: XSS Prevention', () => {
  const xssPayloads = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '"><script>document.cookie</script>',
    "javascript:alert('xss')",
  ];

  xssPayloads.forEach((payload) => {
    it(`sanitizes XSS in username at registration: ${payload.slice(0, 30)}...`, async () => {
      const res = await request(app).post('/auth/register').send({
        username: payload,
        password: 'SecurePass123!',
        identityKey: 'ik',
        signedPrekey: 'spk',
        signedPrekeySig: 'sig',
        oneTimePrekeys: ['otpk'],
      });

      // Username validation regex only allows [a-zA-Z0-9_-], so XSS must be rejected
      expect(res.status).toBe(400);

      // Response body should NOT reflect the payload back unescaped
      const body = JSON.stringify(res.body);
      expect(body).not.toContain('<script>');
      expect(body).not.toContain('onerror=');
    });
  });
});

describe('Auth Security: Weak Password Rejection', () => {
  it('rejects registration with password shorter than 8 characters', async () => {
    const res = await request(app).post('/auth/register').send({
      username: 'weakpassuser',
      password: 'short',  // 5 chars, below 8-char minimum
      identityKey: 'ik',
      signedPrekey: 'spk',
      signedPrekeySig: 'sig',
      oneTimePrekeys: ['otpk'],
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('rejects registration with 7-character password', async () => {
    const res = await request(app).post('/auth/register').send({
      username: 'weakpassuser2',
      password: '1234567',  // exactly 7 chars
      identityKey: 'ik',
      signedPrekey: 'spk',
      signedPrekeySig: 'sig',
      oneTimePrekeys: ['otpk'],
    });

    expect(res.status).toBe(400);
  });

  it('accepts registration with exactly 8-character password (minimum)', async () => {
    // This should pass validation (but may fail at DB level due to mock)
    const res = await request(app).post('/auth/register').send({
      username: 'goodpassuser',
      password: '12345678',  // exactly 8 chars, meets minimum
      identityKey: 'ik',
      signedPrekey: 'spk',
      signedPrekeySig: 'sig',
      oneTimePrekeys: ['otpk'],
    });

    // Should NOT be 400 (validation passes); may be 201 or 500 depending on mock
    expect(res.status).not.toBe(400);
  });
});
