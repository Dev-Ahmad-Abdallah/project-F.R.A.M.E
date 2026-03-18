import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { apiLimiter } from '../middleware/rateLimit';
import { asyncHandler } from '../middleware/errorHandler';
import { validateBody, createRoomSchema } from '../middleware/validation';
import {
  createRoom,
  getUserRooms,
  joinRoom,
  inviteToRoom,
  getRoomMemberList,
} from '../services/roomService';

export const roomsRouter = Router();

// POST /rooms/create — Create a new room (direct or group)
roomsRouter.post(
  '/create',
  requireAuth,
  apiLimiter,
  validateBody(createRoomSchema),
  asyncHandler(async (req, res) => {
    const result = await createRoom(
      req.auth!.sub,
      req.body.roomType,
      req.body.inviteUserIds,
    );
    res.status(201).json(result);
  }),
);

// GET /rooms — List all rooms the authenticated user belongs to
roomsRouter.get(
  '/',
  requireAuth,
  apiLimiter,
  asyncHandler(async (req, res) => {
    const rooms = await getUserRooms(req.auth!.sub);
    res.json({ rooms });
  }),
);

// POST /rooms/:roomId/invite — Invite a user to a room
roomsRouter.post(
  '/:roomId/invite',
  requireAuth,
  apiLimiter,
  asyncHandler(async (req, res) => {
    const result = await inviteToRoom(
      req.params.roomId,
      req.auth!.sub,
      req.body.userId,
    );
    res.json(result);
  }),
);

// POST /rooms/:roomId/join — Join a room by invite
roomsRouter.post(
  '/:roomId/join',
  requireAuth,
  apiLimiter,
  asyncHandler(async (req, res) => {
    const result = await joinRoom(req.params.roomId, req.auth!.sub);
    res.json(result);
  }),
);

// GET /rooms/:roomId/members — List members of a room
roomsRouter.get(
  '/:roomId/members',
  requireAuth,
  apiLimiter,
  asyncHandler(async (req, res) => {
    const members = await getRoomMemberList(req.params.roomId, req.auth!.sub);
    res.json({ members });
  }),
);
