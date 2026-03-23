import { pool } from '../pool';

export interface UserRow {
  user_id: string;
  username: string;
  password_hash: string;
  homeserver: string;
  display_name: string | null;
  created_at: Date;
  updated_at: Date;
}

export async function createUser(
  userId: string,
  username: string,
  passwordHash: string,
  homeserver: string
): Promise<UserRow> {
  const result = await pool.query<UserRow>(
    `INSERT INTO users (user_id, username, password_hash, homeserver)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [userId, username, passwordHash, homeserver]
  );
  return result.rows[0];
}

export async function findUserByUsername(username: string): Promise<UserRow | null> {
  const result = await pool.query<UserRow>(
    'SELECT * FROM users WHERE username = $1',
    [username]
  );
  return result.rows[0] || null;
}

export async function findUserById(userId: string): Promise<UserRow | null> {
  const result = await pool.query<UserRow>(
    'SELECT * FROM users WHERE user_id = $1',
    [userId]
  );
  return result.rows[0] || null;
}

export async function userExists(username: string): Promise<boolean> {
  const result = await pool.query(
    'SELECT 1 FROM users WHERE username = $1',
    [username]
  );
  return result.rowCount !== null && result.rowCount > 0;
}

export async function setMasterSigningKey(userId: string, masterSigningKey: string): Promise<void> {
  await pool.query(
    `UPDATE users SET master_signing_key = $2, updated_at = NOW()
     WHERE user_id = $1`,
    [userId, masterSigningKey]
  );
}

export async function getMasterSigningKey(userId: string): Promise<string | null> {
  const result = await pool.query<{ master_signing_key: string | null }>(
    'SELECT master_signing_key FROM users WHERE user_id = $1',
    [userId]
  );
  if (result.rows.length === 0) return null;
  return result.rows[0].master_signing_key;
}

/**
 * Check if blockerUserId has blocked blockedUserId.
 */
export async function isBlocked(blockerId: string, blockedId: string): Promise<boolean> {
  const result = await pool.query(
    'SELECT 1 FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2',
    [blockerId, blockedId],
  );
  return result.rows.length > 0;
}

/**
 * Get all user IDs blocked by a given user.
 */
export async function getBlockedUsers(blockerId: string): Promise<string[]> {
  const result = await pool.query<{ blocked_id: string }>(
    'SELECT blocked_id FROM user_blocks WHERE blocker_id = $1 ORDER BY created_at DESC',
    [blockerId],
  );
  return result.rows.map((r) => r.blocked_id);
}

/**
 * Block a user. Returns true if the block was newly created, false if already existed.
 */
export async function blockUser(blockerId: string, blockedId: string): Promise<boolean> {
  const result = await pool.query(
    `INSERT INTO user_blocks (blocker_id, blocked_id)
     VALUES ($1, $2)
     ON CONFLICT (blocker_id, blocked_id) DO NOTHING`,
    [blockerId, blockedId],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Unblock a user. Returns true if a block was removed, false if none existed.
 */
export async function unblockUser(blockerId: string, blockedId: string): Promise<boolean> {
  const result = await pool.query(
    'DELETE FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2',
    [blockerId, blockedId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function updateDisplayName(userId: string, displayName: string): Promise<UserRow> {
  const result = await pool.query<UserRow>(
    `UPDATE users SET display_name = $2, updated_at = NOW()
     WHERE user_id = $1
     RETURNING *`,
    [userId, displayName]
  );
  if (result.rows.length === 0) {
    throw new Error('User not found');
  }
  return result.rows[0];
}
