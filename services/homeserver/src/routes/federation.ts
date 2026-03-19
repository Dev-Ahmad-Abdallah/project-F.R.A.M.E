import { Router } from 'express';
import { z } from 'zod';
import { apiLimiter } from '../middleware/rateLimit';
import { asyncHandler, ApiError } from '../middleware/errorHandler';
import {
  isPeerTrusted,
  handleIncomingFederationEvent,
} from '../services/federationService';
import { getKeyBundle } from '../db/queries/keys';
import { getEventsSince } from '../db/queries/events';
import type { FederationEvent } from '@frame/shared/federation';

export const federationRouter = Router();

// ── Validation Schemas ──

const federationEventSchema = z.object({
  origin: z.string().min(1),
  originServerTs: z.number().int().positive(),
  eventId: z.string().min(1),
  roomId: z.string().min(1),
  sender: z.string().min(1),
  eventType: z.string().min(1),
  content: z.record(z.unknown()),
  signatures: z.record(z.record(z.string())),
});

const sendRequestSchema = z.object({
  events: z.array(federationEventSchema).min(1).max(100),
});

const backfillQuerySchema = z.object({
  roomId: z.string().min(1),
  since: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

// ── POST /federation/send — Accept signed events from peer servers ──

federationRouter.post('/send', apiLimiter, asyncHandler(async (req, res) => {
  // Parse and validate the request body
  const parseResult = sendRequestSchema.safeParse(req.body);
  if (!parseResult.success) {
    throw new ApiError(400, 'M_BAD_JSON', `Invalid request body: ${parseResult.error.message}`);
  }

  const { events } = parseResult.data;

  // Verify all events come from trusted peers before processing any
  for (const event of events) {
    if (!isPeerTrusted(event.origin)) {
      throw new ApiError(403, 'M_FORBIDDEN', `Origin server ${event.origin} is not a trusted peer`);
    }
  }

  // Process each event — signature verification, storage, and fan-out happen
  // inside handleIncomingFederationEvent
  const results: Array<{ eventId: string; status: 'ok' | 'error'; error?: string }> = [];

  for (const event of events) {
    try {
      const stored = await handleIncomingFederationEvent(event as FederationEvent);
      results.push({ eventId: stored.eventId, status: 'ok' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[Federation] Failed to process event ${event.eventId}:`, message);
      results.push({ eventId: event.eventId, status: 'error', error: message });
    }
  }

  res.status(200).json({ results });
}));

// ── GET /federation/keys/:userId — Return key bundle for cross-server key exchange ──

federationRouter.get('/keys/:userId', apiLimiter, asyncHandler(async (req, res) => {
  const { userId } = req.params;

  if (!userId || userId.length === 0) {
    throw new ApiError(400, 'M_BAD_JSON', 'Missing userId parameter');
  }

  const keyBundle = await getKeyBundle(userId);
  if (!keyBundle) {
    throw new ApiError(404, 'M_NOT_FOUND', `No key bundle found for user ${userId}`);
  }

  // Return the public key bundle (safe for federation)
  res.status(200).json({
    userId: keyBundle.user_id,
    deviceId: keyBundle.device_id,
    identityKey: keyBundle.identity_key,
    signedPrekey: keyBundle.signed_prekey,
    signedPrekeySignature: keyBundle.signed_prekey_signature,
    oneTimePrekeys: keyBundle.one_time_prekeys,
  });
}));

// ── GET /federation/backfill — Return events for a room since a sequence ID ──

federationRouter.get('/backfill', apiLimiter, asyncHandler(async (req, res) => {
  // P1-1: Verify the requesting server is a trusted peer
  const origin = (req.headers['x-origin-server'] as string) || req.headers['origin'] || '';
  if (!origin || !isPeerTrusted(origin as string)) {
    throw new ApiError(403, 'M_FORBIDDEN', 'Origin server is not a trusted peer');
  }

  const parseResult = backfillQuerySchema.safeParse(req.query);
  if (!parseResult.success) {
    throw new ApiError(400, 'M_BAD_JSON', `Invalid query parameters: ${parseResult.error.message}`);
  }

  const { roomId, since, limit } = parseResult.data;

  const events = await getEventsSince(roomId, since, limit);

  res.status(200).json({
    events: events.map((e) => ({
      eventId: e.event_id,
      roomId: e.room_id,
      sender: e.sender_id,
      eventType: e.event_type,
      content: e.content,
      originServer: e.origin_server,
      originServerTs: e.origin_ts.getTime(),
      sequenceId: e.sequence_id,
    })),
    hasMore: events.length >= limit,
  });
}));
