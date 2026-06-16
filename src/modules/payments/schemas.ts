import { z } from 'zod';

export const orderCreateSchema = z.object({
  internshipId: z.coerce.number().int().positive(),
  batchId: z.coerce.number().int().positive().optional(),
  couponCode: z.string().min(2).max(40).toUpperCase().optional(),
  billingName: z.string().min(2).max(120),
  billingEmail: z.string().email().toLowerCase(),
  billingPhone: z.string().regex(/^\+?[0-9]{10,15}$/),
  billingState: z.string().min(2).max(60),
  billingGstin: z
    .string()
    .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{3}$/)
    .optional(),
});
export type OrderCreateInput = z.infer<typeof orderCreateSchema>;

export const orderIdParam = z.object({ orderId: z.coerce.number().int().positive() });
export const refundIdParam = z.object({ refundId: z.coerce.number().int().positive() });

export const couponValidateSchema = z.object({
  code: z.string().min(2).max(40).toUpperCase(),
  internshipId: z.coerce.number().int().positive(),
});
export type CouponValidateInput = z.infer<typeof couponValidateSchema>;

export const refundRequestSchema = z.object({ reason: z.string().min(10).max(1000) });

export const refundDecisionSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  reason: z.string().min(3).max(500).optional(),
});
export type RefundDecisionInput = z.infer<typeof refundDecisionSchema>;

export const adminRefundListSchema = z.object({
  status: z.enum(['requested', 'approved', 'rejected', 'processed']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type AdminRefundListInput = z.infer<typeof adminRefundListSchema>;
