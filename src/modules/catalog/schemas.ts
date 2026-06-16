import { z } from 'zod';

export const catalogListSchema = z.object({
  category: z.string().min(1).optional(),                       // category slug
  pricingType: z.enum(['free', 'paid', 'stipend']).optional(),
  deliveryMode: z.enum(['recorded', 'live', 'hybrid', 'project_only']).optional(),
  language: z.string().min(2).optional(),
  level: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
  durationWeeks: z.coerce.number().int().min(1).max(52).optional(),
  q: z.string().min(2).max(80).optional(),
  sort: z.enum(['popular', 'newest', 'price_asc', 'price_desc']).default('newest'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type CatalogListInput = z.infer<typeof catalogListSchema>;

export const slugParamSchema = z.object({ slug: z.string().min(1) });
export const idParamSchema = z.object({ id: z.coerce.number().int().positive() });
