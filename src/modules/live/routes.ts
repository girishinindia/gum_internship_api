import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { ApiResponse } from '../../core/apiResponse';
import { AppError } from '../../core/appError';
import { asyncHandler } from '../../core/asyncHandler';
import { requireAuth, requireRoles } from '../../middlewares/auth';
import { zodValidate } from '../../middlewares/zodValidate';
import { liveService } from './service';

const router = Router();

const batchIdParam = z.object({ batchId: z.coerce.number().int().positive() });
const sessionIdParam = z.object({ liveSessionId: z.coerce.number().int().positive() });
const enrollmentIdParam = z.object({ enrollmentId: z.coerce.number().int().positive() });

const scheduleSchema = z.object({
  title: z.string().min(3).max(160),
  startsAt: z.string().datetime({ offset: true }),
  durationMinutes: z.coerce.number().int().min(15).max(480),
  provider: z.enum(['zoom', 'google_meet']),
  manualJoinUrl: z.string().url().optional(),
});
const joinQuery = z.object({ enrollmentId: z.coerce.number().int().positive() });
const attendanceSchema = z.object({
  records: z
    .array(
      z.object({
        enrollmentId: z.coerce.number().int().positive(),
        status: z.enum(['present', 'late', 'absent']),
      }),
    )
    .min(1)
    .max(500),
});
const recordingSchema = z.object({ bunnyVideoId: z.string().min(6).max(80) });

function user(req: Request): NonNullable<Request['user']> {
  if (!req.user) throw AppError.unauthorized();
  return req.user;
}

router.post(
  '/batches/:batchId/live-sessions',
  requireAuth,
  requireRoles('instructor', 'moderator'),
  zodValidate(batchIdParam, 'params'),
  zodValidate(scheduleSchema),
  asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.created(
      res,
      await liveService.schedule(user(req), Number(req.params.batchId), req.body as never),
    );
  }),
);

router.get(
  '/batches/:batchId/live-sessions',
  requireAuth,
  zodValidate(batchIdParam, 'params'),
  asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await liveService.listForBatch(user(req), Number(req.params.batchId)));
  }),
);

router.get(
  '/live-sessions/:liveSessionId/join',
  requireAuth,
  requireRoles('student'),
  zodValidate(sessionIdParam, 'params'),
  zodValidate(joinQuery, 'query'),
  asyncHandler(async (req: Request, res: Response) => {
    const q = req.query as unknown as { enrollmentId: number };
    ApiResponse.ok(
      res,
      await liveService.join(user(req).id, Number(req.params.liveSessionId), q.enrollmentId),
    );
  }),
);

router.post(
  '/live-sessions/:liveSessionId/attendance',
  requireAuth,
  requireRoles('instructor', 'moderator'),
  zodValidate(sessionIdParam, 'params'),
  zodValidate(attendanceSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { records } = req.body as { records: { enrollmentId: number; status: 'present' | 'late' | 'absent' }[] };
    ApiResponse.ok(res, await liveService.markAttendance(user(req), Number(req.params.liveSessionId), records));
  }),
);

router.post(
  '/live-sessions/:liveSessionId/recording',
  requireAuth,
  requireRoles('instructor', 'moderator'),
  zodValidate(sessionIdParam, 'params'),
  zodValidate(recordingSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { bunnyVideoId } = req.body as { bunnyVideoId: string };
    ApiResponse.ok(
      res,
      await liveService.attachRecording(user(req), Number(req.params.liveSessionId), bunnyVideoId),
    );
  }),
);

/** Attendance % for an enrollment (owner or staff only — SEC-02 IDOR fix). */
router.get(
  '/enrollments/:enrollmentId/attendance',
  requireAuth,
  zodValidate(enrollmentIdParam, 'params'),
  asyncHandler(async (req: Request, res: Response) => {
    const u = user(req);
    const isStaff = u.roles.some((r) => ['instructor', 'moderator', 'support', 'super_admin'].includes(r));
    if (!isStaff) {
      const { queryOne } = await import('../../db/pool');
      const own = await queryOne<{ user_id: number }>(
        `select user_id from enrollments where id = $1`,
        [Number(req.params.enrollmentId)],
      );
      if (!own || own.user_id !== u.id) throw AppError.notFound('Enrollment');
    }
    ApiResponse.ok(res, {
      enrollmentId: Number(req.params.enrollmentId),
      attendancePercent: await liveService.attendancePercent(Number(req.params.enrollmentId)),
    });
  }),
);

export default router;
