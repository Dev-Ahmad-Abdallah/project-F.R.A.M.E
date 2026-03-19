import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { getConfig } from '../config';
import { createUser, findUserByUsername, userExists } from '../db/queries/users';
import { createDevice } from '../db/queries/devices';
import { upsertKeyBundle } from '../db/queries/keys';
import { addKeyToLog } from './merkleTree';
import { pool } from '../db/pool';
import { ApiError } from '../middleware/errorHandler';
import type { AuthPayload } from '../middleware/auth';

const config = getConfig();

export interface RegisterParams {
  username: string;
  password: string;
  identityKey: string;
  signedPrekey: string;
  signedPrekeySig: string;
  oneTimePrekeys: string[];
}

export interface LoginParams {
  username: string;
  password: string;
  deviceId?: string;
}

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  userId: string;
  deviceId: string;
  homeserver: string;
}

function generateDeviceId(): string {
  return crypto.randomBytes(8).toString('hex').toUpperCase();
}

function signAccessToken(userId: string, deviceId: string): string {
  const payload: Omit<AuthPayload, 'iat' | 'exp'> = {
    sub: userId,
    deviceId,
    iss: config.HOMESERVER_DOMAIN,
  };

  return jwt.sign(payload, config.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: '15m',
  });
}

async function signAndStoreRefreshToken(userId: string, deviceId: string): Promise<string> {
  const token = jwt.sign(
    { sub: userId, deviceId, type: 'refresh' },
    config.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '7d' }
  );

  // Store refresh token hash for revocation support (Security Finding 3)
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await pool.query(
    `INSERT INTO refresh_tokens (token_hash, user_id, device_id, expires_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (token_hash) DO NOTHING`,
    [tokenHash, userId, deviceId, expiresAt]
  );

  return token;
}

export async function register(params: RegisterParams): Promise<AuthResult> {
  const { username, password, identityKey, signedPrekey, signedPrekeySig, oneTimePrekeys } = params;

  // Check if user already exists
  if (await userExists(username)) {
    throw new ApiError(409, 'M_USER_EXISTS', 'Username already taken');
  }

  // Hash password
  const passwordHash = await bcrypt.hash(password, config.BCRYPT_SALT_ROUNDS);

  // Create user ID: @username:homeserver
  const userId = `@${username}:${config.HOMESERVER_DOMAIN}`;

  // Create user
  await createUser(userId, username, passwordHash, config.HOMESERVER_DOMAIN);

  // Generate device ID and create device
  const deviceId = generateDeviceId();
  await createDevice(deviceId, userId, identityKey, identityKey, `${username}'s device`);

  // Store key bundle
  await upsertKeyBundle(userId, deviceId, identityKey, signedPrekey, signedPrekeySig, oneTimePrekeys);

  // Add key to transparency log
  await addKeyToLog(userId, identityKey);

  // Generate tokens
  const accessToken = signAccessToken(userId, deviceId);
  const refreshToken = await signAndStoreRefreshToken(userId, deviceId);

  return {
    accessToken,
    refreshToken,
    userId,
    deviceId,
    homeserver: config.HOMESERVER_DOMAIN,
  };
}

export async function login(params: LoginParams): Promise<AuthResult> {
  const { username, password, deviceId: existingDeviceId } = params;

  // Find user
  const user = await findUserByUsername(username);
  if (!user) {
    throw new ApiError(401, 'M_FORBIDDEN', 'Invalid username or password');
  }

  // Verify password
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    throw new ApiError(401, 'M_FORBIDDEN', 'Invalid username or password');
  }

  // Use existing device ID or generate new one
  const deviceId = existingDeviceId || generateDeviceId();

  // Ensure the device exists in the database (create if new login device)
  // Uses INSERT ... ON CONFLICT DO NOTHING to prevent race conditions on concurrent logins
  await createDevice(deviceId, user.user_id, 'pending', 'pending', `${username}'s device`);

  // Generate tokens
  const accessToken = signAccessToken(user.user_id, deviceId);
  const refreshToken = await signAndStoreRefreshToken(user.user_id, deviceId);

  return {
    accessToken,
    refreshToken,
    userId: user.user_id,
    deviceId,
    homeserver: config.HOMESERVER_DOMAIN,
  };
}

export async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
  try {
    const payload = jwt.verify(refreshToken, config.JWT_SECRET, {
      algorithms: ['HS256'],
    }) as { sub: string; deviceId: string; type: string };

    if (payload.type !== 'refresh') {
      throw new ApiError(401, 'M_INVALID_TOKEN', 'Invalid token type');
    }

    // Verify refresh token exists in DB and is not revoked (Security Finding 3)
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const result = await pool.query(
      'SELECT 1 FROM refresh_tokens WHERE token_hash = $1 AND expires_at > NOW()',
      [tokenHash]
    );

    if (result.rowCount === 0) {
      throw new ApiError(401, 'M_INVALID_TOKEN', 'Refresh token has been revoked or expired');
    }

    // Rotate: invalidate old token, issue new one
    await pool.query('DELETE FROM refresh_tokens WHERE token_hash = $1', [tokenHash]);

    const accessToken = signAccessToken(payload.sub, payload.deviceId);
    const newRefreshToken = await signAndStoreRefreshToken(payload.sub, payload.deviceId);

    return { accessToken, refreshToken: newRefreshToken };
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(401, 'M_INVALID_TOKEN', 'Invalid or expired refresh token');
  }
}

// Revoke all refresh tokens for a user (on password change, logout, etc.)
export async function revokeAllTokens(userId: string): Promise<void> {
  await pool.query('DELETE FROM refresh_tokens WHERE user_id = $1', [userId]);
}
