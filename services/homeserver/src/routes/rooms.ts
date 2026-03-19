import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { apiLimiter } from '../middleware/rateLimit';
import { asyncHandler } from '../middleware/errorHandler';
import { validateBody, createRoomSchema, roomRenameSchema, roomSettingsSchema, roomInviteSchema, joinWithPasswordSchema } from '../middleware/validation';
import {
  createRoom,
  getUserRooms,
  joinRoom,
  inviteToRoom,
  getRoomMemberList,
  renameRoom,
  leaveRoom,
  updateSettings,
  getRoomSettings,
  joinRoomWithPassword,
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
      undefined,
      {
        name: req.body.name,
        isPrivate: req.body.isPrivate,
        password: req.body.password,
      },
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
  validateBody(roomInviteSchema),
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

// PUT /rooms/:roomId/name — Rename a room
roomsRouter.put(
  '/:roomId/name',
  requireAuth,
  apiLimiter,
  validateBody(roomRenameSchema),
  asyncHandler(async (req, res) => {
    const result = await renameRoom(
      req.params.roomId,
      req.auth!.sub,
      req.body.name,
    );
    res.json(result);
  }),
);

// PUT /rooms/:roomId/settings — Update room settings
roomsRouter.put(
  '/:roomId/settings',
  requireAuth,
  apiLimiter,
  validateBody(roomSettingsSchema),
  asyncHandler(async (req, res) => {
    const result = await updateSettings(
      req.params.roomId,
      req.auth!.sub,
      req.body,
    );
    res.json(result);
  }),
);

// GET /rooms/:roomId/settings — Get room settings
roomsRouter.get(
  '/:roomId/settings',
  requireAuth,
  apiLimiter,
  asyncHandler(async (req, res) => {
    const settings = await getRoomSettings(req.params.roomId, req.auth!.sub);
    res.json({ settings });
  }),
);

// POST /rooms/:roomId/join-with-password — Join a password-protected room
roomsRouter.post(
  '/:roomId/join-with-password',
  requireAuth,
  apiLimiter,
  validateBody(joinWithPasswordSchema),
  asyncHandler(async (req, res) => {
    const result = await joinRoomWithPassword(
      req.params.roomId,
      req.auth!.sub,
      req.body.password,
    );
    res.json(result);
  }),
);

// DELETE /rooms/:roomId/leave — Leave a room
roomsRouter.delete(
  '/:roomId/leave',
  requireAuth,
  apiLimiter,
  asyncHandler(async (req, res) => {
    const result = await leaveRoom(req.params.roomId, req.auth!.sub);
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
