import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { ApiResponse } from '../../core/apiResponse';
import { AppError } from '../../core/appError';
import { asyncHandler } from '../../core/asyncHandler';
import { requireAuth, requireRoles } from '../../middlewares/auth';
import { zodValidate } from '../../middlewares/zodValidate';
import { certificatesService } from './service';

const router = Router();
const enrollmentIdParam = z.object({ enrollmentId: z.coerce.number().int().positive() });
const certificateIdParam = z.object({ certificateId: z.coerce.number().int().positive() });
const certNoParam = z.object({ certificateNo: z.string().min(6).max(40) });
const revokeSchema = z.object({ reason: z.string().min(5).max(500) });

function user(req: Request): NonNullable<Request['user']> {
  if (!req.user) throw AppError.unauthorized();
  return req.user;
}

/** Eligibility preview (owner or staff only — SEC-01 IDOR fix). */
router.get(
  '/enrollments/:enrollmentId/certificate/eligibility',
  requireAuth,
  zodValidate(enrollmentIdParam, 'params'),
  asyncHandler(async (req: Request, res: Response) => {
    const u = user(req);
    const isStaff = u.roles.some((r) => ['moderator', 'support', 'super_admin'].includes(r));
    if (!isStaff) {
      const { queryOne } = await import('../../db/pool');
      const own = await queryOne<{ user_id: number }>(
        `select user_id from enrollments where id = $1`,
        [Number(req.params.enrollmentId)],
      );
      if (!own || own.user_id !== u.id) throw AppError.notFound('Enrollment');
    }
    ApiResponse.ok(res, await certificatesService.evaluate(Number(req.params.enrollmentId)));
  }),
);

router.post(
  '/enrollments/:enrollmentId/certificate',
  requireAuth,
  requireRoles('student'),
  zodValidate(enrollmentIdParam, 'params'),
  asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.created(res, await certificatesService.claim(user(req).id, Number(req.params.enrollmentId)));
  }),
);

router.get(
  '/certificates/me',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await certificatesService.myCertificates(user(req).id));
  }),
);

router.get(
  '/certificates/:certificateId/download',
  requireAuth,
  zodValidate(certificateIdParam, 'params'),
  asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await certificatesService.downloadLink(user(req).id, Number(req.params.certificateId)));
  }),
);

/** PUBLIC verification — no auth, minimal payload, rate-limited globally. */
router.get(
  '/verify/:certificateNo',
  zodValidate(certNoParam, 'params'),
  asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await certificatesService.verify(String(req.params.certificateNo)));
  }),
);

router.post(
  '/admin/certificates/:certificateId/revoke',
  requireAuth,
  requireRoles('moderator'),
  zodValidate(certificateIdParam, 'params'),
  zodValidate(revokeSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { reason } = req.body as { reason: string };
    await certificatesService.revoke(user(req).id, Number(req.params.certificateId), reason);
    ApiResponse.ok(res, { message: 'Certificate revoked' });
  }),
);

export default router;
