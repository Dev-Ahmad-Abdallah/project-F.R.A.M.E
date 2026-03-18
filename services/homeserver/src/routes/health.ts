import { Router } from 'express';
import { pool } from '../db/pool';
import { redisClient } from '../redis/client';

export const healthRouter = Router();

healthRouter.get('/', async (_req, res) => {
  const checks: Record<string, string> = {};

  try {
    await pool.query('SELECT 1');
    checks.database = 'connected';
  } catch {
    checks.database = 'disconnected';
  }

  try {
    await redisClient.ping();
    checks.redis = 'connected';
  } catch {
    checks.redis = 'disconnected';
  }

  const allHealthy = Object.values(checks).every((v) => v === 'connected');

  res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? 'ok' : 'degraded',
    uptime: process.uptime(),
    version: '1.0.0',
    services: checks,
  });
});
