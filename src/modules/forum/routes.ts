import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../core/asyncHandler';
import { requireAuth, requireRoles } from '../../middlewares/auth';
import { zodValidate } from '../../middlewares/zodValidate';
import { forumController as c } from './controller';
import { createThreadSchema, listThreadsQuery, moderateThreadSchema, replySchema } from './schemas';

const router = Router();
const threadIdParam = z.object({ threadId: z.coerce.number().int().positive() });
const replyParams = z.object({ threadId: z.coerce.number().int().positive(), replyId: z.coerce.number().int().positive() });

// ---- Threads + replies (authenticated) -------------------------------------
router.get('/forum/threads', requireAuth, zodValidate(listThreadsQuery, 'query'), asyncHandler(c.list));
router.post('/forum/threads', requireAuth, zodValidate(createThreadSchema), asyncHandler(c.create));
router.get('/forum/threads/:threadId', requireAuth, zodValidate(threadIdParam, 'params'), asyncHandler(c.get));
router.post('/forum/threads/:threadId/replies', requireAuth, zodValidate(threadIdParam, 'params'), zodValidate(replySchema), asyncHandler(c.reply));
router.post('/forum/threads/:threadId/replies/:replyId/accept', requireAuth, zodValidate(replyParams, 'params'), asyncHandler(c.accept));

// ---- Moderation (staff) ----------------------------------------------------
router.patch('/admin/forum/threads/:threadId', requireAuth, requireRoles('moderator', 'support', 'super_admin'),
  zodValidate(threadIdParam, 'params'), zodValidate(moderateThreadSchema), asyncHandler(c.moderate));
router.delete('/admin/forum/replies/:replyId', requireAuth, requireRoles('moderator', 'support', 'super_admin'),
  zodValidate(z.object({ replyId: z.coerce.number().int().positive() }), 'params'), asyncHandler(c.deleteReply));

export default router;
