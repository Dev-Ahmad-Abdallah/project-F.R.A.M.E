import { Router } from 'express';
import express from 'express';
import { requireAuth } from '../middleware/auth';
import { messageLimiter, apiLimiter, syncLimiter } from '../middleware/rateLimit';
import { asyncHandler, ApiError } from '../middleware/errorHandler';
import { validateBody, validateQuery, sendMessageSchema, syncQuerySchema, reactSchema, typingSchema } from '../middleware/validation';
import { sendMessage, deleteMessage, syncMessages, acknowledgeToDeviceMessages } from '../services/messageService';
import { addReaction, upsertReadReceipt, getReadReceipts } from '../db/queries/events';
import { isRoomMember } from '../db/queries/rooms';
import { pool } from '../db/pool';
import { redisClient } from '../redis/client';

export const messagesRouter = Router();

// Apply JSON body parsing at the router level. The global parser in server.ts
// skips /messages paths so that /messages/send can use a 10 MB limit for large
// encrypted payloads. All other message endpoints use the default 64 KB limit.
messagesRouter.use((req, res, next) => {
  if (req.path === '/send') {
    // Let the route-level express.json({ limit: '10mb' }) handle /send
    next();
    return;
  }
  express.json({ limit: '64kb' })(req, res, next);
});

interface SendMessageBody {
  roomId: string;
  eventType: string;
  content: Record<string, unknown>;
}

// POST /messages/send — Send encrypted message payload
messagesRouter.post(
  '/send',
  express.json({ limit: '10mb' }),
  requireAuth,
  messageLimiter,
  validateBody(sendMessageSchema),
  asyncHandler(async (req, res) => {
    if (!req.auth) {
      throw new ApiError(401, 'M_UNAUTHORIZED', 'Not authenticated');
    }
    const body = req.body as SendMessageBody;
    const result = await sendMessage({
      roomId: body.roomId,
      senderId: req.auth.sub,
      senderDeviceId: req.auth.deviceId,
      eventType: body.eventType,
      content: body.content,
    });
    res.json(result);
  })
);

// DELETE /messages/:eventId — Soft-delete a message (sender only)
messagesRouter.delete(
  '/:eventId',
  requireAuth,
  apiLimiter,
  asyncHandler(async (req, res) => {
    if (!req.auth) {
      throw new ApiError(401, 'M_UNAUTHORIZED', 'Not authenticated');
    }
    await deleteMessage(req.params.eventId, req.auth.sub);
    res.status(204).send();
  })
);

// POST /messages/ack-to-device — Acknowledge receipt of to-device messages
messagesRouter.post(
  '/ack-to-device',
  requireAuth,
  apiLimiter,
  asyncHandler(async (req, res) => {
    if (!req.auth) {
      throw new ApiError(401, 'M_UNAUTHORIZED', 'Not authenticated');
    }
    const { messageIds } = req.body as { messageIds?: number[] };
    if (!Array.isArray(messageIds) || messageIds.length === 0) {
      throw new ApiError(400, 'M_BAD_JSON', 'messageIds must be a non-empty array of numbers');
    }
    if (messageIds.length > 500) {
      throw new ApiError(400, 'M_BAD_JSON', 'Too many messageIds (max 500)');
    }
    const acknowledged = await acknowledgeToDeviceMessages(
      req.auth.sub,
      req.auth.deviceId,
      messageIds,
    );
    res.json({ acknowledged });
  })
);

// GET /messages/sync — Long-poll for queued messages (AD-014)
messagesRouter.get(
  '/sync',
  requireAuth,
  syncLimiter,
  validateQuery(syncQuerySchema),
  asyncHandler(async (req, res) => {
    if (!req.auth) {
      throw new ApiError(401, 'M_UNAUTHORIZED', 'Not authenticated');
    }
    const since = parseInt(req.query.since as string || '0', 10);
    const timeout = parseInt(req.query.timeout as string || '0', 10);
    const limit = parseInt(req.query.limit as string || '50', 10);

    const result = await syncMessages(
      req.auth.sub,
      req.auth.deviceId,
      since,
      limit,
      timeout
    );

    res.json(result);
  })
);

// POST /messages/:eventId/react — Add or toggle a reaction on a message
messagesRouter.post(
  '/:eventId/react',
  requireAuth,
  apiLimiter,
  validateBody(reactSchema),
  asyncHandler(async (req, res) => {
    if (!req.auth) {
      throw new ApiError(401, 'M_UNAUTHORIZED', 'Not authenticated');
    }
    const { eventId } = req.params;
    const { emoji } = req.body as { emoji: string };

    // Verify the event exists and user is a member of its room
    const eventResult = await pool.query<{ room_id: string }>(
      'SELECT room_id FROM events WHERE event_id = $1',
      [eventId]
    );
    if (eventResult.rows.length === 0) {
      throw new ApiError(404, 'M_NOT_FOUND', 'Event not found');
    }
    const roomId = eventResult.rows[0].room_id;
    if (!(await isRoomMember(roomId, req.auth.sub))) {
      throw new ApiError(403, 'M_FORBIDDEN', 'Not a member of this room');
    }

    const reactions = await addReaction(eventId, req.auth.sub, emoji);
    res.json({ eventId, reactions });
  })
);

// POST /messages/:eventId/read — Mark a message as read (read receipt)
messagesRouter.post(
  '/:eventId/read',
  requireAuth,
  apiLimiter,
  asyncHandler(async (req, res) => {
    if (!req.auth) {
      throw new ApiError(401, 'M_UNAUTHORIZED', 'Not authenticated');
    }
    const { eventId } = req.params;

    // Verify the event exists and user is a member of its room
    const eventResult = await pool.query<{ room_id: string }>(
      'SELECT room_id FROM events WHERE event_id = $1',
      [eventId]
    );
    if (eventResult.rows.length === 0) {
      throw new ApiError(404, 'M_NOT_FOUND', 'Event not found');
    }
    const roomId = eventResult.rows[0].room_id;
    if (!(await isRoomMember(roomId, req.auth.sub))) {
      throw new ApiError(403, 'M_FORBIDDEN', 'Not a member of this room');
    }

    await upsertReadReceipt(roomId, req.auth.sub, eventId);
    res.json({ success: true });
  })
);

// GET /messages/read-receipts/:roomId — Get read receipts for a room
messagesRouter.get(
  '/read-receipts/:roomId',
  requireAuth,
  apiLimiter,
  asyncHandler(async (req, res) => {
    if (!req.auth) {
      throw new ApiError(401, 'M_UNAUTHORIZED', 'Not authenticated');
    }
    const { roomId } = req.params;
    if (!(await isRoomMember(roomId, req.auth.sub))) {
      throw new ApiError(403, 'M_FORBIDDEN', 'Not a member of this room');
    }

    const receipts = await getReadReceipts(roomId);
    res.json({ receipts });
  })
);

// POST /messages/typing — Set typing state for the current user
messagesRouter.post(
  '/typing',
  requireAuth,
  apiLimiter,
  validateBody(typingSchema),
  asyncHandler(async (req, res) => {
    if (!req.auth) {
      throw new ApiError(401, 'M_UNAUTHORIZED', 'Not authenticated');
    }
    const { roomId, isTyping } = req.body as { roomId: string; isTyping: boolean };
    if (!(await isRoomMember(roomId, req.auth.sub))) {
      throw new ApiError(403, 'M_FORBIDDEN', 'Not a member of this room');
    }

    const hashKey = `typing:${roomId}`;
    if (isTyping) {
      await redisClient.hset(hashKey, req.auth.sub, String(Date.now()));
      // Ensure the hash expires if all clients disconnect without clearing
      await redisClient.expire(hashKey, 30);
    } else {
      await redisClient.hdel(hashKey, req.auth.sub);
    }
    res.json({ success: true });
  })
);

// GET /messages/typing/:roomId — Get list of users currently typing
messagesRouter.get(
  '/typing/:roomId',
  requireAuth,
  apiLimiter,
  asyncHandler(async (req, res) => {
    if (!req.auth) {
      throw new ApiError(401, 'M_UNAUTHORIZED', 'Not authenticated');
    }
    const { roomId } = req.params;
    if (!(await isRoomMember(roomId, req.auth.sub))) {
      throw new ApiError(403, 'M_FORBIDDEN', 'Not a member of this room');
    }

    // H-1 FIX: Use HGETALL instead of KEYS to avoid O(N) scan in production
    const hashKey = `typing:${roomId}`;
    const typingEntries = await redisClient.hgetall(hashKey);
    const now = Date.now();
    const staleThreshold = 5000; // 5 seconds
    const staleFields: string[] = [];
    const typingUserIds: string[] = [];

    for (const [userId, timestamp] of Object.entries(typingEntries)) {
      if (now - Number(timestamp) > staleThreshold) {
        staleFields.push(userId);
      } else if (userId !== req.auth?.sub) {
        typingUserIds.push(userId);
      }
    }

    // Clean up stale entries lazily
    if (staleFields.length > 0) {
      await redisClient.hdel(hashKey, ...staleFields);
    }

    res.json({ typingUserIds });
  })
);
