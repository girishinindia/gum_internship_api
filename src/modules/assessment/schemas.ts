import { z } from 'zod';

export const trackParam = z.object({ track: z.string().trim().min(2).max(40) });

export const submitSchema = z.object({
  track: z.string().trim().min(2).max(40),
  answers: z.array(z.object({
    questionId: z.coerce.number().int().positive(),
    selectedIndex: z.coerce.number().int().min(0).max(10),
  })).min(1).max(50),
});

export type SubmitInput = z.infer<typeof submitSchema>;
