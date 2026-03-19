import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { getConfig, getCorsOrigins } from './config';
import { getPublicKeyBase64 } from './services/federationService';
import { pool, closePool } from './db/pool';
import { redisClient, closeRedis, connectRedis } from './redis/client';
import { errorHandler, asyncHandler, ApiError } from './middleware/errorHandler';
import { requireAuth } from './middleware/auth';
import { apiLimiter } from './middleware/rateLimit';
import { authRouter } from './routes/auth';
import { keysRouter } from './routes/keys';
import { messagesRouter } from './routes/messages';
import { devicesRouter } from './routes/devices';
import { federationRouter } from './routes/federation';
import { healthRouter } from './routes/health';
import { roomsRouter } from './routes/rooms';

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
app.use(express.json({ limit: '64kb' }));

// ── Root info ──
app.get('/', (_req, res) => {
  res.json({
    name: 'F.R.A.M.E. Homeserver',
    version: '1.0.0',
    domain: config.HOMESERVER_DOMAIN,
    endpoints: {
      health: '/health',
      auth: '/auth',
      keys: '/keys',
      messages: '/messages',
      devices: '/devices',
      rooms: '/rooms',
      federation: '/federation',
      discovery: '/.well-known/frame/server',
    },
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

// ── To-device messaging (required by vodozemac for Megolm key sharing) ──
app.put('/sendToDevice/:eventType/:txnId', requireAuth, apiLimiter, asyncHandler(async (req, res) => {
  if (!req.auth) {
    throw new ApiError(401, 'M_UNAUTHORIZED', 'Not authenticated');
  }
  const body = req.body as { messages?: Record<string, Record<string, unknown>> };
  const messagesObj = body.messages;
  if (!messagesObj || typeof messagesObj !== 'object') {
    res.status(400).json({ error: { code: 'M_BAD_JSON', message: 'Missing messages object' } });
    return;
  }

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
app.get('/.well-known/frame/server', (_req, res) => {
  res.json({
    'frame.server': {
      host: config.HOMESERVER_DOMAIN,
      port: config.PORT,
      publicKey: getPublicKeyBase64(),
    },
  });
});

// ── Centralized error handler ──
app.use(errorHandler);

// ── Start server ──
let server: ReturnType<typeof app.listen>;

async function startServer() {
  await connectRedis();
  console.info('Redis connected');

  server = app.listen(config.PORT, () => {
    console.info(`Homeserver running on port ${config.PORT}`);
    console.info(`Domain: ${config.HOMESERVER_DOMAIN}`);
    console.info(`Environment: ${config.NODE_ENV}`);
  });
}

startServer().catch((err: unknown) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

// ── Graceful shutdown ──
function shutdown(signal: string) {
  console.info(`Received ${signal}. Shutting down gracefully...`);

  server.close(() => {
    console.info('HTTP server closed');

    const cleanupAndExit = async () => {
      try {
        await closeRedis();
        console.info('Redis connections closed');
      } catch (err) {
        console.error('Error closing Redis:', err);
      }

      try {
        await closePool();
        console.info('PostgreSQL pool closed');
      } catch (err) {
        console.error('Error closing PostgreSQL:', err);
      }

      process.exit(0);
    };

    void cleanupAndExit();
  });

  // Force shutdown after 10 seconds
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export { app };
