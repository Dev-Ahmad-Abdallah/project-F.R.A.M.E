import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { getConfig } from '../config';
import { createUser, findUserByUsername, userExists } from '../db/queries/users';
import { createDevice, findDevice, countDevicesByUser } from '../db/queries/devices';
import { upsertKeyBundle } from '../db/queries/keys';
import { addKeyToLog } from './merkleTree';
import { pool } from '../db/pool';
import { logger } from '../logger';
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
    { sub: userId, deviceId, type: 'refresh', iss: config.HOMESERVER_DOMAIN },
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
  // Enforce device limit atomically using a transaction with row-level locking
  // to prevent concurrent logins from bypassing the 10-device limit.
  const existingDevice = await findDevice(deviceId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (!existingDevice) {
      // Lock the user's device rows first, then count
      await client.query('SELECT device_id FROM devices WHERE user_id = $1 FOR UPDATE', [user.user_id]);
      const countResult = await client.query<{ count: number }>(
        'SELECT COUNT(*)::int as count FROM devices WHERE user_id = $1',
        [user.user_id]
      );
      const deviceCount = countResult.rows[0].count;

      if (deviceCount >= 10) {
        // Auto-evict oldest devices instead of blocking login
        // This prevents users from being permanently locked out after testing/multi-device usage
        const evictCount = deviceCount - 8; // Keep 8, make room for 2 new
        // Find oldest devices to evict
        const staleDevices = await client.query<{ device_id: string }>(
          `SELECT device_id FROM devices
           WHERE user_id = $1
           ORDER BY last_seen ASC NULLS FIRST, created_at ASC
           LIMIT $2`,
          [user.user_id, evictCount]
        );
        const staleIds = staleDevices.rows.map((r) => r.device_id);
        if (staleIds.length > 0) {
          // Clean up ALL foreign key references before deleting devices
          await client.query(`DELETE FROM delivery_state WHERE device_id = ANY($1::text[])`, [staleIds]);
          await client.query(`DELETE FROM key_bundles WHERE device_id = ANY($1::text[])`, [staleIds]);
          await client.query(`DELETE FROM refresh_tokens WHERE device_id = ANY($1::text[])`, [staleIds]);
          await client.query(`DELETE FROM to_device_messages WHERE recipient_device_id = ANY($1::text[])`, [staleIds]);
          await client.query(`DELETE FROM devices WHERE device_id = ANY($1::text[])`, [staleIds]);
        }
        logger.info(`Auto-evicted ${evictCount} stale device(s) for ${user.user_id}`);
      }
    }

    // Create device within same transaction — uses ON CONFLICT DO NOTHING for idempotency
    await client.query(
      'INSERT INTO devices (device_id, user_id, device_public_key, device_signing_key, display_name) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (device_id) DO NOTHING',
      [deviceId, user.user_id, 'pending', 'pending', `${username}'s device`]
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

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
      issuer: config.HOMESERVER_DOMAIN,
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

// ── Guest session ──

export interface GuestResult {
  accessToken: string;
  userId: string;
  deviceId: string;
  homeserver: string;
  guest: true;
}

/**
 * Create a temporary guest session.
 *
 * - Username: `guest_` + 8 random hex chars
 * - No password required
 * - Access token expires in 1 hour (no refresh token)
 * - Guest user record is created with a random password hash (unusable)
 * - Guest accounts tracked via Redis TTL (24-hour expiry)
 */
export async function createGuestSession(): Promise<GuestResult> {
  const suffix = crypto.randomBytes(4).toString('hex');
  const username = `guest_${suffix}`;
  const userId = `@${username}:${config.HOMESERVER_DOMAIN}`;

  // Create a placeholder password hash (guest cannot log in with a password)
  const placeholderHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 4);

  // Create the guest user in the database and mark as guest
  await createUser(userId, username, placeholderHash, config.HOMESERVER_DOMAIN);
  await pool.query('UPDATE users SET is_guest = true WHERE user_id = $1', [userId]);

  // Generate a device for the guest
  const deviceId = generateDeviceId();
  const guestIdentityKey = crypto.randomBytes(32).toString('base64');
  await createDevice(deviceId, userId, guestIdentityKey, guestIdentityKey, `${username}'s device`);

  // Sign a short-lived access token with guest claim (1 hour, no refresh)
  const payload: Omit<AuthPayload, 'iat' | 'exp'> & { guest: true } = {
    sub: userId,
    deviceId,
    iss: config.HOMESERVER_DOMAIN,
    guest: true,
  };

  const accessToken = jwt.sign(payload, config.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: '1h',
  });

  // Track guest expiry in Redis (24 hours) — allows cleanup of guest accounts
  const { redisClient } = await import('../redis/client');
  await redisClient.set(`guest:${userId}`, '1', 'EX', 86400);

  return {
    accessToken,
    userId,
    deviceId,
    homeserver: config.HOMESERVER_DOMAIN,
    guest: true,
  };
}

/**
 * Clean up a single guest user by removing all their associated data.
 *
 * Removes room memberships, delivery state, key bundles, to-device messages,
 * refresh tokens, and devices. The user record itself is kept (with data cleared)
 * to preserve message history references.
 */
export async function cleanupGuestUser(userId: string): Promise<void> {
  // Remove from all rooms
  await pool.query('DELETE FROM room_members WHERE user_id = $1', [userId]);
  // Delete delivery state for user's devices
  await pool.query(
    'DELETE FROM delivery_state WHERE device_id IN (SELECT device_id FROM devices WHERE user_id = $1)',
    [userId],
  );
  // Delete key bundles for user's devices
  await pool.query(
    'DELETE FROM key_bundles WHERE device_id IN (SELECT device_id FROM devices WHERE user_id = $1)',
    [userId],
  );
  // Delete refresh tokens
  await pool.query('DELETE FROM refresh_tokens WHERE user_id = $1', [userId]);
  // Delete to-device messages
  await pool.query('DELETE FROM to_device_messages WHERE recipient_user_id = $1', [userId]);
  // Delete devices
  await pool.query('DELETE FROM devices WHERE user_id = $1', [userId]);
  // Mark user as inactive (don't delete — preserve message history)
}

/**
 * Clean up expired guest accounts.
 *
 * Finds guest users (is_guest = true OR username starts with "guest_") that are
 * older than 24 hours and no longer tracked in Redis (TTL expired). Cleans up
 * their devices, key bundles, room memberships, and delivery state so stale
 * key material does not persist.
 *
 * Should be called periodically (e.g. every hour).
 */
export async function cleanupExpiredGuests(): Promise<number> {
  const { redisClient } = await import('../redis/client');

  // Find guest users older than 24 hours (using both is_guest flag and username pattern)
  const guestResult = await pool.query<{ user_id: string }>(
    `SELECT user_id FROM users
     WHERE (is_guest = true OR username LIKE 'guest_%')
       AND created_at < NOW() - INTERVAL '24 hours'`,
  );

  let cleanedCount = 0;

  for (const row of guestResult.rows) {
    // Only clean up if the Redis tracking key has expired
    const tracked = await redisClient.exists(`guest:${row.user_id}`);
    if (tracked) continue;

    await cleanupGuestUser(row.user_id);
    cleanedCount++;
  }

  if (cleanedCount > 0) {
    console.info(`[F.R.A.M.E.] Cleaned up ${cleanedCount} expired guest account(s).`);
  }

  return cleanedCount;
}

// Run guest cleanup every hour
const guestCleanupTimer = setInterval(() => {
  cleanupExpiredGuests().catch((err: unknown) =>
    console.error('[F.R.A.M.E.] Guest cleanup error:', err),
  );
}, 60 * 60 * 1000);

/** Stop the guest cleanup interval (call on shutdown). */
export function stopGuestCleanup(): void {
  clearInterval(guestCleanupTimer);
}
