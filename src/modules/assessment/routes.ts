import { Router } from 'express';
import { asyncHandler } from '../../core/asyncHandler';
import { requireAuth } from '../../middlewares/auth';
import { zodValidate } from '../../middlewares/zodValidate';
import { assessmentController as c } from './controller';
import { submitSchema, trackParam } from './schemas';

const router = Router();

// Diagnostic is available to any authenticated user (pre-enrollment guidance).
router.get('/assessment/tracks', requireAuth, asyncHandler(c.tracks));
router.get('/assessment/:track', requireAuth, zodValidate(trackParam, 'params'), asyncHandler(c.diagnostic));
router.post('/assessment/submit', requireAuth, zodValidate(submitSchema), asyncHandler(c.submit));
router.get('/assessment/me/attempts', requireAuth, asyncHandler(c.myAttempts));

export default router;
