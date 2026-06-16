import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from './appError';
import { ApiResponse } from './apiResponse';
import { ErrorCodes } from './errorCodes';
import { logger } from './logger';
import { isProd } from '../config/env';

/** 404 for any route no module claimed. Mounted after all routers. */
export function notFoundHandler(req: Request, res: Response): void {
  ApiResponse.fail(res, 404, ErrorCodes.NOT_FOUND, `Route ${req.method} ${req.path} not found`);
}

/**
 * Global error middleware — the ONLY place errors become HTTP responses.
 * AppError → its mapped status/code. ZodError → 400 VALIDATION_ERROR.
 * Everything else → 500 INTERNAL_ERROR with a generic message.
 * Stack traces are logged, never sent to clients.
 */
export function errorMiddleware(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (res.headersSent) {
    return;
  }

  if (err instanceof AppError) {
    ApiResponse.fail(res, err.statusCode, err.code, err.message, err.details);
    return;
  }

  if (err instanceof ZodError) {
    ApiResponse.fail(
      res,
      400,
      ErrorCodes.VALIDATION_ERROR,
      'Request validation failed',
      err.flatten(),
    );
    return;
  }

  // Malformed JSON body from express.json()
  if (err instanceof SyntaxError && 'body' in err) {
    ApiResponse.fail(res, 400, ErrorCodes.VALIDATION_ERROR, 'Malformed JSON body');
    return;
  }

  const message = err instanceof Error ? err.message : String(err);
  logger.error({ err, requestId: req.id, path: req.path }, `Unhandled error: ${message}`);
  ApiResponse.fail(
    res,
    500,
    ErrorCodes.INTERNAL_ERROR,
    isProd ? 'Something went wrong' : message,
  );
}
