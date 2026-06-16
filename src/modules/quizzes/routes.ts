import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { ApiResponse } from '../../core/apiResponse';
import { AppError } from '../../core/appError';
import { asyncHandler } from '../../core/asyncHandler';
import { requireAuth, requireRoles } from '../../middlewares/auth';
import { zodValidate } from '../../middlewares/zodValidate';
import { quizzesService } from './service';

const router = Router();

const quizIdParam = z.object({ quizId: z.coerce.number().int().positive() });
const attemptIdParam = z.object({ attemptId: z.coerce.number().int().positive() });
const enrollmentQuery = z.object({ enrollmentId: z.coerce.number().int().positive() });
const enrollmentBody = z.object({ enrollmentId: z.coerce.number().int().positive() });

const questionSchema = z.object({
  questionText: z.string().min(5).max(1000),
  questionType: z.enum(['single_choice', 'multiple_choice', 'true_false']),
  options: z.array(z.object({ id: z.string().min(1).max(4), text: z.string().min(1) })).min(2).max(8),
  correctOptions: z.array(z.string()).min(1),
  explanation: z.string().max(1000).optional(),
  marks: z.coerce.number().positive().max(100).default(1),
});

const answersSchema = z.object({ answers: z.record(z.array(z.string())) });

function user(req: Request): NonNullable<Request['user']> {
  if (!req.user) throw AppError.unauthorized();
  return req.user;
}

router.post(
  '/quizzes/:quizId/questions',
  requireAuth,
  requireRoles('instructor', 'moderator'),
  zodValidate(quizIdParam, 'params'),
  zodValidate(questionSchema),
  asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.created(res, await quizzesService.addQuestion(user(req), Number(req.params.quizId), req.body as Record<string, unknown>));
  }),
);

router.get(
  '/quizzes/:quizId',
  requireAuth,
  requireRoles('student'),
  zodValidate(quizIdParam, 'params'),
  zodValidate(enrollmentQuery, 'query'),
  asyncHandler(async (req: Request, res: Response) => {
    const q = req.query as unknown as { enrollmentId: number };
    ApiResponse.ok(res, await quizzesService.quizForStudent(user(req).id, Number(req.params.quizId), q.enrollmentId));
  }),
);

router.post(
  '/quizzes/:quizId/attempts',
  requireAuth,
  requireRoles('student'),
  zodValidate(quizIdParam, 'params'),
  zodValidate(enrollmentBody),
  asyncHandler(async (req: Request, res: Response) => {
    const { enrollmentId } = req.body as { enrollmentId: number };
    ApiResponse.created(res, await quizzesService.startAttempt(user(req).id, Number(req.params.quizId), enrollmentId));
  }),
);

router.put(
  '/attempts/:attemptId/answers',
  requireAuth,
  requireRoles('student'),
  zodValidate(attemptIdParam, 'params'),
  zodValidate(answersSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { answers } = req.body as { answers: Record<string, string[]> };
    await quizzesService.saveAnswers(user(req).id, Number(req.params.attemptId), answers);
    ApiResponse.ok(res, { message: 'Saved' });
  }),
);

router.post(
  '/attempts/:attemptId/submit',
  requireAuth,
  requireRoles('student'),
  zodValidate(attemptIdParam, 'params'),
  asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await quizzesService.submitAttempt(user(req).id, Number(req.params.attemptId)));
  }),
);

router.get(
  '/attempts/:attemptId/result',
  requireAuth,
  requireRoles('student'),
  zodValidate(attemptIdParam, 'params'),
  asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await quizzesService.result(user(req).id, Number(req.params.attemptId)));
  }),
);

export default router;
