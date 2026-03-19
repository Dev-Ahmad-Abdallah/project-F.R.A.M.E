import { Pool } from 'pg';
import { getConfig } from '../config';

const config = getConfig();

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 100,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 5000,
  // Prevent runaway queries from holding connections indefinitely
  statement_timeout: 30000, // 30s max per statement
  idle_in_transaction_session_timeout: 60000, // 60s max idle in open transaction
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
