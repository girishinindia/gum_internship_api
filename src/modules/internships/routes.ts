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
import {
  authoringService,
  createInternshipSchema,
  patchInternshipSchema,
  listInternshipsSchema,
  statusActionSchema,
  sectionCreateSchema,
  sectionPatchSchema,
  lessonCreateSchema,
  lessonPatchSchema,
} from './authoring';
import type {
  CreateInternshipInput,
  PatchInternshipInput,
  ListInternshipsInput,
  StatusActionInput,
  SectionCreateInput,
  SectionPatchInput,
  LessonCreateInput,
  LessonPatchInput,
} from './authoring';

/**
 * Internship AUTHORING arrives in its own session. Batch management shipped
 * early because module 2.4 (enrollments) depends on it.
 */
const router = Router();

const internshipIdParam = z.object({ internshipId: z.coerce.number().int().positive() });
const batchIdParam = z.object({ batchId: z.coerce.number().int().positive() });
const sectionIdParam = z.object({ sectionId: z.coerce.number().int().positive() });
const lessonIdParam = z.object({ lessonId: z.coerce.number().int().positive() });

function user(req: Request): NonNullable<Request['user']> {
  if (!req.user) throw AppError.unauthorized();
  return req.user;
}

/* ============================ Internship authoring ===========================
 * Instructors manage only their own internships; moderators/super_admin any.
 * (super_admin passes every requireRoles guard by design.)
 * ========================================================================== */

router.post(
  '/internships',
  requireAuth,
  requireRoles('instructor', 'moderator'),
  zodValidate(createInternshipSchema),
  asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.created(res, await authoringService.create(user(req), req.body as CreateInternshipInput));
  }),
);

router.get(
  '/internships',
  requireAuth,
  requireRoles('instructor', 'moderator'),
  zodValidate(listInternshipsSchema, 'query'),
  asyncHandler(async (req: Request, res: Response) => {
    const { items, pagination } = await authoringService.list(user(req), req.query as unknown as ListInternshipsInput);
    ApiResponse.paginated(res, items, pagination);
  }),
);

router.get(
  '/internships/:internshipId',
  requireAuth,
  requireRoles('instructor', 'moderator'),
  zodValidate(internshipIdParam, 'params'),
  asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await authoringService.get(user(req), Number(req.params.internshipId)));
  }),
);

router.patch(
  '/internships/:internshipId',
  requireAuth,
  requireRoles('instructor', 'moderator'),
  zodValidate(internshipIdParam, 'params'),
  zodValidate(patchInternshipSchema),
  asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await authoringService.patch(user(req), Number(req.params.internshipId), req.body as PatchInternshipInput));
  }),
);

router.post(
  '/internships/:internshipId/status',
  requireAuth,
  requireRoles('instructor', 'moderator'),
  zodValidate(internshipIdParam, 'params'),
  zodValidate(statusActionSchema),
  asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await authoringService.setStatus(user(req), Number(req.params.internshipId), req.body as StatusActionInput));
  }),
);

/* ------------------------------- curriculum ------------------------------- */
router.post(
  '/internships/:internshipId/sections',
  requireAuth,
  requireRoles('instructor', 'moderator'),
  zodValidate(internshipIdParam, 'params'),
  zodValidate(sectionCreateSchema),
  asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.created(res, await authoringService.addSection(user(req), Number(req.params.internshipId), req.body as SectionCreateInput));
  }),
);

router.patch(
  '/sections/:sectionId',
  requireAuth,
  requireRoles('instructor', 'moderator'),
  zodValidate(sectionIdParam, 'params'),
  zodValidate(sectionPatchSchema),
  asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await authoringService.patchSection(user(req), Number(req.params.sectionId), req.body as SectionPatchInput));
  }),
);

router.delete(
  '/sections/:sectionId',
  requireAuth,
  requireRoles('instructor', 'moderator'),
  zodValidate(sectionIdParam, 'params'),
  asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await authoringService.deleteSection(user(req), Number(req.params.sectionId)));
  }),
);

router.post(
  '/sections/:sectionId/lessons',
  requireAuth,
  requireRoles('instructor', 'moderator'),
  zodValidate(sectionIdParam, 'params'),
  zodValidate(lessonCreateSchema),
  asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.created(res, await authoringService.addLesson(user(req), Number(req.params.sectionId), req.body as LessonCreateInput));
  }),
);

router.patch(
  '/lessons/:lessonId',
  requireAuth,
  requireRoles('instructor', 'moderator'),
  zodValidate(lessonIdParam, 'params'),
  zodValidate(lessonPatchSchema),
  asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await authoringService.patchLesson(user(req), Number(req.params.lessonId), req.body as LessonPatchInput));
  }),
);

router.delete(
  '/lessons/:lessonId',
  requireAuth,
  requireRoles('instructor', 'moderator'),
  zodValidate(lessonIdParam, 'params'),
  asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await authoringService.deleteLesson(user(req), Number(req.params.lessonId)));
  }),
);

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
