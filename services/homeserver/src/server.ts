import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { z } from 'zod';
import { getConfig, getCorsOrigins } from './config';
import { getPublicKeyBase64 } from './services/federationService';
import { pool, closePool } from './db/pool';
import { redisClient, closeRedis, connectRedis } from './redis/client';
import { errorHandler, asyncHandler, ApiError } from './middleware/errorHandler';
import { requireAuth } from './middleware/auth';
import { apiLimiter } from './middleware/rateLimit';
import { logger } from './logger';
import { authRouter } from './routes/auth';
import { keysRouter } from './routes/keys';
import { messagesRouter } from './routes/messages';
import { devicesRouter } from './routes/devices';
import { federationRouter } from './routes/federation';
import { healthRouter } from './routes/health';
import { roomsRouter } from './routes/rooms';
import { pushRouter } from './routes/push';
import { filesRouter } from './routes/files';
import { stopDisappearingCleanup } from './services/messageService';

const config = getConfig();
const app = express();

// ── Trust Railway's reverse proxy (required for rate-limit + correct client IP) ──
app.set('trust proxy', 1);

// ── HSTS (production only) ──
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });
}

// ── Security headers ──
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'", ...getCorsOrigins()],
      imgSrc: ["'self'", 'data:'],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
}));

// ── CORS ──
app.use(cors({
  origin: getCorsOrigins(),
  credentials: false, // No cookies used — auth is Bearer-token only (Security Finding 12)
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ── Body parsing ──
// Skip the global JSON parser for /messages routes — the messages router
// defines its own express.json({ limit: '10mb' }) to support large encrypted
// payloads (file metadata, voice notes, etc.).  Without this guard the 64 KB
// global limit rejects any encrypted message body > 64 KB before the
// route-level parser ever runs.
app.use((req, res, next) => {
  if (req.path.startsWith('/messages')) {
    next();
    return;
  }
  express.json({ limit: '64kb' })(req, res, next);
});

// ── Request logging ──
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    logger.info('request', {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms: Date.now() - start,
      userId: req.auth?.sub,
    });
  });
  next();
});

// ── Root info ──
app.get('/', (_req, res) => {
  res.json({
    name: 'F.R.A.M.E. Homeserver',
    version: '1.0.0',
    status: 'online',
  });
});

// ── Routes ──
app.use('/health', healthRouter);
app.use('/auth', authRouter);
app.use('/keys', keysRouter);
app.use('/messages', messagesRouter);
app.use('/devices', devicesRouter);
app.use('/federation', federationRouter);
app.use('/rooms', roomsRouter);
app.use('/push', pushRouter);
app.use('/files', filesRouter);

// ── Zod schema for sendToDevice body ──
const sendToDeviceSchema = z.object({
  messages: z.record(
    z.string().min(1),
    z.record(z.string().min(1), z.unknown())
  ),
});

// ── To-device messaging (required by vodozemac for Megolm key sharing) ──
app.put('/sendToDevice/:eventType/:txnId', requireAuth, apiLimiter, asyncHandler(async (req, res) => {
  if (!req.auth) {
    throw new ApiError(401, 'M_UNAUTHORIZED', 'Not authenticated');
  }

  const parseResult = sendToDeviceSchema.safeParse(req.body);
  if (!parseResult.success) {
    throw new ApiError(400, 'M_BAD_JSON', `Invalid request body: ${parseResult.error.message}`);
  }

  const messagesObj = parseResult.data.messages;

  // Limit total recipients per request to prevent abuse
  let recipientCount = 0;
  const MAX_RECIPIENTS = 100;

  // Collect all to-device messages for batch insert
  const toDeviceRows: Array<[string, string, string, string, string, string]> = [];

  for (const [userId, devices] of Object.entries(messagesObj)) {
    if (typeof devices !== 'object' || devices === null) continue;
    for (const [deviceId, content] of Object.entries(devices)) {
      recipientCount++;
      if (recipientCount > MAX_RECIPIENTS) {
        res.status(400).json({ error: { code: 'M_BAD_JSON', message: 'Too many recipients' } });
        return;
      }
      toDeviceRows.push([
        userId, deviceId,
        req.auth.sub, req.auth.deviceId,
        req.params.eventType, JSON.stringify(content),
      ]);
    }
  }

  // Store to-device messages in DB for reliable delivery
  if (toDeviceRows.length > 0) {
    const values = toDeviceRows.map((_, i) => {
      const offset = i * 6;
      return `($${offset+1}, $${offset+2}, $${offset+3}, $${offset+4}, $${offset+5}, $${offset+6}::jsonb)`;
    }).join(', ');

    await pool.query(
      `INSERT INTO to_device_messages (recipient_user_id, recipient_device_id, sender_user_id, sender_device_id, event_type, content)
       VALUES ${values}`,
      toDeviceRows.flat()
    );

    // Notify via Redis pub/sub for instant delivery to online clients.
    // SECURITY: Only a type hint is published — no event content, sender info,
    // or encryption material passes through Redis. The actual payload is stored
    // in PostgreSQL and fetched via authenticated /messages/sync.
    await Promise.all(
      toDeviceRows.map(([, deviceId]) =>
        redisClient.publish(`device:${deviceId}`, JSON.stringify({ type: 'to_device' }))
      )
    );
  }

  res.json({});
}));

// ── Well-known for federation discovery ──
// The federation port defaults to 443 (standard HTTPS) in production.
// In development, it falls back to the internal PORT. This can be overridden
// via FEDERATION_PORT env var for non-standard setups.
const federationPort = process.env.FEDERATION_PORT
  ? Number(process.env.FEDERATION_PORT)
  : config.NODE_ENV === 'production' ? 443 : config.PORT;

app.get('/.well-known/frame/server', (_req, res) => {
  res.json({
    'frame.server': {
      host: config.HOMESERVER_DOMAIN,
      port: federationPort,
      publicKey: getPublicKeyBase64(),
    },
  });
});

// ── Custom 404 handler (returns JSON, not Express default HTML) ──
app.use((_req, res) => {
  res.status(404).json({ error: { code: 'M_NOT_FOUND', message: 'Endpoint not found' } });
});

// ── Centralized error handler ──
app.use(errorHandler);

// ── Start server ──
let server: ReturnType<typeof app.listen>;

async function startServer() {
  await connectRedis();
  logger.info('Redis connected');

  server = app.listen(config.PORT, () => {
    logger.info('Homeserver started', {
      port: config.PORT,
      domain: config.HOMESERVER_DOMAIN,
      environment: config.NODE_ENV,
    });
  });
}

startServer().catch((err: unknown) => {
  logger.error('Failed to start server', { error: String(err) });
  process.exit(1);
});

// ── Graceful shutdown ──
function shutdown(signal: string) {
  logger.info('Shutting down gracefully', { signal });

  // Stop the disappearing-messages cleanup timer so it doesn't fire during teardown
  stopDisappearingCleanup();

  server.close(() => {
    logger.info('HTTP server closed');

    const cleanupAndExit = async () => {
      try {
        await closeRedis();
        logger.info('Redis connections closed');
      } catch (err) {
        logger.error('Error closing Redis', { error: String(err) });
      }

      try {
        await closePool();
        logger.info('PostgreSQL pool closed');
      } catch (err) {
        logger.error('Error closing PostgreSQL', { error: String(err) });
      }

      process.exit(0);
    };

    void cleanupAndExit();
  });

  // Force shutdown after 10 seconds
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export { app };
