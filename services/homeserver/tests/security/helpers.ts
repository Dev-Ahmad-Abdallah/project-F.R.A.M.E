/**
 * Shared helpers for security tests.
 *
 * Builds a real Express app with the full middleware stack (helmet, cors,
 * body-parser, error handler, auth, rate limiting, validation) but mocks
 * all database and Redis calls so tests run without infrastructure.
 */

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import { errorHandler, asyncHandler, ApiError } from '../../src/middleware/errorHandler';
import { requireAuth } from '../../src/middleware/auth';
import { authRouter } from '../../src/routes/auth';
import { federationRouter } from '../../src/routes/federation';
import { healthRouter } from '../../src/routes/health';
import { keysRouter } from '../../src/routes/keys';
import { messagesRouter } from '../../src/routes/messages';
import { devicesRouter } from '../../src/routes/devices';
import { roomsRouter } from '../../src/routes/rooms';
import { pushRouter } from '../../src/routes/push';
import { apiLimiter } from '../../src/middleware/rateLimit';

export const TEST_JWT_SECRET = 'test-secret-minimum-32-characters-long-for-validation';
export const TEST_DOMAIN = 'test.local';

/**
 * Sign a valid access token for testing authenticated endpoints.
 */
export function signTestAccessToken(
  sub = '@testuser:test.local',
  deviceId = 'TESTDEVICE01',
  expiresIn: string | number = '15m',
): string {
  return jwt.sign(
    { sub, deviceId, iss: TEST_DOMAIN },
    TEST_JWT_SECRET,
    { algorithm: 'HS256', expiresIn },
  );
}

/**
 * Sign a refresh token (type: 'refresh') for testing token-type confusion.
 */
export function signTestRefreshToken(
  sub = '@testuser:test.local',
  deviceId = 'TESTDEVICE01',
): string {
  return jwt.sign(
    { sub, deviceId, type: 'refresh', iss: TEST_DOMAIN },
    TEST_JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '7d' },
  );
}

/**
 * Sign a token with an arbitrary secret (for testing signature rejection).
 */
export function signTokenWithSecret(
  secret: string,
  payload: Record<string, unknown> = {},
  expiresIn: string | number = '15m',
): string {
  return jwt.sign(
    { sub: '@attacker:evil.local', deviceId: 'EVIL01', iss: TEST_DOMAIN, ...payload },
    secret,
    { algorithm: 'HS256', expiresIn },
  );
}
