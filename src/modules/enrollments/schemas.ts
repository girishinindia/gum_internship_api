import { z } from 'zod';

export const enrollSchema = z.object({
  internshipId: z.coerce.number().int().positive(),
  batchId: z.coerce.number().int().positive().optional(),
});
export type EnrollInput = z.infer<typeof enrollSchema>;

export const myEnrollmentsSchema = z.object({
  status: z
    .enum(['pending_payment', 'waitlisted', 'active', 'completed', 'dropped', 'suspended'])
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type MyEnrollmentsInput = z.infer<typeof myEnrollmentsSchema>;

export const enrollmentIdParam = z.object({ enrollmentId: z.coerce.number().int().positive() });

export const transferSchema = z.object({
  toBatchId: z.coerce.number().int().positive(),
  reason: z.string().min(3).max(500),
});
export type TransferInput = z.infer<typeof transferSchema>;
