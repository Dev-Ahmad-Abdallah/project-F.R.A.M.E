import { Request, Response, NextFunction } from 'express';
import { logger } from '../logger';

// Async route wrapper for Express 4 (AD-013: avoids Express 5 beta risk)
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// Centralized error handler — must be last middleware
export function errorHandler(
  err: Error & { statusCode?: number; code?: string },
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  const statusCode = err.statusCode || 500;
  const code = err.code || 'M_UNKNOWN';

  // In production, hide internal details but preserve user-facing error messages
  // for client errors (4xx). Only 500+ errors get fully genericized.
  let message: string;
  if (process.env.NODE_ENV === 'production' && statusCode >= 500) {
    message = 'Internal server error';
  } else {
    // 4xx errors use the original message — these are intentional user-facing
    // messages like "This room requires a password" or "Invalid invite code"
    message = err.message;
  }

  // Log error server-side (no sensitive data)
  logger.error('Request error', { statusCode, code, error: err.message });

  res.status(statusCode).json({
    error: {
      code,
      message,
    },
  });
}

// Custom error class for API errors
export class ApiError extends Error {
  statusCode: number;
  code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.name = 'ApiError';
  }
}
