import { Pool } from 'pg';
import { getConfig } from '../config';

const config = getConfig();

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ssl: config.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
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
