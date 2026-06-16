import type { Response } from 'express';
import type { ErrorCode } from './errorCodes';

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface Envelope<T> {
  success: boolean;
  data: T | null;
  error: { code: ErrorCode; message: string; details?: unknown } | null;
  meta?: Record<string, unknown> & { pagination?: PaginationMeta };
}

/** Single place that shapes EVERY response — controllers never hand-build JSON. */
export const ApiResponse = {
  ok<T>(res: Response, data: T, meta?: Envelope<T>['meta'], status = 200): Response {
    const body: Envelope<T> = { success: true, data, error: null, ...(meta ? { meta } : {}) };
    return res.status(status).json(body);
  },

  created<T>(res: Response, data: T, meta?: Envelope<T>['meta']): Response {
    return ApiResponse.ok(res, data, meta, 201);
  },

  paginated<T>(
    res: Response,
    data: T[],
    pagination: PaginationMeta,
    extraMeta?: Record<string, unknown>,
  ): Response {
    return ApiResponse.ok(res, data, { ...extraMeta, pagination });
  },

  fail(
    res: Response,
    status: number,
    code: ErrorCode,
    message: string,
    details?: unknown,
  ): Response {
    const body: Envelope<never> = {
      success: false,
      data: null,
      error: { code, message, ...(details !== undefined ? { details } : {}) },
    };
    return res.status(status).json(body);
  },
};

/** Helper for list endpoints: ?page=&limit= (default 20, max 100). */
export function buildPagination(page: number, limit: number, total: number): PaginationMeta {
  return { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
}
