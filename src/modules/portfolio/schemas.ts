import { z } from 'zod';

/** Reserved handles that must never resolve to a user portfolio. */
const RESERVED_HANDLES = new Set([
  'admin', 'api', 'app', 'www', 'verify', 'login', 'signup', 'me', 'u', 'p',
  'about', 'help', 'support', 'terms', 'privacy', 'gum', 'gi', 'internship',
  'internships', 'certificate', 'certificates', 'static', 'assets', 'null',
]);

export const handleSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(4)
  .max(40)
  .regex(/^[a-z0-9][a-z0-9-]{2,38}[a-z0-9]$/, 'Use 4–40 chars: letters, numbers, hyphens')
  .refine((h) => !h.includes('--'), 'No consecutive hyphens')
  .refine((h) => !RESERVED_HANDLES.has(h), 'That handle is reserved');

export const linksSchema = z
  .object({
    github: z.string().url().max(200).optional(),
    linkedin: z.string().url().max(200).optional(),
    website: z.string().url().max(200).optional(),
    twitter: z.string().url().max(200).optional(),
  })
  .strict();

/** Upsert the caller's own portfolio (PUT /users/me/portfolio). */
export const upsertPortfolioSchema = z.object({
  handle: handleSchema,
  headline: z.string().trim().max(160).optional(),
  bio: z.string().trim().max(2000).optional(),
  location: z.string().trim().max(120).optional(),
  visibility: z.enum(['private', 'unlisted', 'public']).default('private'),
  showCertificates: z.boolean().default(true),
  showProjects: z.boolean().default(true),
  showContact: z.boolean().default(false),
  links: linksSchema.optional(),
});

export const handleParamSchema = z.object({ handle: handleSchema });

export type UpsertPortfolioInput = z.infer<typeof upsertPortfolioSchema>;
