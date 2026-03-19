/**
 * Push Routes unit tests.
 *
 * Tests the push notification endpoints using supertest with
 * mocked database and config dependencies.
 */

import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const JWT_SECRET = 'test-secret-that-is-at-least-32-chars-long!!';
const HOMESERVER_DOMAIN = 'test.frame.local';

// ── Mocks must be declared before imports ──

const mockPoolQuery = jest.fn();

jest.mock('../../src/db/pool', () => ({
  pool: { query: (...args: any[]) => mockPoolQuery(...args) },
}));

let mockVapidPublicKey: string | undefined = 'BLTest-VAPID-Public-Key-For-Testing';

jest.mock('../../src/config', () => ({
  getConfig: () => ({
    HOMESERVER_DOMAIN,
    JWT_SECRET,
    BCRYPT_SALT_ROUNDS: 10,
    FEDERATION_SIGNING_KEY: 'fake-key',
    FEDERATION_PEERS: '',
    DATABASE_URL: 'postgres://localhost/test',
    REDIS_URL: 'redis://localhost',
    PORT: 3000,
    NODE_ENV: 'test',
    CORS_ORIGINS: '',
    DB_SSL_REJECT_UNAUTHORIZED: false,
    get VAPID_PUBLIC_KEY() {
      return mockVapidPublicKey;
    },
  }),
}));

jest.mock('../../src/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

import { pushRouter } from '../../src/routes/push';
import { errorHandler } from '../../src/middleware/errorHandler';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/push', pushRouter);
  app.use(errorHandler);
  return app;
}

function makeAccessToken(userId: string, deviceId: string): string {
  return jwt.sign(
    { sub: userId, deviceId, iss: HOMESERVER_DOMAIN },
    JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '15m' },
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockVapidPublicKey = 'BLTest-VAPID-Public-Key-For-Testing';
});

// ── GET /push/vapid-key ──

describe('GET /push/vapid-key', () => {
  it('returns public key when configured', async () => {
    const app = createApp();
    const token = makeAccessToken('@alice:test.frame.local', 'DEV1');

    const res = await request(app)
      .get('/push/vapid-key')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.publicKey).toBe('BLTest-VAPID-Public-Key-For-Testing');
  });

  it('returns 503 when VAPID key is not configured', async () => {
    mockVapidPublicKey = undefined;
    const app = createApp();
    const token = makeAccessToken('@alice:test.frame.local', 'DEV1');

    const res = await request(app)
      .get('/push/vapid-key')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('M_NOT_CONFIGURED');
  });

  it('returns 401 without auth token', async () => {
    const app = createApp();

    const res = await request(app).get('/push/vapid-key');

    expect(res.status).toBe(401);
  });
});

// ── POST /push/subscribe ──

describe('POST /push/subscribe', () => {
  it('saves subscription and returns 201', async () => {
    const app = createApp();
    const token = makeAccessToken('@alice:test.frame.local', 'DEV1');
    mockPoolQuery.mockResolvedValue({ rowCount: 1, rows: [] });

    const res = await request(app)
      .post('/push/subscribe')
      .set('Authorization', `Bearer ${token}`)
      .send({
        endpoint: 'https://push.example.com/v1/abc',
        keys: {
          p256dh: 'test-p256dh-key',
          auth: 'test-auth-key',
        },
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);

    // Verify the upsert query was called with correct params
    expect(mockPoolQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockPoolQuery.mock.calls[0];
    expect(sql).toContain('INSERT INTO push_subscriptions');
    expect(params).toEqual([
      '@alice:test.frame.local',
      'DEV1',
      'https://push.example.com/v1/abc',
      'test-p256dh-key',
      'test-auth-key',
    ]);
  });

  it('returns 400 for invalid subscription body', async () => {
    const app = createApp();
    const token = makeAccessToken('@alice:test.frame.local', 'DEV1');

    const res = await request(app)
      .post('/push/subscribe')
      .set('Authorization', `Bearer ${token}`)
      .send({
        endpoint: 'not-a-valid-url',
        keys: { p256dh: '', auth: '' },
      });

    expect(res.status).toBe(400);
  });

  it('returns 401 without auth token', async () => {
    const app = createApp();

    const res = await request(app)
      .post('/push/subscribe')
      .send({
        endpoint: 'https://push.example.com/v1/abc',
        keys: { p256dh: 'key', auth: 'auth' },
      });

    expect(res.status).toBe(401);
  });
});

// ── DELETE /push/unsubscribe ──

describe('DELETE /push/unsubscribe', () => {
  it('removes subscription and returns success', async () => {
    const app = createApp();
    const token = makeAccessToken('@alice:test.frame.local', 'DEV1');
    mockPoolQuery.mockResolvedValue({ rowCount: 1, rows: [] });

    const res = await request(app)
      .delete('/push/unsubscribe')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    expect(mockPoolQuery).toHaveBeenCalledWith(
      'DELETE FROM push_subscriptions WHERE user_id = $1 AND device_id = $2',
      ['@alice:test.frame.local', 'DEV1'],
    );
  });

  it('returns 404 when no subscription exists', async () => {
    const app = createApp();
    const token = makeAccessToken('@alice:test.frame.local', 'DEV1');
    mockPoolQuery.mockResolvedValue({ rowCount: 0, rows: [] });

    const res = await request(app)
      .delete('/push/unsubscribe')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('M_NOT_FOUND');
  });

  it('returns 401 without auth token', async () => {
    const app = createApp();

    const res = await request(app).delete('/push/unsubscribe');

    expect(res.status).toBe(401);
  });
});
