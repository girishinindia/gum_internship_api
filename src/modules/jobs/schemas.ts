import { z } from 'zod';

export const registerEmployerSchema = z.object({
  companyName: z.string().trim().min(2).max(200),
  website: z.string().url().max(300).optional(),
  about: z.string().trim().max(4000).optional(),
  contactEmail: z.string().email().optional(),
  contactPhone: z.string().trim().max(20).optional(),
  gstin: z.string().trim().max(20).optional(),
});

export const updateEmployerSchema = z.object({
  companyName: z.string().trim().min(2).max(200).optional(),
  website: z.string().url().max(300).optional(),
  about: z.string().trim().max(4000).optional(),
  contactEmail: z.string().email().optional(),
  contactPhone: z.string().trim().max(20).optional(),
  gstin: z.string().trim().max(20).optional(),
  logoUrl: z.string().url().max(500).optional(),
});

const workMode = z.enum(['remote', 'onsite', 'hybrid']);
const employmentType = z.enum(['internship', 'full_time', 'part_time', 'contract']);

export const createJobSchema = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().min(10).max(12000),
  location: z.string().trim().max(200).optional(),
  workMode: workMode.default('remote'),
  employmentType: employmentType.default('internship'),
  stipendMin: z.coerce.number().min(0).optional(),
  stipendMax: z.coerce.number().min(0).optional(),
  skills: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
});

export const updateJobSchema = createJobSchema.partial();

export const boardQuery = z.object({
  q: z.string().trim().max(100).optional(),
  workMode: workMode.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const applySchema = z.object({
  coverNote: z.string().trim().max(4000).optional(),
});

export const applicantStatusSchema = z.object({
  status: z.enum(['applied', 'shortlisted', 'interview', 'offered', 'rejected']),
});

export const verifyEmployerSchema = z.object({
  decision: z.enum(['verified', 'rejected']),
  reason: z.string().trim().min(3).max(500).optional(),
});

export const jobDecisionSchema = z.object({
  decision: z.enum(['published', 'rejected']),
  reason: z.string().trim().min(3).max(500).optional(),
});
