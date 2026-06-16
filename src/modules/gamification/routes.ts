import { Router } from 'express';
import { asyncHandler } from '../../core/asyncHandler';
import { requireAuth } from '../../middlewares/auth';
import { gamificationController as c } from './controller';

const router = Router();

router.get('/me/xp', requireAuth, asyncHandler(c.myXp));
router.get('/me/badges', requireAuth, asyncHandler(c.myBadges));
// Leaderboard is visible to any authenticated user (cohort-wide ranking).
router.get('/leaderboard', requireAuth, asyncHandler(c.leaderboard));

export default router;
