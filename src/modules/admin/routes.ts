import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { ApiResponse, buildPagination } from '../../core/apiResponse';
import { AppError } from '../../core/appError';
import { asyncHandler } from '../../core/asyncHandler';
import { requireAuth, requireRoles } from '../../middlewares/auth';
import { zodValidate } from '../../middlewares/zodValidate';
import { adminService } from './service';

const router = Router();
const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

function uid(req: Request): number {
  if (!req.user) throw AppError.unauthorized();
  return req.user.id;
}

// ---- Moderation -------------------------------------------------------
router.get('/admin/instructors',
  requireAuth, requireRoles('moderator'),
  zodValidate(pageQuery.extend({ kycStatus: z.enum(['pending', 'submitted', 'approved', 'rejected']).optional() }), 'query'),
  asyncHandler(async (req: Request, res: Response) => {
    const q = req.query as Record<string, never>;
    const { query: dbq } = await import('../../db/pool');
    const rows = await dbq<Record<string, never>>(
      `select ip.id, u.full_name as "name", u.email, ip.instructor_type as "instructorType",
              ip.kyc_status as "kycStatus", ip.expertise, ip.bio, ip.gstin,
              ip.bank_account_last4 as "bankLast4", ip.bank_ifsc as "bankIfsc",
              ip.kyc_documents as "kycDocuments", ip.revenue_share_percent as "revenueSharePercent",
              ip.created_at as "appliedAt", count(*) over()::int8 as total_count
       from instructor_profiles ip join users u on u.id = ip.user_id
       where ($1::kyc_status is null or ip.kyc_status = $1)
       order by ip.created_at asc
       limit ${Number(q.limit)} offset ${(Number(q.page) - 1) * Number(q.limit)}`,
      [q.kycStatus ?? null],
    );
    const total = Number((rows[0] as { total_count?: number } | undefined)?.total_count ?? 0);
    ApiResponse.paginated(res, rows, buildPagination(Number(q.page), Number(q.limit), total));
  }));

router.post('/admin/instructors/:profileId/kyc-decision',
  requireAuth, requireRoles('moderator'),
  zodValidate(z.object({ profileId: z.coerce.number().int().positive() }), 'params'),
  zodValidate(z.object({
    decision: z.enum(['approved', 'rejected']),
    reason: z.string().min(3).optional(),
    revenueSharePercent: z.coerce.number().min(0).max(100).optional(),
  })),
  asyncHandler(async (req: Request, res: Response) => {
    const b = req.body as { decision: 'approved' | 'rejected'; reason?: string; revenueSharePercent?: number };
    ApiResponse.ok(res, await adminService.kycDecision(uid(req), Number(req.params.profileId), b.decision, b.reason, b.revenueSharePercent));
  }));

router.post('/admin/internships/:internshipId/decision',
  requireAuth, requireRoles('moderator'),
  zodValidate(z.object({ internshipId: z.coerce.number().int().positive() }), 'params'),
  zodValidate(z.object({ decision: z.enum(['published', 'rejected']), reason: z.string().min(3).optional() })),
  asyncHandler(async (req: Request, res: Response) => {
    const b = req.body as { decision: 'published' | 'rejected'; reason?: string };
    ApiResponse.ok(res, await adminService.internshipDecision(uid(req), Number(req.params.internshipId), b.decision, b.reason));
  }));

// ---- Users ------------------------------------------------------------
router.patch('/admin/users/:userId/status',
  requireAuth, requireRoles('moderator'),
  zodValidate(z.object({ userId: z.coerce.number().int().positive() }), 'params'),
  zodValidate(z.object({ status: z.enum(['active', 'suspended']), reason: z.string().optional() })),
  asyncHandler(async (req: Request, res: Response) => {
    const b = req.body as { status: 'active' | 'suspended'; reason?: string };
    await adminService.setUserStatus(uid(req), Number(req.params.userId), b.status, b.reason);
    ApiResponse.ok(res, { message: `User ${b.status}` });
  }));

const roleSchema = z.object({ role: z.enum(['student', 'instructor', 'moderator', 'finance_admin', 'support', 'super_admin']) });
router.post('/admin/users/:userId/roles',
  requireAuth, requireRoles('super_admin'),
  zodValidate(z.object({ userId: z.coerce.number().int().positive() }), 'params'),
  zodValidate(roleSchema),
  asyncHandler(async (req: Request, res: Response) => {
    await adminService.setRole(uid(req), Number(req.params.userId), (req.body as { role: string }).role, true);
    ApiResponse.ok(res, { message: 'Role granted' });
  }));
router.delete('/admin/users/:userId/roles/:role',
  requireAuth, requireRoles('super_admin'),
  asyncHandler(async (req: Request, res: Response) => {
    const role = roleSchema.shape.role.parse(req.params.role);
    await adminService.setRole(uid(req), Number(req.params.userId), role, false);
    ApiResponse.ok(res, { message: 'Role revoked' });
  }));

// ---- Enrollment ops ------------------------------------------------------
router.post('/admin/enrollments/manual',
  requireAuth, requireRoles('moderator', 'support'),
  zodValidate(z.object({
    userId: z.coerce.number().int().positive(),
    internshipId: z.coerce.number().int().positive(),
    batchId: z.coerce.number().int().positive().optional(),
  })),
  asyncHandler(async (req: Request, res: Response) => {
    const b = req.body as { userId: number; internshipId: number; batchId?: number };
    ApiResponse.created(res, await adminService.manualEnroll(uid(req), b.userId, b.internshipId, b.batchId ?? null));
  }));

// ---- Scholarships (R1-S5) ---------------------------------------------
router.post('/admin/scholarships',
  requireAuth, requireRoles('moderator', 'finance_admin'),
  zodValidate(z.object({
    userId: z.coerce.number().int().positive(),
    discountType: z.enum(['percent', 'flat']),
    discountValue: z.coerce.number().positive(),
    internshipId: z.coerce.number().int().positive().optional(),
    maxDiscountAmount: z.coerce.number().positive().optional(),
    validUntil: z.string().datetime({ offset: true }).optional(),
    eligibilityNote: z.string().max(500).optional(),
  })),
  asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.created(res, await adminService.issueScholarship(uid(req), req.body as never));
  }));

// ---- Dashboard + exports + audit --------------------------------------
router.get('/admin/dashboard', requireAuth, requireRoles('moderator', 'finance_admin', 'support'),
  asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, await adminService.dashboard());
  }));

router.get('/admin/analytics', requireAuth, requireRoles('moderator', 'finance_admin', 'support'),
  zodValidate(z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }), 'query'),
  asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await adminService.analytics(Number((req.query as unknown as { days: number }).days)));
  }));

// ---- Coupons -------------------------------------------------------------
const couponCreateSchema = z.object({
  code: z.string().regex(/^[A-Za-z0-9_-]+$/, 'Letters, numbers, - and _ only').min(3).max(40),
  description: z.string().max(300).optional(),
  discountType: z.enum(['percent', 'flat']),
  discountValue: z.coerce.number().positive(),
  maxDiscountAmount: z.coerce.number().positive().optional(),
  internshipId: z.coerce.number().int().positive().optional(),
  validFrom: z.string().datetime({ offset: true }).optional(),
  validUntil: z.string().datetime({ offset: true }).optional(),
  maxRedemptions: z.coerce.number().int().positive().optional(),
  perUserLimit: z.coerce.number().int().positive().default(1),
  minOrderAmount: z.coerce.number().min(0).default(0),
  isActive: z.boolean().default(true),
}).refine((v) => v.discountType !== 'percent' || v.discountValue <= 100, { message: 'Percent discount must be ≤ 100' });

router.get('/admin/coupons', requireAuth, requireRoles('finance_admin', 'moderator'),
  asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await adminService.listCoupons(req.query.status as string | undefined));
  }));

router.post('/admin/coupons', requireAuth, requireRoles('finance_admin', 'moderator'), zodValidate(couponCreateSchema),
  asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.created(res, await adminService.createCoupon(uid(req), req.body as Record<string, unknown>));
  }));

router.patch('/admin/coupons/:id', requireAuth, requireRoles('finance_admin', 'moderator'),
  zodValidate(z.object({ id: z.coerce.number().int().positive() }), 'params'),
  zodValidate(z.object({
    description: z.string().max(300).optional(),
    validUntil: z.string().datetime({ offset: true }).nullable().optional(),
    maxRedemptions: z.coerce.number().int().positive().nullable().optional(),
    minOrderAmount: z.coerce.number().min(0).optional(),
    isActive: z.boolean().optional(),
  })),
  asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await adminService.updateCoupon(uid(req), Number(req.params.id), req.body as Record<string, unknown>));
  }));

router.get('/admin/exports/:entity', requireAuth, requireRoles('finance_admin', 'moderator'),
  asyncHandler(async (req: Request, res: Response) => {
    await adminService.streamCsv(res, req.params.entity as 'users' | 'orders' | 'enrollments');
  }));

router.get('/admin/audit-logs', requireAuth, requireRoles('moderator'),
  zodValidate(pageQuery.extend({
    actorId: z.coerce.number().int().optional(),
    action: z.string().optional(),
    entityType: z.string().optional(),
  }), 'query'),
  asyncHandler(async (req: Request, res: Response) => {
    const q = req.query as Record<string, never>;
    const { items, total } = await adminService.auditLogs(q, Number(q.page), Number(q.limit));
    ApiResponse.paginated(res, items, buildPagination(Number(q.page), Number(q.limit), total));
  }));

// ---- CMS ---------------------------------------------------------------
const bannerSchema = z.object({
  title: z.string().min(2), imageUrl: z.string().url(), linkUrl: z.string().url().optional(),
  placement: z.enum(['home_hero', 'home_strip', 'category_page']),
  displayOrder: z.coerce.number().int().min(0).optional(),
  startsAt: z.string().datetime({ offset: true }).optional(),
  endsAt: z.string().datetime({ offset: true }).optional(),
  isActive: z.boolean().optional(),
});
router.get('/admin/cms/banners', requireAuth, requireRoles('moderator'),
  asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, await adminService.cmsBanners());
  }));

router.get('/admin/cms/pages', requireAuth, requireRoles('moderator'),
  asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, await adminService.cmsPages());
  }));

router.post('/admin/cms/banners', requireAuth, requireRoles('moderator'), zodValidate(bannerSchema),
  asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.created(res, await adminService.upsertBanner(uid(req), null, req.body as never));
  }));
router.patch('/admin/cms/banners/:id', requireAuth, requireRoles('moderator'),
  zodValidate(z.object({ id: z.coerce.number().int().positive() }), 'params'), zodValidate(bannerSchema),
  asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await adminService.upsertBanner(uid(req), Number(req.params.id), req.body as never));
  }));

const pageSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/).optional(),
  title: z.string().min(2), contentMd: z.string().min(1),
  metaTitle: z.string().optional(), metaDescription: z.string().optional(),
  isPublished: z.boolean().optional(),
});
router.post('/admin/cms/pages', requireAuth, requireRoles('moderator'),
  zodValidate(pageSchema.refine((v) => !!v.slug, { message: 'slug required' })),
  asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.created(res, await adminService.upsertPage(uid(req), null, req.body as never));
  }));
router.patch('/admin/cms/pages/:id', requireAuth, requireRoles('moderator'),
  zodValidate(z.object({ id: z.coerce.number().int().positive() }), 'params'), zodValidate(pageSchema),
  asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await adminService.upsertPage(uid(req), Number(req.params.id), req.body as never));
  }));

// ---- Tickets -------------------------------------------------------------
router.post('/tickets', requireAuth,
  zodValidate(z.object({
    category: z.enum(['payment', 'content', 'technical', 'certificate', 'other']),
    subject: z.string().min(5).max(200),
    description: z.string().min(10).max(5000),
    internshipId: z.coerce.number().int().positive().optional(),
    attachments: z.array(z.string()).max(5).optional(),
  })),
  asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.created(res, await adminService.createTicket(uid(req), req.body as never));
  }));

router.get('/tickets/me', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  ApiResponse.ok(res, await adminService.myTickets(uid(req)));
}));

router.get('/tickets/:ticketId', requireAuth,
  zodValidate(z.object({ ticketId: z.coerce.number().int().positive() }), 'params'),
  asyncHandler(async (req: Request, res: Response) => {
    const staff = req.user?.roles.some((r) => ['support', 'moderator', 'finance_admin', 'super_admin'].includes(r));
    ApiResponse.ok(res, await adminService.ticketThread(staff ? null : uid(req), Number(req.params.ticketId)));
  }));

router.post('/tickets/:ticketId/replies', requireAuth,
  zodValidate(z.object({ ticketId: z.coerce.number().int().positive() }), 'params'),
  zodValidate(z.object({ body: z.string().min(2).max(5000) })),
  asyncHandler(async (req: Request, res: Response) => {
    const staff = req.user?.roles.some((r) => ['support', 'moderator', 'finance_admin', 'super_admin'].includes(r)) ?? false;
    await adminService.replyTicket(uid(req), Number(req.params.ticketId), (req.body as { body: string }).body, staff);
    ApiResponse.created(res, { message: 'Reply added' });
  }));

router.get('/admin/tickets', requireAuth, requireRoles('support', 'moderator', 'finance_admin'),
  zodValidate(pageQuery.extend({ status: z.enum(['open', 'in_progress', 'resolved', 'closed']).optional() }), 'query'),
  asyncHandler(async (req: Request, res: Response) => {
    const q = req.query as Record<string, never>;
    const { items, total } = await adminService.adminTickets(q.status, Number(q.page), Number(q.limit));
    ApiResponse.paginated(res, items, buildPagination(Number(q.page), Number(q.limit), total));
  }));

router.patch('/admin/tickets/:ticketId', requireAuth, requireRoles('support', 'moderator', 'finance_admin'),
  zodValidate(z.object({ ticketId: z.coerce.number().int().positive() }), 'params'),
  zodValidate(z.object({
    status: z.enum(['open', 'in_progress', 'resolved', 'closed']).optional(),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
    assignedTo: z.coerce.number().int().positive().optional(),
    resolutionNote: z.string().max(2000).optional(),
  })),
  asyncHandler(async (req: Request, res: Response) => {
    await adminService.updateTicket(uid(req), Number(req.params.ticketId), req.body as never);
    ApiResponse.ok(res, { message: 'Ticket updated' });
  }));

export default router;
