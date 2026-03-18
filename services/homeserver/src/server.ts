import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { getConfig, getCorsOrigins } from './config';
import { getPublicKeyBase64 } from './services/federationService';
import { pool, closePool } from './db/pool';
import { redisClient, redisSubscriber, closeRedis, connectRedis } from './redis/client';
import { errorHandler, asyncHandler } from './middleware/errorHandler';
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
  const messages = req.body.messages;
  if (!messages || typeof messages !== 'object') {
    res.status(400).json({ error: { code: 'M_BAD_JSON', message: 'Missing messages object' } });
    return;
  }

  // Limit total recipients per request to prevent abuse
  let recipientCount = 0;
  const MAX_RECIPIENTS = 100;

  for (const [userId, devices] of Object.entries(messages)) {
    if (typeof devices !== 'object' || devices === null) continue;
    for (const [deviceId, content] of Object.entries(devices as Record<string, unknown>)) {
      recipientCount++;
      if (recipientCount > MAX_RECIPIENTS) {
        res.status(400).json({ error: { code: 'M_BAD_JSON', message: 'Too many recipients' } });
        return;
      }
      await redisClient.publish(`todevice:${userId}:${deviceId}`, JSON.stringify({
        sender: req.auth!.sub,
        senderDevice: req.auth!.deviceId,
        type: req.params.eventType,
        content,
      }));
    }
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
  console.log('Redis connected');

  server = app.listen(config.PORT, () => {
    console.log(`Homeserver running on port ${config.PORT}`);
    console.log(`Domain: ${config.HOMESERVER_DOMAIN}`);
    console.log(`Environment: ${config.NODE_ENV}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

// ── Graceful shutdown ──
async function shutdown(signal: string) {
  console.log(`Received ${signal}. Shutting down gracefully...`);

  server.close(async () => {
    console.log('HTTP server closed');

    try {
      await closeRedis();
      console.log('Redis connections closed');
    } catch (err) {
      console.error('Error closing Redis:', err);
    }

    try {
      await closePool();
      console.log('PostgreSQL pool closed');
    } catch (err) {
      console.error('Error closing PostgreSQL:', err);
    }

    process.exit(0);
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
