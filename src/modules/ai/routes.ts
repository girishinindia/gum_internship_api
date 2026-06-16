import { Router } from 'express';
import { asyncHandler } from '../../core/asyncHandler';
import { requireAuth, requireRoles } from '../../middlewares/auth';
import { makeRateLimiter } from '../../middlewares/rateLimiter';
import { zodValidate } from '../../middlewares/zodValidate';
import { aiController as c } from './controller';
import { answerInterviewSchema, askSchema, reindexSchema, startInterviewSchema, translateSchema } from './schemas';

const router = Router();

// AI endpoints are expensive — tighter per-IP limit on top of the daily $ cap.
const aiLimiter = makeRateLimiter({ max: 20 });

// ---- Study buddy (RAG) -----------------------------------------------------
router.post('/ai/ask', requireAuth, aiLimiter, zodValidate(askSchema), asyncHandler(c.ask));
router.get('/ai/threads', requireAuth, asyncHandler(c.listThreads));
router.get('/ai/threads/:threadId', requireAuth, asyncHandler(c.threadMessages));

// ---- Mock interview --------------------------------------------------------
router.post('/ai/interview', requireAuth, aiLimiter, zodValidate(startInterviewSchema), asyncHandler(c.startInterview));
router.post('/ai/interview/:attemptId/answer', requireAuth, aiLimiter, zodValidate(answerInterviewSchema), asyncHandler(c.answerInterview));

// ---- Read a stored translation (enrolled learners) -------------------------
router.get('/lessons/:lessonId/translation', requireAuth, asyncHandler(c.readTranslation));

// ---- Translation (instructor/admin trigger) --------------------------------
router.post('/ai/translate', requireAuth, requireRoles('instructor', 'moderator', 'super_admin'),
  aiLimiter, zodValidate(translateSchema), asyncHandler(c.translate));

// ---- RAG index (re)build (admin) -------------------------------------------
router.post('/admin/ai/reindex', requireAuth, requireRoles('moderator', 'super_admin'),
  zodValidate(reindexSchema), asyncHandler(c.reindex));

export default router;
