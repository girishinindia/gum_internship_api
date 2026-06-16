import { z } from 'zod';

export const updateMeSchema = z
  .object({
    fullName: z.string().min(2).max(120).optional(),
    avatarUrl: z.string().url().optional(),
    track: z.enum(['education', 'employed']).optional(),
    resumeUrl: z.string().url().optional(),
    marketingConsent: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to update' });
export type UpdateMeInput = z.infer<typeof updateMeSchema>;

export const adminUserListSchema = z.object({
  q: z.string().min(1).optional(),
  role: z
    .enum(['student', 'instructor', 'moderator', 'finance_admin', 'support', 'super_admin'])
    .optional(),
  status: z.enum(['active', 'suspended', 'deleted', 'pending_verification']).optional(),
  track: z.enum(['education', 'employed']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type AdminUserListInput = z.infer<typeof adminUserListSchema>;

export const instructorApplicationSchema = z.object({
  bio: z.string().min(30, 'Tell us at least 30 characters about yourself'),
  expertise: z.array(z.string().min(2)).min(1).max(10),
  linkedinUrl: z.string().url().optional(),
  websiteUrl: z.string().url().optional(),
  panNumber: z
    .string()
    .regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'PAN must look like ABCDE1234F'),
  gstin: z
    .string()
    .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{3}$/, 'Invalid GSTIN format')
    .optional(),
  bankAccountName: z.string().min(2),
  bankAccountNumber: z.string().regex(/^[0-9]{9,18}$/, 'Account number must be 9–18 digits'),
  bankIfsc: z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Invalid IFSC'),
  kycDocuments: z
    .array(z.object({ type: z.string().min(2), bunnyPath: z.string().min(3) }))
    .max(10)
    .optional()
    .default([]),
});
export type InstructorApplicationInput = z.infer<typeof instructorApplicationSchema>;
