import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { getConfig } from '../config';
import { ApiError } from './errorHandler';

export interface AuthPayload {
  sub: string;       // userId (@user:homeserver)
  deviceId: string;
  iss: string;       // homeserver domain
  iat: number;
  exp: number;
}

// Extend Express Request to include auth payload
declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthPayload;
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new ApiError(401, 'M_UNAUTHORIZED', 'Missing or invalid Authorization header');
  }

  const token = authHeader.slice(7);
  const config = getConfig();

  try {
    const payload = jwt.verify(token, config.JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: config.HOMESERVER_DOMAIN,
    }) as AuthPayload & { type?: string };

    // Reject refresh tokens used as access tokens (Security Finding 4)
    if (payload.type === 'refresh') {
      throw new ApiError(401, 'M_INVALID_TOKEN', 'Refresh tokens cannot be used for API access');
    }

    req.auth = payload;
    next();
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err instanceof jwt.TokenExpiredError) {
      throw new ApiError(401, 'M_TOKEN_EXPIRED', 'Token expired');
    }
    if (err instanceof jwt.JsonWebTokenError) {
      throw new ApiError(401, 'M_INVALID_TOKEN', 'Invalid token');
    }
    throw new ApiError(401, 'M_INVALID_TOKEN', 'Invalid token');
  }
}
