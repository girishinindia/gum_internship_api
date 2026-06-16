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

export const brandingSchema = z.object({
  brandName: z.string().max(120).optional(),
  logoUrl: z.string().url().max(500).or(z.literal('')).optional(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #0284c7').or(z.literal('')).optional(),
  supportEmail: z.string().email().or(z.literal('')).optional(),
  customDomain: z.string().max(255).regex(/^[a-z0-9.-]+$/i, 'Invalid domain').or(z.literal('')).optional(),
}).refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field' });
