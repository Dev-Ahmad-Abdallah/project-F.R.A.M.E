import { Request, Response, NextFunction } from 'express';

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

  // Never expose internal error details in production
  let message: string;
  if (process.env.NODE_ENV === 'production') {
    if (statusCode >= 500) {
      message = 'Internal server error';
    } else if (statusCode === 400) {
      message = 'Bad request';
    } else if (statusCode === 401) {
      message = 'Unauthorized';
    } else if (statusCode === 403) {
      message = 'Forbidden';
    } else if (statusCode === 404) {
      message = 'Not found';
    } else if (statusCode === 429) {
      message = 'Too many requests';
    } else {
      message = 'Request error';
    }
  } else {
    message = err.message;
  }

  // Log error server-side (no sensitive data)
  console.error(`[${statusCode}] ${code}: ${err.message}`);

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
