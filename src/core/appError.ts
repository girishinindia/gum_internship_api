import type { ErrorCode } from './errorCodes';
import { ErrorCodes, errorStatusMap } from './errorCodes';

/**
 * The only error type the API throws intentionally.
 * Global error middleware turns it into the JSON envelope; anything else
 * becomes a sanitized INTERNAL_ERROR (no stack traces ever leave the process).
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = errorStatusMap[code];
    this.details = details;
    Error.captureStackTrace?.(this, AppError);
  }

  static validation(message = 'Request validation failed', details?: unknown): AppError {
    return new AppError(ErrorCodes.VALIDATION_ERROR, message, details);
  }
  static unauthorized(message = 'Authentication required'): AppError {
    return new AppError(ErrorCodes.UNAUTHORIZED, message);
  }
  static forbidden(message = 'You do not have access to this resource'): AppError {
    return new AppError(ErrorCodes.FORBIDDEN, message);
  }
  static notFound(resource = 'Resource'): AppError {
    return new AppError(ErrorCodes.NOT_FOUND, `${resource} not found`);
  }
  static conflict(message: string, code: ErrorCode = ErrorCodes.CONFLICT): AppError {
    return new AppError(code, message);
  }
  static internal(message = 'Something went wrong'): AppError {
    return new AppError(ErrorCodes.INTERNAL_ERROR, message);
  }
}
