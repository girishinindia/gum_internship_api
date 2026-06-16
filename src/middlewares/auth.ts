import type { NextFunction, Request, RequestHandler, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { AppError } from '../core/appError';
import { ErrorCodes } from '../core/errorCodes';

/**
 * Access-token guard (module 2.2). Access JWTs are STATELESS by design — they
 * live 15 minutes and carry { sub: string(userId), roles }. Revocation happens
 * at the refresh boundary: user_sessions rows are hashed, rotated on every
 * refresh, and reuse of a rotated token revokes the whole device fleet
 * (see modules/auth/service.ts#refresh).
 */

export type RoleName =
  | 'student'
  | 'instructor'
  | 'moderator'
  | 'finance_admin'
  | 'support'
  | 'super_admin'
  | 'employer';

export interface AuthUser {
  id: number;
  roles: RoleName[];
}

interface AccessTokenPayload extends jwt.JwtPayload {
  sub: string;
  roles: RoleName[];
}

/** Rejects with 401 unless a valid Bearer access token is present. */
export const requireAuth: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    next(AppError.unauthorized());
    return;
  }
  const token = header.slice('Bearer '.length);
  try {
    // SEC-05: pin the algorithm — never let the header pick it.
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      algorithms: ['HS256'],
    }) as AccessTokenPayload;
    const id = Number(payload.sub);
    if (!Number.isInteger(id) || id <= 0 || !Array.isArray(payload.roles)) {
      next(AppError.unauthorized('Invalid token payload'));
      return;
    }
    req.user = { id, roles: payload.roles };
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      next(new AppError(ErrorCodes.TOKEN_EXPIRED, 'Access token expired'));
      return;
    }
    next(AppError.unauthorized('Invalid access token'));
  }
};

/** Role guard. Usage: router.get('/x', requireAuth, requireRoles('moderator', 'super_admin'), h) */
export function requireRoles(...allowed: RoleName[]): RequestHandler {
  return (req, _res, next) => {
    const user = req.user;
    if (!user) {
      next(AppError.unauthorized());
      return;
    }
    // super_admin passes every guard by design (SRS §2 permissions matrix)
    if (user.roles.includes('super_admin') || user.roles.some((r) => allowed.includes(r))) {
      next();
      return;
    }
    next(AppError.forbidden());
  };
}
