import { Router } from 'express';
import { asyncHandler } from '../../core/asyncHandler';
import { requireAuth } from '../../middlewares/auth';
import { zodValidate } from '../../middlewares/zodValidate';
import { portfolioController as c } from './controller';
import { handleParamSchema, upsertPortfolioSchema } from './schemas';

const router = Router();

// ---- Owner (authenticated) -------------------------------------------------
router.get('/users/me/portfolio', requireAuth, asyncHandler(c.getMine));
router.put(
  '/users/me/portfolio',
  requireAuth,
  zodValidate(upsertPortfolioSchema),
  asyncHandler(c.upsertMine),
);
// Resume PDF built from verified record → signed private URL
router.get('/users/me/resume', requireAuth, asyncHandler(c.resume));

// ---- Public credential wallet (no auth; privacy-aware in the service) ------
router.get('/p/:handle', zodValidate(handleParamSchema, 'params'), asyncHandler(c.getPublic));

export default router;
