/**
 * Auth Service unit tests.
 *
 * All external dependencies (DB pool, bcrypt, config, DB query helpers,
 * merkleTree) are mocked so tests run without infrastructure.
 */

// ── Mocks must be declared before imports ──

const mockPoolQuery = jest.fn();

jest.mock('../../src/db/pool', () => ({
  pool: { query: (...args: any[]) => mockPoolQuery(...args) },
}));

jest.mock('../../src/config', () => ({
  getConfig: () => ({
    JWT_SECRET: 'test-secret-that-is-at-least-32-chars-long!!',
    BCRYPT_SALT_ROUNDS: 10,
    HOMESERVER_DOMAIN: 'test.frame.local',
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

const mockUserExists = jest.fn();
const mockCreateUser = jest.fn();
const mockFindUserByUsername = jest.fn();

jest.mock('../../src/db/queries/users', () => ({
  userExists: (...args: any[]) => mockUserExists(...args),
  createUser: (...args: any[]) => mockCreateUser(...args),
  findUserByUsername: (...args: any[]) => mockFindUserByUsername(...args),
}));

const mockCreateDevice = jest.fn();
const mockFindDevice = jest.fn();
const mockCountDevicesByUser = jest.fn();

jest.mock('../../src/db/queries/devices', () => ({
  createDevice: (...args: any[]) => mockCreateDevice(...args),
  findDevice: (...args: any[]) => mockFindDevice(...args),
  countDevicesByUser: (...args: any[]) => mockCountDevicesByUser(...args),
}));

const mockUpsertKeyBundle = jest.fn();

jest.mock('../../src/db/queries/keys', () => ({
  upsertKeyBundle: (...args: any[]) => mockUpsertKeyBundle(...args),
}));

const mockAddKeyToLog = jest.fn();

jest.mock('../../src/services/merkleTree', () => ({
  addKeyToLog: (...args: any[]) => mockAddKeyToLog(...args),
}));

import { register, login, refreshAccessToken, revokeAllTokens } from '../../src/services/authService';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';

const JWT_SECRET = 'test-secret-that-is-at-least-32-chars-long!!';

beforeEach(() => {
  jest.clearAllMocks();
  // Default: pool.query succeeds
  mockPoolQuery.mockResolvedValue({ rowCount: 1, rows: [] });
  // Default: user has 0 devices (under the 10-device limit)
  mockCountDevicesByUser.mockResolvedValue(0);
});

// ── register() ──

describe('register', () => {
  const params = {
    username: 'alice',
    password: 'securePass123',
    identityKey: 'idkey',
    signedPrekey: 'spk',
    signedPrekeySig: 'sig',
    oneTimePrekeys: ['otk1', 'otk2'],
  };

  it('creates user with hashed password and returns tokens', async () => {
    mockUserExists.mockResolvedValue(false);
    mockCreateUser.mockResolvedValue(undefined);
    mockCreateDevice.mockResolvedValue(undefined);
    mockUpsertKeyBundle.mockResolvedValue(undefined);
    mockAddKeyToLog.mockResolvedValue(undefined);

    const result = await register(params);

    // Should check if user exists
    expect(mockUserExists).toHaveBeenCalledWith('alice');

    // Should hash password (not store plaintext)
    expect(mockCreateUser).toHaveBeenCalledTimes(1);
    const storedHash = mockCreateUser.mock.calls[0][2];
    expect(storedHash).not.toBe(params.password);
    expect(await bcrypt.compare(params.password, storedHash)).toBe(true);

    // Should create device
    expect(mockCreateDevice).toHaveBeenCalledTimes(1);

    // Should store key bundle
    expect(mockUpsertKeyBundle).toHaveBeenCalledTimes(1);

    // Should add key to transparency log
    expect(mockAddKeyToLog).toHaveBeenCalledWith(
      expect.stringContaining('@alice:test.frame.local'),
      'idkey',
    );

    // Result should have valid tokens
    expect(result.userId).toBe('@alice:test.frame.local');
    expect(result.homeserver).toBe('test.frame.local');
    expect(result.deviceId).toBeTruthy();
    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();

    // Access token should be a valid JWT
    const decoded = jwt.verify(result.accessToken, JWT_SECRET) as any;
    expect(decoded.sub).toBe('@alice:test.frame.local');
    expect(decoded.deviceId).toBe(result.deviceId);
  });

  it('throws 409 if username already exists', async () => {
    mockUserExists.mockResolvedValue(true);
    await expect(register(params)).rejects.toMatchObject({
      statusCode: 409,
      code: 'M_USER_EXISTS',
    });
  });

  it('generates a unique device ID', async () => {
    mockUserExists.mockResolvedValue(false);
    mockCreateUser.mockResolvedValue(undefined);
    mockCreateDevice.mockResolvedValue(undefined);
    mockUpsertKeyBundle.mockResolvedValue(undefined);
    mockAddKeyToLog.mockResolvedValue(undefined);

    const r1 = await register(params);
    const r2 = await register({ ...params, username: 'bob' });
    // Device IDs should be hex strings
    expect(r1.deviceId).toMatch(/^[0-9A-F]{16}$/);
    // Extremely unlikely to collide (2^64 space)
    expect(r1.deviceId).not.toBe(r2.deviceId);
  });
});

// ── login() ──

describe('login', () => {
  const hashedPassword = bcrypt.hashSync('correctPassword', 10);

  it('returns tokens on valid credentials', async () => {
    mockFindUserByUsername.mockResolvedValue({
      user_id: '@bob:test.frame.local',
      username: 'bob',
      password_hash: hashedPassword,
    });
    mockFindDevice.mockResolvedValue(null);
    mockCreateDevice.mockResolvedValue(undefined);

    const result = await login({ username: 'bob', password: 'correctPassword' });

    expect(result.userId).toBe('@bob:test.frame.local');
    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
    expect(result.deviceId).toBeTruthy();
  });

  it('throws 401 for unknown user', async () => {
    mockFindUserByUsername.mockResolvedValue(null);

    await expect(
      login({ username: 'nobody', password: 'whatever' }),
    ).rejects.toMatchObject({
      statusCode: 401,
      code: 'M_FORBIDDEN',
    });
  });

  it('throws 401 for wrong password', async () => {
    mockFindUserByUsername.mockResolvedValue({
      user_id: '@bob:test.frame.local',
      username: 'bob',
      password_hash: hashedPassword,
    });

    await expect(
      login({ username: 'bob', password: 'wrongPassword' }),
    ).rejects.toMatchObject({
      statusCode: 401,
      code: 'M_FORBIDDEN',
    });
  });

  it('uses existing deviceId when provided', async () => {
    mockFindUserByUsername.mockResolvedValue({
      user_id: '@bob:test.frame.local',
      username: 'bob',
      password_hash: hashedPassword,
    });
    mockFindDevice.mockResolvedValue({ device_id: 'EXISTING_DEV' });

    const result = await login({
      username: 'bob',
      password: 'correctPassword',
      deviceId: 'EXISTING_DEV',
    });

    expect(result.deviceId).toBe('EXISTING_DEV');
    // createDevice uses INSERT ... ON CONFLICT DO NOTHING, so it's always called
    expect(mockCreateDevice).toHaveBeenCalled();
  });

  it('creates device record when deviceId does not exist', async () => {
    mockFindUserByUsername.mockResolvedValue({
      user_id: '@bob:test.frame.local',
      username: 'bob',
      password_hash: hashedPassword,
    });
    mockFindDevice.mockResolvedValue(null);
    mockCreateDevice.mockResolvedValue(undefined);

    const result = await login({
      username: 'bob',
      password: 'correctPassword',
      deviceId: 'NEW_DEV',
    });

    expect(result.deviceId).toBe('NEW_DEV');
    expect(mockCreateDevice).toHaveBeenCalledTimes(1);
  });
});

// ── refreshAccessToken() ──

describe('refreshAccessToken', () => {
  it('rotates tokens when refresh token is valid', async () => {
    // Create a real refresh token
    const refreshToken = jwt.sign(
      { sub: '@alice:test.frame.local', deviceId: 'DEV1', type: 'refresh', iss: 'test.frame.local' },
      JWT_SECRET,
      { algorithm: 'HS256', expiresIn: '7d' },
    );

    // Mock: token exists in DB
    mockPoolQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ '?column?': 1 }] }) // SELECT check
      .mockResolvedValueOnce({ rowCount: 1, rows: [] }) // DELETE old token
      .mockResolvedValueOnce({ rowCount: 1, rows: [] }); // INSERT new token

    const result = await refreshAccessToken(refreshToken);

    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
    // New access token should be for the same user
    const decoded = jwt.verify(result.accessToken, JWT_SECRET) as any;
    expect(decoded.sub).toBe('@alice:test.frame.local');
    expect(decoded.deviceId).toBe('DEV1');
  });

  it('rejects revoked/expired refresh token', async () => {
    const refreshToken = jwt.sign(
      { sub: '@alice:test.frame.local', deviceId: 'DEV1', type: 'refresh' },
      JWT_SECRET,
      { algorithm: 'HS256', expiresIn: '7d' },
    );

    // Mock: token NOT found in DB (revoked)
    mockPoolQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    await expect(refreshAccessToken(refreshToken)).rejects.toMatchObject({
      statusCode: 401,
      code: 'M_INVALID_TOKEN',
    });
  });

  it('rejects an access token used as refresh token', async () => {
    const accessToken = jwt.sign(
      { sub: '@alice:test.frame.local', deviceId: 'DEV1', iss: 'test.frame.local' },
      JWT_SECRET,
      { algorithm: 'HS256', expiresIn: '15m' },
    );

    // type !== 'refresh', so it should be rejected
    await expect(refreshAccessToken(accessToken)).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it('rejects token signed with wrong secret', async () => {
    const badToken = jwt.sign(
      { sub: '@alice:test.frame.local', deviceId: 'DEV1', type: 'refresh' },
      'wrong-secret-that-is-long-enough-to-be-valid',
      { algorithm: 'HS256', expiresIn: '7d' },
    );

    await expect(refreshAccessToken(badToken)).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it('rejects expired refresh token', async () => {
    const expiredToken = jwt.sign(
      { sub: '@alice:test.frame.local', deviceId: 'DEV1', type: 'refresh' },
      JWT_SECRET,
      { algorithm: 'HS256', expiresIn: '0s' },
    );

    // Small delay to ensure expiration
    await new Promise((r) => setTimeout(r, 50));

    await expect(refreshAccessToken(expiredToken)).rejects.toMatchObject({
      statusCode: 401,
    });
  });
});

// ── revokeAllTokens() ──

describe('revokeAllTokens', () => {
  it('deletes all refresh tokens for user', async () => {
    mockPoolQuery.mockResolvedValue({ rowCount: 3, rows: [] });

    await revokeAllTokens('@alice:test.frame.local');

    expect(mockPoolQuery).toHaveBeenCalledWith(
      'DELETE FROM refresh_tokens WHERE user_id = $1',
      ['@alice:test.frame.local'],
    );
  });

  it('succeeds even when user has no tokens', async () => {
    mockPoolQuery.mockResolvedValue({ rowCount: 0, rows: [] });

    await expect(revokeAllTokens('@nobody:test.frame.local')).resolves.toBeUndefined();
  });

  it('deletes all tokens regardless of device', async () => {
    mockPoolQuery.mockResolvedValue({ rowCount: 5, rows: [] });

    await revokeAllTokens('@alice:test.frame.local');

    // Should issue a single DELETE for all tokens belonging to the user
    expect(mockPoolQuery).toHaveBeenCalledTimes(1);
    expect(mockPoolQuery).toHaveBeenCalledWith(
      'DELETE FROM refresh_tokens WHERE user_id = $1',
      ['@alice:test.frame.local'],
    );
  });
});

// ── refresh token rotation ──

describe('refresh token rotation', () => {
  it('deletes old token and creates new one during rotation', async () => {
    const refreshToken = jwt.sign(
      { sub: '@alice:test.frame.local', deviceId: 'DEV1', type: 'refresh', iss: 'test.frame.local' },
      JWT_SECRET,
      { algorithm: 'HS256', expiresIn: '7d' },
    );

    // Mock: SELECT check passes, DELETE old, INSERT new
    mockPoolQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ '?column?': 1 }] }) // SELECT check
      .mockResolvedValueOnce({ rowCount: 1, rows: [] }) // DELETE old token
      .mockResolvedValueOnce({ rowCount: 1, rows: [] }); // INSERT new token

    const result = await refreshAccessToken(refreshToken);

    // Old token should be deleted (second call)
    expect(mockPoolQuery).toHaveBeenCalledTimes(3);
    expect(mockPoolQuery.mock.calls[1][0]).toBe('DELETE FROM refresh_tokens WHERE token_hash = $1');

    // New token should be stored (third call)
    expect(mockPoolQuery.mock.calls[2][0]).toContain('INSERT INTO refresh_tokens');

    // New tokens should be valid JWTs
    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
    // Verify the new refresh token is a valid JWT
    const decoded = jwt.verify(result.refreshToken, JWT_SECRET) as any;
    expect(decoded.sub).toBe('@alice:test.frame.local');
    expect(decoded.type).toBe('refresh');
  });

  it('issues a new valid refresh token during rotation', async () => {
    const refreshToken = jwt.sign(
      { sub: '@alice:test.frame.local', deviceId: 'DEV1', type: 'refresh', iss: 'test.frame.local' },
      JWT_SECRET,
      { algorithm: 'HS256', expiresIn: '7d' },
    );

    mockPoolQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const result = await refreshAccessToken(refreshToken);

    // New refresh token should be a valid JWT with correct claims
    const newDecoded = jwt.verify(result.refreshToken, JWT_SECRET) as any;
    expect(newDecoded.sub).toBe('@alice:test.frame.local');
    expect(newDecoded.deviceId).toBe('DEV1');
    expect(newDecoded.type).toBe('refresh');

    // New access token should also be valid
    const accessDecoded = jwt.verify(result.accessToken, JWT_SECRET) as any;
    expect(accessDecoded.sub).toBe('@alice:test.frame.local');
  });

  it('new access token preserves user and device from original', async () => {
    const refreshToken = jwt.sign(
      { sub: '@bob:test.frame.local', deviceId: 'MYDEV42', type: 'refresh', iss: 'test.frame.local' },
      JWT_SECRET,
      { algorithm: 'HS256', expiresIn: '7d' },
    );

    mockPoolQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const result = await refreshAccessToken(refreshToken);

    const decoded = jwt.verify(result.accessToken, JWT_SECRET) as any;
    expect(decoded.sub).toBe('@bob:test.frame.local');
    expect(decoded.deviceId).toBe('MYDEV42');
  });
});
