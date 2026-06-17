import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { ApiResponse } from '../../core/apiResponse';
import { AppError } from '../../core/appError';
import { asyncHandler } from '../../core/asyncHandler';
import { requireAuth, requireRoles } from '../../middlewares/auth';
import { zodValidate } from '../../middlewares/zodValidate';
import { paymentsService as svc } from './service';
import {
  adminRefundListSchema,
  couponValidateSchema,
  orderConfirmSchema,
  orderCreateSchema,
  orderIdParam,
  refundDecisionSchema,
  refundIdParam,
  refundRequestSchema,
} from './schemas';
import type {
  AdminRefundListInput,
  CouponValidateInput,
  OrderConfirmInput,
  OrderCreateInput,
  RefundDecisionInput,
} from './schemas';

const router = Router();
const pageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

function uid(req: Request): number {
  if (!req.user) throw AppError.unauthorized();
  return req.user.id;
}

router.post(
  '/orders',
  requireAuth,
  requireRoles('student'),
  zodValidate(orderCreateSchema),
  asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.created(res, await svc.createOrder(uid(req), req.body as OrderCreateInput));
  }),
);

router.get(
  '/orders/me',
  requireAuth,
  zodValidate(pageSchema, 'query'),
  asyncHandler(async (req: Request, res: Response) => {
    const q = req.query as unknown as { page: number; limit: number };
    const { items, pagination } = await svc.myOrders(uid(req), q.page, q.limit);
    ApiResponse.paginated(res, items, pagination);
  }),
);

router.get(
  '/orders/:orderId',
  requireAuth,
  zodValidate(orderIdParam, 'params'),
  asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await svc.getOrder(uid(req), Number(req.params.orderId)));
  }),
);

router.get(
  '/orders/:orderId/invoice',
  requireAuth,
  zodValidate(orderIdParam, 'params'),
  asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await svc.invoiceLink(uid(req), Number(req.params.orderId)));
  }),
);

router.post(
  '/orders/:orderId/retry',
  requireAuth,
  zodValidate(orderIdParam, 'params'),
  asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await svc.retryOrder(uid(req), Number(req.params.orderId)));
  }),
);

/** Razorpay Checkout success handler → confirm the payment synchronously. */
router.post(
  '/orders/:orderId/confirm',
  requireAuth,
  requireRoles('student'),
  zodValidate(orderIdParam, 'params'),
  zodValidate(orderConfirmSchema),
  asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(
      res,
      await svc.confirmCheckout(uid(req), Number(req.params.orderId), req.body as OrderConfirmInput),
    );
  }),
);

router.post(
  '/orders/:orderId/refund-request',
  requireAuth,
  zodValidate(orderIdParam, 'params'),
  zodValidate(refundRequestSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { reason } = req.body as { reason: string };
    ApiResponse.created(res, await svc.requestRefund(uid(req), Number(req.params.orderId), reason));
  }),
);

router.post(
  '/coupons/validate',
  requireAuth,
  zodValidate(couponValidateSchema),
  asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await svc.validateCoupon(uid(req), req.body as CouponValidateInput));
  }),
);

/** Public webhook — HMAC-verified against req.rawBody, idempotent. */
router.post(
  '/payments/razorpay/webhook',
  asyncHandler(async (req: Request, res: Response) => {
    const result = await svc.handleWebhook(
      req.rawBody,
      req.headers['x-razorpay-signature'] as string | undefined,
    );
    ApiResponse.ok(res, result);
  }),
);

/** The caller's assigned scholarship coupons (R1-S5) for the web wallet view. */
router.get(
  '/me/scholarships',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { scholarshipsForUser } = await import('./repository');
    ApiResponse.ok(res, await scholarshipsForUser(uid(req)));
  }),
);

router.get(
  '/admin/orders',
  requireAuth,
  requireRoles('finance_admin'),
  zodValidate(
    z.object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
      status: z.enum(['created', 'pending', 'paid', 'failed', 'refunded', 'cancelled']).optional(),
      q: z.string().max(120).optional(),
    }),
    'query',
  ),
  asyncHandler(async (req: Request, res: Response) => {
    const q = req.query as unknown as { page: number; limit: number; status?: string; q?: string };
    const { items, pagination } = await svc.adminOrders(q.status, q.q, q.page, q.limit);
    ApiResponse.paginated(res, items, pagination);
  }),
);

router.get(
  '/admin/refunds',
  requireAuth,
  requireRoles('finance_admin'),
  zodValidate(adminRefundListSchema, 'query'),
  asyncHandler(async (req: Request, res: Response) => {
    const q = req.query as unknown as AdminRefundListInput;
    const { items, pagination } = await svc.adminRefunds(q.status, q.page, q.limit);
    ApiResponse.paginated(res, items, pagination);
  }),
);

router.post(
  '/admin/refunds/:refundId/decision',
  requireAuth,
  requireRoles('finance_admin'),
  zodValidate(refundIdParam, 'params'),
  zodValidate(refundDecisionSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const input = req.body as RefundDecisionInput;
    ApiResponse.ok(
      res,
      await svc.decideRefund(uid(req), Number(req.params.refundId), input.decision, input.reason),
    );
  }),
);

export default router;
