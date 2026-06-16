import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { ApiResponse } from '../../core/apiResponse';
import { AppError } from '../../core/appError';
import { asyncHandler } from '../../core/asyncHandler';
import { requireAuth, requireRoles } from '../../middlewares/auth';
import { zodValidate } from '../../middlewares/zodValidate';
import { batchCreateSchema, batchPatchSchema, batchesService } from './batches';
import type { BatchCreateInput, BatchPatchInput } from './batches';

/**
 * Internship AUTHORING arrives in its own session. Batch management shipped
 * early because module 2.4 (enrollments) depends on it.
 */
const router = Router();

const internshipIdParam = z.object({ internshipId: z.coerce.number().int().positive() });
const batchIdParam = z.object({ batchId: z.coerce.number().int().positive() });

function user(req: Request): NonNullable<Request['user']> {
  if (!req.user) throw AppError.unauthorized();
  return req.user;
}

router.post(
  '/internships/:internshipId/batches',
  requireAuth,
  requireRoles('instructor', 'moderator'),
  zodValidate(internshipIdParam, 'params'),
  zodValidate(batchCreateSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const batch = await batchesService.create(
      user(req),
      Number(req.params.internshipId),
      req.body as BatchCreateInput,
    );
    ApiResponse.created(res, batch);
  }),
);

router.get(
  '/internships/:internshipId/batches',
  requireAuth,
  requireRoles('instructor', 'moderator'),
  zodValidate(internshipIdParam, 'params'),
  asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await batchesService.list(user(req), Number(req.params.internshipId)));
  }),
);

router.patch(
  '/batches/:batchId',
  requireAuth,
  requireRoles('instructor', 'moderator'),
  zodValidate(batchIdParam, 'params'),
  zodValidate(batchPatchSchema),
  asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(
      res,
      await batchesService.patch(user(req), Number(req.params.batchId), req.body as BatchPatchInput),
    );
  }),
);

router.get(
  '/batches/:batchId/students',
  requireAuth,
  requireRoles('instructor', 'moderator', 'support'),
  zodValidate(batchIdParam, 'params'),
  asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await batchesService.students(user(req), Number(req.params.batchId)));
  }),
);

export default router;
