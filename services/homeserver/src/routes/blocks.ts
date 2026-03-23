import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { apiLimiter } from '../middleware/rateLimit';
import { asyncHandler, ApiError } from '../middleware/errorHandler';
import { blockUser, unblockUser, getBlockedUsers, isBlocked } from '../db/queries/users';

export const blocksRouter = Router();

// POST /blocks/:userId — Block a user
blocksRouter.post(
  '/:userId',
  requireAuth,
  apiLimiter,
  asyncHandler(async (req, res) => {
    if (!req.auth) {
      throw new ApiError(401, 'M_UNAUTHORIZED', 'Not authenticated');
    }

    const targetUserId = req.params.userId;

    if (targetUserId === req.auth.sub) {
      throw new ApiError(400, 'M_BAD_JSON', 'You cannot block yourself');
    }

    await blockUser(req.auth.sub, targetUserId);
    res.json({ success: true });
  }),
);

// DELETE /blocks/:userId — Unblock a user
blocksRouter.delete(
  '/:userId',
  requireAuth,
  apiLimiter,
  asyncHandler(async (req, res) => {
    if (!req.auth) {
      throw new ApiError(401, 'M_UNAUTHORIZED', 'Not authenticated');
    }

    const targetUserId = req.params.userId;
    const removed = await unblockUser(req.auth.sub, targetUserId);

    if (!removed) {
      throw new ApiError(404, 'M_NOT_FOUND', 'Block not found');
    }

    res.json({ success: true });
  }),
);

// GET /blocks/check/:userId — Check if a user has blocked the current user
blocksRouter.get(
  '/check/:userId',
  requireAuth,
  apiLimiter,
  asyncHandler(async (req, res) => {
    if (!req.auth) {
      throw new ApiError(401, 'M_UNAUTHORIZED', 'Not authenticated');
    }

    const targetUserId = req.params.userId;
    const blocked = await isBlocked(targetUserId, req.auth.sub);
    res.json({ blocked });
  }),
);

// GET /blocks — List all blocked users
blocksRouter.get(
  '/',
  requireAuth,
  apiLimiter,
  asyncHandler(async (req, res) => {
    if (!req.auth) {
      throw new ApiError(401, 'M_UNAUTHORIZED', 'Not authenticated');
    }

    const blockedUserIds = await getBlockedUsers(req.auth.sub);
    res.json({ blocked: blockedUserIds });
  }),
);
