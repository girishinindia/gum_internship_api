import type { RequestHandler } from 'express';
import type { ZodTypeAny } from 'zod';
import { AppError } from '../core/appError';

type RequestPart = 'body' | 'query' | 'params';

/**
 * zodValidate(schema)            → validates req.body
 * zodValidate(schema, 'query')   → validates req.query
 * zodValidate(schema, 'params')  → validates req.params
 * On success the PARSED (coerced, defaulted, stripped) value replaces the raw
 * one, so controllers always read typed data. On failure → 400 envelope with
 * zod's flattened issues in error.details.
 */
export function zodValidate(schema: ZodTypeAny, part: RequestPart = 'body'): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req[part]);
    if (!result.success) {
      next(AppError.validation(`Invalid request ${part}`, result.error.flatten()));
      return;
    }
    req[part] = result.data;
    next();
  };
}
