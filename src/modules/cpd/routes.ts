import { Router } from 'express';
import type { Request, Response } from 'express';
import { ApiResponse } from '../../core/apiResponse';
import { AppError } from '../../core/appError';
import { asyncHandler } from '../../core/asyncHandler';
import { requireAuth } from '../../middlewares/auth';
import { cpdService } from './service';

const router = Router();

router.get('/me/cpd', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw AppError.unauthorized();
  ApiResponse.ok(res, await cpdService.myCpd(req.user.id));
}));

export default router;
