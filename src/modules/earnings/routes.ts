import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { ApiResponse } from '../../core/apiResponse';
import { AppError } from '../../core/appError';
import { asyncHandler } from '../../core/asyncHandler';
import { requireAuth, requireRoles } from '../../middlewares/auth';
import { zodValidate } from '../../middlewares/zodValidate';
import { earningsService } from './service';

const router = Router();
const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
const settlementIdParam = z.object({ settlementId: z.coerce.number().int().positive() });
const createSettlementSchema = z.object({
  instructorProfileId: z.coerce.number().int().positive(),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  tdsPercent: z.coerce.number().min(0).max(30).default(10),
  notes: z.string().max(500).optional(),
});
const settlementStatusSchema = z.object({
  status: z.enum(['approved', 'paid']),
  utrNumber: z.string().min(6).max(40).optional(),
});

function uid(req: Request): number {
  if (!req.user) throw AppError.unauthorized();
  return req.user.id;
}

router.get('/instructor/earnings/summary', requireAuth, requireRoles('instructor'),
  asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await earningsService.summary(uid(req)));
  }));

router.get('/instructor/earnings', requireAuth, requireRoles('instructor'), zodValidate(pageQuery, 'query'),
  asyncHandler(async (req: Request, res: Response) => {
    const q = req.query as unknown as z.infer<typeof pageQuery>;
    const { items, pagination } = await earningsService.ledger(uid(req), q.page, q.limit);
    ApiResponse.paginated(res, items, pagination);
  }));

router.get('/instructor/payouts', requireAuth, requireRoles('instructor'), zodValidate(pageQuery, 'query'),
  asyncHandler(async (req: Request, res: Response) => {
    const q = req.query as unknown as z.infer<typeof pageQuery>;
    const { items, pagination } = await earningsService.listSettlements(uid(req), q.page, q.limit);
    ApiResponse.paginated(res, items, pagination);
  }));

router.get('/instructor/payouts/:settlementId/statement', requireAuth, requireRoles('instructor'),
  zodValidate(settlementIdParam, 'params'),
  asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await earningsService.statement(uid(req), Number(req.params.settlementId)));
  }));

router.post('/admin/settlements', requireAuth, requireRoles('finance_admin'),
  zodValidate(createSettlementSchema),
  asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.created(res, await earningsService.createSettlement(uid(req), req.body as never));
  }));

router.patch('/admin/settlements/:settlementId', requireAuth, requireRoles('finance_admin'),
  zodValidate(settlementIdParam, 'params'), zodValidate(settlementStatusSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const b = req.body as z.infer<typeof settlementStatusSchema>;
    ApiResponse.ok(res, await earningsService.updateSettlementStatus(uid(req), Number(req.params.settlementId), b.status, b.utrNumber));
  }));

export default router;
