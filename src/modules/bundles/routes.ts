import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { ApiResponse } from '../../core/apiResponse';
import { AppError } from '../../core/appError';
import { asyncHandler } from '../../core/asyncHandler';
import { requireAuth, requireRoles } from '../../middlewares/auth';
import { zodValidate } from '../../middlewares/zodValidate';
import { bundlesService } from './service';

const router = Router();

const createSchema = z.object({
  slug: z.string().trim().regex(/^[a-z0-9-]+$/).min(3).max(60),
  name: z.string().trim().min(2).max(200),
  description: z.string().trim().max(2000).optional(),
  internshipIds: z.array(z.coerce.number().int().positive()).min(1).max(20),
  price: z.coerce.number().min(0).default(0),
});
const slugParam = z.object({ slug: z.string().trim().min(3).max(60) });
const confirmSchema = z.object({
  razorpayOrderId: z.string().min(3),
  razorpayPaymentId: z.string().min(3),
  signature: z.string().min(3),
});

function uid(req: Request): number {
  if (!req.user) throw AppError.unauthorized();
  return req.user.id;
}

// Public catalogue
router.get('/bundles', requireAuth, asyncHandler(async (_req: Request, res: Response) => {
  ApiResponse.ok(res, await bundlesService.list());
}));
router.get('/bundles/:slug', requireAuth, zodValidate(slugParam, 'params'), asyncHandler(async (req: Request, res: Response) => {
  ApiResponse.ok(res, await bundlesService.get(String(req.params.slug)));
}));

// Purchase + confirm
router.post('/bundles/:slug/purchase', requireAuth, zodValidate(slugParam, 'params'), asyncHandler(async (req: Request, res: Response) => {
  ApiResponse.created(res, await bundlesService.purchase(uid(req), String(req.params.slug)));
}));
router.post('/bundles/:slug/confirm', requireAuth, zodValidate(slugParam, 'params'), zodValidate(confirmSchema), asyncHandler(async (req: Request, res: Response) => {
  const b = req.body as { razorpayOrderId: string; razorpayPaymentId: string; signature: string };
  ApiResponse.ok(res, await bundlesService.confirm(uid(req), String(req.params.slug), b.razorpayOrderId, b.razorpayPaymentId, b.signature));
}));

// Admin: create a bundle
router.post('/admin/bundles', requireAuth, requireRoles('moderator', 'super_admin'), zodValidate(createSchema), asyncHandler(async (req: Request, res: Response) => {
  ApiResponse.created(res, await bundlesService.create(req.body as never));
}));

export default router;
