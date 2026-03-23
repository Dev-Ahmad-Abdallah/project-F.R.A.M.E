import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { apiLimiter } from '../middleware/rateLimit';
import { asyncHandler, ApiError } from '../middleware/errorHandler';
import { validateBody, createRoomSchema, roomRenameSchema, roomSettingsSchema, roomInviteSchema, joinWithPasswordSchema, joinByCodeSchema } from '../middleware/validation';
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
  joinRoomByCode,
  getRoomCode,
  regenerateRoomCode,
  kickMember,
} from '../services/roomService';

export const roomsRouter = Router();

interface CreateRoomBody {
  roomType: 'direct' | 'group';
  inviteUserIds: string[];
  name?: string;
  isPrivate?: boolean;
  password?: string;
  isAnonymous?: boolean;
}

interface RoomRenameBody {
  name: string;
}

interface RoomInviteBody {
  userId: string;
}

interface JoinWithPasswordBody {
  password: string;
}

interface JoinByCodeBody {
  code: string;
  password?: string;
}

// POST /rooms/join-by-code — Join a room using an invite code
roomsRouter.post(
  '/join-by-code',
  requireAuth,
  apiLimiter,
  validateBody(joinByCodeSchema),
  asyncHandler(async (req, res) => {
    if (!req.auth) {
      throw new ApiError(401, 'M_UNAUTHORIZED', 'Not authenticated');
    }
    const body = req.body as JoinByCodeBody;
    const result = await joinRoomByCode(body.code, req.auth.sub, body.password);
    res.json(result);
  }),
);

// GET /rooms/code/:roomId — Get the invite code for a room (members only)
roomsRouter.get(
  '/code/:roomId',
  requireAuth,
  apiLimiter,
  asyncHandler(async (req, res) => {
    if (!req.auth) {
      throw new ApiError(401, 'M_UNAUTHORIZED', 'Not authenticated');
    }
    const result = await getRoomCode(req.params.roomId, req.auth.sub);
    res.json(result);
  }),
);

// POST /rooms/:roomId/regenerate-code — Regenerate invite code (admin only)
roomsRouter.post(
  '/:roomId/regenerate-code',
  requireAuth,
  apiLimiter,
  asyncHandler(async (req, res) => {
    if (!req.auth) {
      throw new ApiError(401, 'M_UNAUTHORIZED', 'Not authenticated');
    }
    const result = await regenerateRoomCode(req.params.roomId, req.auth.sub);
    res.json(result);
  }),
);

// POST /rooms/create — Create a new room (direct or group)
roomsRouter.post(
  '/create',
  requireAuth,
  apiLimiter,
  validateBody(createRoomSchema),
  asyncHandler(async (req, res) => {
    if (!req.auth) {
      throw new ApiError(401, 'M_UNAUTHORIZED', 'Not authenticated');
    }
    const body = req.body as CreateRoomBody;
    const result = await createRoom(
      req.auth.sub,
      body.roomType,
      body.inviteUserIds,
      undefined,
      {
        name: body.name,
        isPrivate: body.isPrivate,
        password: body.password,
        isAnonymous: body.isAnonymous,
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
    if (!req.auth) {
      throw new ApiError(401, 'M_UNAUTHORIZED', 'Not authenticated');
    }
    const rooms = await getUserRooms(req.auth.sub, req.auth.deviceId);
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
    if (!req.auth) {
      throw new ApiError(401, 'M_UNAUTHORIZED', 'Not authenticated');
    }
    const body = req.body as RoomInviteBody;
    const result = await inviteToRoom(
      req.params.roomId,
      req.auth.sub,
      body.userId,
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
    if (!req.auth) {
      throw new ApiError(401, 'M_UNAUTHORIZED', 'Not authenticated');
    }
    const result = await joinRoom(req.params.roomId, req.auth.sub);
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
    if (!req.auth) {
      throw new ApiError(401, 'M_UNAUTHORIZED', 'Not authenticated');
    }
    const body = req.body as RoomRenameBody;
    const result = await renameRoom(
      req.params.roomId,
      req.auth.sub,
      body.name,
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
    if (!req.auth) {
      throw new ApiError(401, 'M_UNAUTHORIZED', 'Not authenticated');
    }
    const result = await updateSettings(
      req.params.roomId,
      req.auth.sub,
      req.body as Record<string, unknown>,
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
    if (!req.auth) {
      throw new ApiError(401, 'M_UNAUTHORIZED', 'Not authenticated');
    }
    const settings = await getRoomSettings(req.params.roomId, req.auth.sub);
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
    if (!req.auth) {
      throw new ApiError(401, 'M_UNAUTHORIZED', 'Not authenticated');
    }
    const body = req.body as JoinWithPasswordBody;
    const result = await joinRoomWithPassword(
      req.params.roomId,
      req.auth.sub,
      body.password,
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
    if (!req.auth) {
      throw new ApiError(401, 'M_UNAUTHORIZED', 'Not authenticated');
    }
    const result = await leaveRoom(req.params.roomId, req.auth.sub);
    res.json(result);
  }),
);

// GET /rooms/:roomId/members — List members of a room
roomsRouter.get(
  '/:roomId/members',
  requireAuth,
  apiLimiter,
  asyncHandler(async (req, res) => {
    if (!req.auth) {
      throw new ApiError(401, 'M_UNAUTHORIZED', 'Not authenticated');
    }
    const members = await getRoomMemberList(req.params.roomId, req.auth.sub);
    res.json({ members });
  }),
);

// DELETE /rooms/:roomId/members/:userId — Remove (kick) a member from a room
roomsRouter.delete(
  '/:roomId/members/:userId',
  requireAuth,
  apiLimiter,
  asyncHandler(async (req, res) => {
    if (!req.auth) {
      throw new ApiError(401, 'M_UNAUTHORIZED', 'Not authenticated');
    }
    const result = await kickMember(
      req.params.roomId,
      req.auth.sub,
      req.params.userId,
    );
    res.json(result);
  }),
);
