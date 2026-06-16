import { Router } from 'express';
import type { Request, Response } from 'express';
import { ApiResponse } from '../../core/apiResponse';
import { AppError } from '../../core/appError';
import { asyncHandler } from '../../core/asyncHandler';
import { requireAuth, requireRoles } from '../../middlewares/auth';
import { zodValidate } from '../../middlewares/zodValidate';
import { storageService } from '../../services/storage';
import { enrollmentsService as svc } from './service';
import { enrollmentsRepository as repo } from './repository';
import {
  enrollSchema,
  enrollmentIdParam,
  myEnrollmentsSchema,
  transferSchema,
} from './schemas';
import type { EnrollInput, MyEnrollmentsInput, TransferInput } from './schemas';

const router = Router();

function uid(req: Request): number {
  if (!req.user) throw AppError.unauthorized();
  return req.user.id;
}

router.post(
  '/enrollments',
  requireAuth,
  requireRoles('student'),
  zodValidate(enrollSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const input = req.body as EnrollInput;
    const enrollment = await svc.enrollFree(uid(req), {
      internshipId: input.internshipId,
      batchId: input.batchId,
    });
    ApiResponse.created(res, enrollment);
  }),
);

router.get(
  '/enrollments/me',
  requireAuth,
  zodValidate(myEnrollmentsSchema, 'query'),
  asyncHandler(async (req: Request, res: Response) => {
    const input = req.query as unknown as MyEnrollmentsInput;
    const { items, pagination } = await svc.myEnrollments(uid(req), input);
    ApiResponse.paginated(res, items, pagination);
  }),
);

router.post(
  '/enrollments/:enrollmentId/drop',
  requireAuth,
  zodValidate(enrollmentIdParam, 'params'),
  asyncHandler(async (req: Request, res: Response) => {
    await svc.drop(uid(req), Number(req.params.enrollmentId));
    ApiResponse.ok(res, { message: 'Enrollment dropped' });
  }),
);

/** Signed URL for the offer letter PDF (owner only). */
router.get(
  '/enrollments/:enrollmentId/offer-letter',
  requireAuth,
  zodValidate(enrollmentIdParam, 'params'),
  asyncHandler(async (req: Request, res: Response) => {
    const enrollment = await repo.findById(Number(req.params.enrollmentId));
    if (!enrollment || enrollment.user_id !== uid(req)) throw AppError.notFound('Enrollment');
    if (!enrollment.offer_letter_url) {
      throw AppError.notFound('Offer letter (still generating — try again shortly)');
    }
    ApiResponse.ok(res, {
      offerLetterNo: enrollment.offer_letter_no,
      ...storageService.signedPrivateUrl(enrollment.offer_letter_url),
    });
  }),
);

/** Classroom view: curriculum + per-lesson completion/lock + progress (owner). */
router.get(
  '/enrollments/:enrollmentId/curriculum',
  requireAuth,
  zodValidate(enrollmentIdParam, 'params'),
  asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await svc.classroom(uid(req), Number(req.params.enrollmentId)));
  }),
);

/** Upcoming live sessions across the caller's active enrollments. */
router.get(
  '/me/live-sessions',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await svc.myLiveSessions(uid(req)));
  }),
);

/** Admin/support: batch transfer (audited). */
router.post(
  '/admin/enrollments/:enrollmentId/transfer',
  requireAuth,
  requireRoles('moderator', 'support'),
  zodValidate(enrollmentIdParam, 'params'),
  zodValidate(transferSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await svc.transfer(
      uid(req),
      Number(req.params.enrollmentId),
      req.body as TransferInput,
    );
    ApiResponse.ok(res, result);
  }),
);

export default router;
