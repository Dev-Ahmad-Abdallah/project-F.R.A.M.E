/**
 * Data Security Tests
 *
 * Validates that error responses do not leak internal details in production
 * mode, that health endpoints do not expose sensitive information, and that
 * the server never logs message content.
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
import fs from 'fs';
import path from 'path';
import { app } from '../../src/server';

// ── Test Suites ──

describe('Data Security: Error Response Sanitization', () => {
  it('error responses in production mode do not leak stack traces', () => {
    // Test the errorHandler middleware directly in production mode
    const { errorHandler } = require('../../src/middleware/errorHandler');

    // Simulate production mode
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const mockError = new Error('Something broke internally');
    (mockError as any).statusCode = 500;
    (mockError as any).code = 'M_UNKNOWN';

    const mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    const mockReq = {} as any;
    const mockNext = jest.fn();

    errorHandler(mockError, mockReq, mockRes, mockNext);

    // Verify the response
    expect(mockRes.status).toHaveBeenCalledWith(500);
    const responseBody = mockRes.json.mock.calls[0][0];

    // In production, the error message should be generic, not the actual error
    expect(responseBody.error.message).toBe('Internal server error');
    expect(responseBody.error.message).not.toContain('Something broke internally');

    // Response should not contain stack trace
    expect(JSON.stringify(responseBody)).not.toContain('at ');
    expect(JSON.stringify(responseBody)).not.toContain('.ts:');
    expect(JSON.stringify(responseBody)).not.toContain('.js:');
    expect(responseBody).not.toHaveProperty('stack');

    process.env.NODE_ENV = originalEnv;
  });

  it('400 errors in production mode use generic message', () => {
    const { errorHandler } = require('../../src/middleware/errorHandler');

    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const mockError = new Error('SQL error: relation "users" does not exist');
    (mockError as any).statusCode = 400;
    (mockError as any).code = 'M_BAD_JSON';

    const mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    errorHandler(mockError, {} as any, mockRes, jest.fn());

    const responseBody = mockRes.json.mock.calls[0][0];
    expect(responseBody.error.message).toBe('Bad request');
    expect(responseBody.error.message).not.toContain('SQL');
    expect(responseBody.error.message).not.toContain('relation');

    process.env.NODE_ENV = originalEnv;
  });

  it('error responses never include database connection details', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ username: null, password: null });

    const body = JSON.stringify(res.body).toLowerCase();
    expect(body).not.toContain('postgresql');
    expect(body).not.toContain('econnrefused');
    expect(body).not.toContain('pg_');
    // Check for DB credential patterns (not the word "password" in validation messages)
    expect(body).not.toMatch(/password_hash/i);
    expect(body).not.toMatch(/postgres:\/\//);
    expect(body).not.toMatch(/localhost:\d{4}/);
  });
});

describe('Data Security: Health Endpoint Information Exposure', () => {
  it('health endpoint does not expose database credentials', async () => {
    const res = await request(app).get('/health');

    const body = JSON.stringify(res.body);

    // Must not contain DB connection strings or credentials
    expect(body).not.toContain('postgresql://');
    expect(body).not.toContain('postgres://');
    expect(body).not.toContain('DATABASE_URL');
    expect(body).not.toContain('password');
    expect(body).not.toContain('JWT_SECRET');
    expect(body).not.toContain('FEDERATION_SIGNING_KEY');
    expect(body).not.toContain('REDIS_URL');
    expect(body).not.toContain('redis://');
  });

  it('health endpoint only exposes status, uptime, version, and service status', async () => {
    const res = await request(app).get('/health');
    const body = res.body;

    // Allowed fields
    const allowedKeys = ['status', 'uptime', 'version', 'services'];
    const actualKeys = Object.keys(body);

    // Every key in the response should be in the allowed list
    actualKeys.forEach((key) => {
      expect(allowedKeys).toContain(key);
    });

    // Services should only report connected/disconnected
    if (body.services) {
      Object.values(body.services).forEach((value) => {
        expect(['connected', 'disconnected']).toContain(value);
      });
    }
  });

  it('root info endpoint does not expose environment variables', async () => {
    const res = await request(app).get('/');
    const body = JSON.stringify(res.body);

    expect(body).not.toContain('JWT_SECRET');
    expect(body).not.toContain('DATABASE_URL');
    expect(body).not.toContain('REDIS_URL');
    expect(body).not.toContain('FEDERATION_SIGNING_KEY');
  });
});

describe('Data Security: Server Never Logs Message Content', () => {
  it('request logger does not include message body or content fields', () => {
    // Examine the request logging middleware in server.ts
    // The logger only logs: method, path, status, ms, userId
    // It never logs req.body (which would contain message content)

    const serverSource = fs.readFileSync(
      path.join(__dirname, '../../src/server.ts'),
      'utf-8',
    );

    // Find the request logging section — the block that calls logger.info('request', ...)
    // Use a narrower regex to capture just the logging callback
    const logSection = serverSource.match(/res\.on\('finish',\s*\(\)\s*=>\s*\{[\s\S]*?logger\.info\('request'[\s\S]*?\}\);/);
    expect(logSection).not.toBeNull();

    if (logSection) {
      const logCode = logSection[0];

      // The request logger must not log req.body (which contains message content)
      expect(logCode).not.toContain('req.body');
      expect(logCode).not.toContain('body');
      // Check for message content specifically (not "content" as a substring
      // of "contentSecurityPolicy" which appears elsewhere in server.ts)
      expect(logCode).not.toMatch(/\bcontent\b/);

      // It should only log safe metadata
      expect(logCode).toContain('req.method');
      expect(logCode).toContain('req.path');
      expect(logCode).toContain('res.statusCode');
    }
  });

  it('logger module does not contain message content logging patterns', () => {
    const loggerSource = fs.readFileSync(
      path.join(__dirname, '../../src/logger.ts'),
      'utf-8',
    );

    // The logger should not have any patterns for logging message content
    expect(loggerSource).not.toContain('messageContent');
    expect(loggerSource).not.toContain('plaintext');
    expect(loggerSource).not.toContain('decrypted');
  });

  it('message service does not log message content', () => {
    // Read the route file to verify it does not log message content
    const messagesRouteSource = fs.readFileSync(
      path.join(__dirname, '../../src/routes/messages.ts'),
      'utf-8',
    );

    // Routes should not log request bodies containing message content
    expect(messagesRouteSource).not.toContain('logger.info(');
    // If there is logging, ensure it does not include content/body
    const logCalls = messagesRouteSource.match(/logger\.\w+\([^)]*\)/g) || [];
    logCalls.forEach((call) => {
      expect(call).not.toContain('req.body');
      expect(call).not.toContain('content');
    });
  });
});

describe('Data Security: Security Headers', () => {
  it('responses include security headers from helmet', async () => {
    const res = await request(app).get('/health');

    // Helmet sets these by default
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
  });

  it('content-security-policy is set', async () => {
    const res = await request(app).get('/health');

    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
  });
});
