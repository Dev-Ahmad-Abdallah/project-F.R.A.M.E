import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { pool } from '../db/pool';
import { redisClient } from '../redis/client';
import { getConfig } from '../config';

export const healthRouter = Router();

// eslint-disable-next-line @typescript-eslint/no-misused-promises
healthRouter.get('/', async (req, res) => {
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
  const statusCode = allHealthy ? 200 : 503;

  // Check if the caller provided a valid auth token
  let authenticated = false;
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    try {
      const config = getConfig();
      jwt.verify(authHeader.slice(7), config.JWT_SECRET, {
        algorithms: ['HS256'],
        issuer: config.HOMESERVER_DOMAIN,
      });
      authenticated = true;
    } catch {
      // Invalid token — treat as unauthenticated
    }
  }

  if (authenticated) {
    res.status(statusCode).json({
      status: allHealthy ? 'ok' : 'degraded',
      uptime: process.uptime(),
      version: '1.0.0',
      services: checks,
    });
  } else {
    res.status(statusCode).json({ status: allHealthy ? 'ok' : 'degraded' });
  }
});
