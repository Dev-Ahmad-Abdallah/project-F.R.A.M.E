import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { messageLimiter, apiLimiter } from '../middleware/rateLimit';
import { asyncHandler } from '../middleware/errorHandler';
import { validateBody, validateQuery, sendMessageSchema, syncQuerySchema } from '../middleware/validation';
import { sendMessage, syncMessages } from '../services/messageService';

export const messagesRouter = Router();

// POST /messages/send — Send encrypted message payload
messagesRouter.post(
  '/send',
  requireAuth,
  messageLimiter,
  validateBody(sendMessageSchema),
  asyncHandler(async (req, res) => {
    const result = await sendMessage({
      roomId: req.body.roomId,
      senderId: req.auth!.sub,
      senderDeviceId: req.auth!.deviceId,
      eventType: req.body.eventType,
      content: req.body.content,
    });
    res.json(result);
  })
);

// GET /messages/sync — Long-poll for queued messages (AD-014)
messagesRouter.get(
  '/sync',
  requireAuth,
  apiLimiter,
  validateQuery(syncQuerySchema),
  asyncHandler(async (req, res) => {
    const since = parseInt(req.query.since as string || '0', 10);
    const timeout = parseInt(req.query.timeout as string || '0', 10);
    const limit = parseInt(req.query.limit as string || '50', 10);

    const result = await syncMessages(
      req.auth!.sub,
      req.auth!.deviceId,
      since,
      limit,
      timeout
    );

    res.json(result);
  })
);
