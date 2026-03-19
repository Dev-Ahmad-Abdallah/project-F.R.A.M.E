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
