import { Router } from 'express';
import type { Request, Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { env } from '../../config/env';
import { ApiResponse } from '../../core/apiResponse';
import { AppError } from '../../core/appError';
import { ErrorCodes } from '../../core/errorCodes';
import { asyncHandler } from '../../core/asyncHandler';
import { requireAuth, requireRoles } from '../../middlewares/auth';
import { zodValidate } from '../../middlewares/zodValidate';
import { mediaService } from './service';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const lessonIdParam = z.object({ lessonId: z.coerce.number().int().positive() });
const progressSchema = z.object({
  enrollmentId: z.coerce.number().int().positive(),
  watchedSeconds: z.coerce.number().int().min(0).max(86_400).optional(),
  completed: z.boolean().optional(),
});
const playQuery = z.object({ enrollmentId: z.coerce.number().int().positive() });

function user(req: Request): NonNullable<Request['user']> {
  if (!req.user) throw AppError.unauthorized();
  return req.user;
}

/** Multipart upload, API-mediated: field "file" + field "folder". */
router.post(
  '/media/upload',
  requireAuth,
  upload.single('file'),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) throw AppError.validation('Attach a multipart "file" field');
    const folder = String((req.body as Record<string, unknown>).folder ?? '');
    ApiResponse.created(res, await mediaService.upload(user(req), folder, req.file));
  }),
);

router.post(
  '/lessons/:lessonId/video-upload',
  requireAuth,
  requireRoles('instructor', 'moderator'),
  zodValidate(lessonIdParam, 'params'),
  asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await mediaService.createLessonVideo(user(req), Number(req.params.lessonId)));
  }),
);

router.delete(
  '/lessons/:lessonId/video',
  requireAuth,
  requireRoles('instructor', 'moderator'),
  zodValidate(lessonIdParam, 'params'),
  asyncHandler(async (req: Request, res: Response) => {
    await mediaService.deleteLessonVideo(user(req), Number(req.params.lessonId));
    ApiResponse.ok(res, { message: 'Video detached and deleted' });
  }),
);

/** Bunny Stream encode webhook — shared secret in HEADER (SEC-03: never in
 *  the URL, query strings land in access logs/proxies). Configure the Bunny
 *  webhook with header `x-webhook-secret`. */
router.post(
  '/media/bunny/webhook',
  asyncHandler(async (req: Request, res: Response) => {
    if (req.headers['x-webhook-secret'] !== env.BUNNY_STREAM_WEBHOOK_SECRET) {
      throw new AppError(ErrorCodes.WEBHOOK_SIGNATURE_INVALID, 'Bad webhook secret');
    }
    ApiResponse.ok(res, await mediaService.handleStreamWebhook(req.body as Record<string, unknown>));
  }),
);

router.get(
  '/lessons/:lessonId/play',
  requireAuth,
  zodValidate(lessonIdParam, 'params'),
  zodValidate(playQuery, 'query'),
  asyncHandler(async (req: Request, res: Response) => {
    const q = req.query as unknown as { enrollmentId: number };
    ApiResponse.ok(
      res,
      await mediaService.play(user(req).id, Number(req.params.lessonId), q.enrollmentId, req.ip ?? null),
    );
  }),
);

router.post(
  '/lessons/:lessonId/progress',
  requireAuth,
  zodValidate(lessonIdParam, 'params'),
  zodValidate(progressSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const b = req.body as { enrollmentId: number; watchedSeconds?: number; completed?: boolean };
    ApiResponse.ok(
      res,
      await mediaService.progress(
        user(req).id,
        Number(req.params.lessonId),
        b.enrollmentId,
        b.watchedSeconds,
        b.completed,
      ),
    );
  }),
);

export default router;
