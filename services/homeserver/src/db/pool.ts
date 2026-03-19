import { Pool } from 'pg';
import { getConfig } from '../config';

const config = getConfig();

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 100,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 5000,
  statement_timeout: 30000, // Kill queries after 30s to prevent pool exhaustion
  ssl: config.NODE_ENV === 'production' ? { rejectUnauthorized: config.DB_SSL_REJECT_UNAUTHORIZED } : undefined,
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err);
});

export async function closePool(): Promise<void> {
  await pool.end();
}

export async function query(text: string, params?: unknown[]) {
  return pool.query(text, params);
}
