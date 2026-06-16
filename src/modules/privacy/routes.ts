import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { ApiResponse } from '../../core/apiResponse';
import { AppError } from '../../core/appError';
import { asyncHandler } from '../../core/asyncHandler';
import { requireAuth } from '../../middlewares/auth';
import { zodValidate } from '../../middlewares/zodValidate';
import { privacyService } from './service';

const router = Router();
function uid(req: Request): number {
  if (!req.user) throw AppError.unauthorized();
  return req.user.id;
}

/** DPDP: download a machine-readable copy of all my personal data. */
router.get(
  '/me/export',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    res.setHeader('Content-Disposition', 'attachment; filename="gum-data-export.json"');
    ApiResponse.ok(res, await privacyService.exportData(uid(req)));
  }),
);

/** DPDP: erase my account (anonymise PII; retain de-identified financial/audit records). */
router.post(
  '/me/account/deletion',
  requireAuth,
  zodValidate(z.object({ password: z.string().min(1), confirm: z.literal('DELETE') })),
  asyncHandler(async (req: Request, res: Response) => {
    const b = req.body as { password: string };
    await privacyService.deleteAccount(uid(req), b.password);
    ApiResponse.ok(res, { message: 'Your account has been deleted and your personal data anonymised.' });
  }),
);

export default router;
