import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { ApiResponse } from '../../core/apiResponse';
import { AppError } from '../../core/appError';
import { asyncHandler } from '../../core/asyncHandler';
import { requireAuth, requireRoles } from '../../middlewares/auth';
import { zodValidate } from '../../middlewares/zodValidate';
import { projectsService } from './service';

const router = Router();

const projectIdParam = z.object({ projectId: z.coerce.number().int().positive() });
const taskIdParam = z.object({ taskId: z.coerce.number().int().positive() });
const submissionIdParam = z.object({ submissionId: z.coerce.number().int().positive() });
const enrollmentIdParam = z.object({ enrollmentId: z.coerce.number().int().positive() });

const taskUpsertSchema = z.object({
  weekNumber: z.coerce.number().int().min(1).max(52),
  title: z.string().min(3).max(160),
  instructions: z.string().max(8000).optional(),
  allowedSubmissionTypes: z.array(z.enum(['file', 'github_url', 'live_url', 'video_url'])).min(1).optional(),
  maxScore: z.coerce.number().positive().optional(),
  rubric: z.array(z.object({ criterion: z.string(), weight: z.number(), maxPoints: z.number() })).min(1),
  dueOffsetDays: z.coerce.number().int().min(0).optional(),
  weight: z.coerce.number().positive().default(1),
  isMandatory: z.boolean().default(true),
});

/** A github_url submission must actually point at a GitHub repo (host + owner/repo). */
const GITHUB_RE = /^https?:\/\/(www\.)?github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(\/.*)?$/i;

const submitSchema = z
  .object({
    enrollmentId: z.coerce.number().int().positive(),
    submissionType: z.enum(['file', 'github_url', 'live_url', 'video_url']),
    fileUrl: z.string().min(3).optional(),
    urlValue: z.string().optional(),
    notes: z.string().max(2000).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.submissionType === 'file') {
      if (!v.fileUrl) ctx.addIssue({ code: 'custom', path: ['fileUrl'], message: 'File submissions need an uploaded file' });
      return;
    }
    const url = v.urlValue?.trim();
    if (!url) {
      ctx.addIssue({ code: 'custom', path: ['urlValue'], message: 'Enter the submission URL' });
      return;
    }
    if (!/^https?:\/\/\S+\.\S+/i.test(url)) {
      ctx.addIssue({ code: 'custom', path: ['urlValue'], message: 'Enter a valid URL starting with http:// or https://' });
      return;
    }
    if (v.submissionType === 'github_url' && !GITHUB_RE.test(url)) {
      ctx.addIssue({ code: 'custom', path: ['urlValue'], message: 'Enter a valid GitHub repository URL, e.g. https://github.com/your-name/your-repo' });
    }
  });

const reviewSchema = z.object({
  decision: z.enum(['approved', 'resubmit']),
  rubricScores: z.array(z.object({ criterion: z.string().min(1), points: z.number().min(0) })).min(1),
  feedback: z.string().max(4000).optional(),
});

const queueQuery = z.object({
  internshipId: z.coerce.number().int().positive().optional(),
  batchId: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

function user(req: Request): NonNullable<Request['user']> {
  if (!req.user) throw AppError.unauthorized();
  return req.user;
}

router.post(
  '/projects/:projectId/tasks',
  requireAuth,
  requireRoles('instructor', 'moderator'),
  zodValidate(projectIdParam, 'params'),
  zodValidate(taskUpsertSchema),
  asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.created(
      res,
      await projectsService.upsertTask(user(req), Number(req.params.projectId), null, req.body as Record<string, unknown>),
    );
  }),
);

router.patch(
  '/projects/:projectId/tasks/:taskId',
  requireAuth,
  requireRoles('instructor', 'moderator'),
  zodValidate(projectIdParam.merge(taskIdParam), 'params'),
  zodValidate(taskUpsertSchema),
  asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(
      res,
      await projectsService.upsertTask(
        user(req),
        Number(req.params.projectId),
        Number(req.params.taskId),
        req.body as Record<string, unknown>,
      ),
    );
  }),
);

router.get(
  '/enrollments/:enrollmentId/tasks',
  requireAuth,
  zodValidate(enrollmentIdParam, 'params'),
  asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await projectsService.tasksForEnrollment(user(req).id, Number(req.params.enrollmentId)));
  }),
);

router.post(
  '/tasks/:taskId/submissions',
  requireAuth,
  requireRoles('student'),
  zodValidate(taskIdParam, 'params'),
  zodValidate(submitSchema),
  asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.created(res, await projectsService.submit(user(req).id, Number(req.params.taskId), req.body as never));
  }),
);

router.get(
  '/instructor/review-queue',
  requireAuth,
  requireRoles('instructor', 'moderator'),
  zodValidate(queueQuery, 'query'),
  asyncHandler(async (req: Request, res: Response) => {
    const q = req.query as unknown as z.infer<typeof queueQuery>;
    const { items, pagination } = await projectsService.reviewQueue(user(req), q);
    ApiResponse.paginated(res, items, pagination);
  }),
);

router.post(
  '/submissions/:submissionId/review',
  requireAuth,
  requireRoles('instructor', 'moderator'),
  zodValidate(submissionIdParam, 'params'),
  zodValidate(reviewSchema),
  asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.created(res, await projectsService.review(user(req), Number(req.params.submissionId), req.body as never));
  }),
);

export default router;
