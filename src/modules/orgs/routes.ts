import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../core/asyncHandler';
import { requireAuth } from '../../middlewares/auth';
import { zodValidate } from '../../middlewares/zodValidate';
import { orgsController as c } from './controller';
import { addMemberSchema, assignSeatSchema, brandingSchema, purchaseSeatsSchema, registerOrgSchema } from './schemas';

const router = Router();
const orgIdParam = z.object({ orgId: z.coerce.number().int().positive() });

// Public: resolve a custom domain → brand (for white-label theming).
router.get('/branding', asyncHandler(c.brandingByDomain));

router.post('/orgs/register', requireAuth, zodValidate(registerOrgSchema), asyncHandler(c.register));
router.get('/orgs/mine', requireAuth, asyncHandler(c.myOrgs));
router.get('/orgs/:orgId/team', requireAuth, zodValidate(orgIdParam, 'params'), asyncHandler(c.team));
router.post('/orgs/:orgId/members', requireAuth, zodValidate(orgIdParam, 'params'), zodValidate(addMemberSchema), asyncHandler(c.addMember));
router.post('/orgs/:orgId/seats/purchase', requireAuth, zodValidate(orgIdParam, 'params'), zodValidate(purchaseSeatsSchema), asyncHandler(c.purchaseSeats));
router.post('/orgs/:orgId/seats/assign', requireAuth, zodValidate(orgIdParam, 'params'), zodValidate(assignSeatSchema), asyncHandler(c.assignSeat));
router.get('/orgs/:orgId/branding', requireAuth, zodValidate(orgIdParam, 'params'), asyncHandler(c.getBranding));
router.patch('/orgs/:orgId/branding', requireAuth, zodValidate(orgIdParam, 'params'), zodValidate(brandingSchema), asyncHandler(c.updateBranding));

export default router;
