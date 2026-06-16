import { z } from 'zod';

export const createThreadSchema = z.object({
  internshipId: z.coerce.number().int().positive(),
  title: z.string().trim().min(3).max(200),
  body: z.string().trim().min(1).max(8000),
});

export const replySchema = z.object({
  body: z.string().trim().min(1).max(8000),
});

export const listThreadsQuery = z.object({
  internshipId: z.coerce.number().int().positive(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const moderateThreadSchema = z.object({
  isPinned: z.boolean().optional(),
  isLocked: z.boolean().optional(),
  isDeleted: z.boolean().optional(),
});

export type CreateThreadInput = z.infer<typeof createThreadSchema>;
export type ListThreadsQuery = z.infer<typeof listThreadsQuery>;
