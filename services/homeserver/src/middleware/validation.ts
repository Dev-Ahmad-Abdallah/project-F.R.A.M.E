import { Request, Response, NextFunction } from 'express';
import { z, ZodSchema } from 'zod';
import { ApiError } from './errorHandler';

// Validate request body against a Zod schema
export function validateBody(schema: ZodSchema) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const message = result.error.errors
        .map((e) => `${e.path.join('.')}: ${e.message}`)
        .join('; ');
      throw new ApiError(400, 'M_BAD_JSON', message);
    }
    req.body = result.data;
    next();
  };
}

// Validate query parameters
export function validateQuery(schema: ZodSchema) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      const message = result.error.errors
        .map((e) => `${e.path.join('.')}: ${e.message}`)
        .join('; ');
      throw new ApiError(400, 'M_BAD_JSON', message);
    }
    req.query = result.data;
    next();
  };
}

// ── Request Schemas ──

export const registerSchema = z.object({
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_-]+$/, 'Username must be alphanumeric'),
  password: z.string().min(8).max(128),
  identityKey: z.string().min(1),
  signedPrekey: z.string().min(1),
  signedPrekeySig: z.string().min(1),
  oneTimePrekeys: z.array(z.string()).min(1).max(100),
});

export const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  deviceId: z.string().optional(),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export const sendMessageSchema = z.object({
  roomId: z.string().min(1),
  eventType: z.string().min(1),
  content: z.record(z.unknown()),
});

export const syncQuerySchema = z.object({
  since: z.string().optional(),
  timeout: z.coerce.number().min(0).max(30000).optional().default(0),
  limit: z.coerce.number().min(1).max(100).optional().default(50),
});

export const keyUploadSchema = z.object({
  oneTimePrekeys: z.array(z.string()).max(100).optional(),
  signedPrekey: z.string().optional(),
  signedPrekeySig: z.string().optional(),
}).passthrough();

export const deviceRegisterSchema = z.object({
  deviceId: z.string().min(1),
  deviceDisplayName: z.string().max(64).optional(),
  devicePublicKey: z.string().min(1),
  deviceSigningKey: z.string().min(1),
});

export const createRoomSchema = z.object({
  roomType: z.enum(['direct', 'group']),
  inviteUserIds: z.array(z.string()).min(1).max(50),
});
