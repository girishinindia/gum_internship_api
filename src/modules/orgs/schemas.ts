import { z } from 'zod';

export const registerOrgSchema = z.object({
  name: z.string().trim().min(2).max(200),
  gstin: z.string().trim().max(20).optional(),
  billingEmail: z.string().email().optional(),
  billingState: z.string().trim().max(60).optional(),
  about: z.string().trim().max(2000).optional(),
});

export const addMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'member']).default('member'),
});

export const purchaseSeatsSchema = z.object({
  seats: z.coerce.number().int().min(1).max(1000),
  unitPrice: z.coerce.number().min(0),
});

export const assignSeatSchema = z.object({
  memberUserId: z.coerce.number().int().positive(),
  internshipId: z.coerce.number().int().positive(),
});
