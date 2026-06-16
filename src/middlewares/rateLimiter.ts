import { rateLimit } from 'express-rate-limit';
import type { RequestHandler } from 'express';
import { env, isTest } from '../config/env';
import { ApiResponse } from '../core/apiResponse';
import { ErrorCodes } from '../core/errorCodes';
import { rateLimitStore } from '../services/redis';

interface RateLimiterOptions {
  windowMs?: number;
  max: number;
  /** Optional key override, e.g. by phone number for OTP endpoints. */
  keyGenerator?: (req: Parameters<RequestHandler>[0]) => string;
}

/**
 * Factory for per-route limiters that respond with the standard envelope.
 * NFR-03: 5/min OTP per destination, 10/min auth per IP, 100/min general.
 */
export function makeRateLimiter(opts: RateLimiterOptions): RequestHandler {
  return rateLimit({
    windowMs: opts.windowMs ?? 60_000,
    limit: isTest ? Number.MAX_SAFE_INTEGER : opts.max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Distributed limits when Redis is configured; in-memory otherwise.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    store: rateLimitStore() as any,
    keyGenerator: opts.keyGenerator,
    handler: (_req, res) => {
      ApiResponse.fail(
        res,
        429,
        ErrorCodes.RATE_LIMITED,
        'Too many requests — please try again shortly',
      );
    },
  });
}

export const generalLimiter = makeRateLimiter({ max: env.RATE_LIMIT_GENERAL_PER_MINUTE });
export const authLimiter = makeRateLimiter({ max: env.RATE_LIMIT_AUTH_PER_MINUTE });
export const otpLimiter = makeRateLimiter({
  max: env.RATE_LIMIT_OTP_PER_MINUTE,
  keyGenerator: (req) => {
    const destination =
      typeof (req.body as Record<string, unknown> | undefined)?.destination === 'string'
        ? String((req.body as Record<string, unknown>).destination)
        : req.ip ?? 'unknown';
    return `otp:${destination}`;
  },
});
