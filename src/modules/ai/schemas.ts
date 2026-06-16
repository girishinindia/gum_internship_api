import { z } from 'zod';

export const askSchema = z.object({
  internshipId: z.coerce.number().int().positive(),
  question: z.string().trim().min(3).max(4000),
  threadId: z.coerce.number().int().positive().optional(),
});

export const startInterviewSchema = z.object({
  track: z.string().trim().min(2).max(80),
  internshipId: z.coerce.number().int().positive().optional(),
});

export const answerInterviewSchema = z.object({
  answer: z.string().trim().min(1).max(4000),
});

export const translateSchema = z.object({
  lessonId: z.coerce.number().int().positive(),
  language: z.string().trim().min(2).max(8),
});

export const reindexSchema = z.object({
  internshipId: z.coerce.number().int().positive(),
});

export type AskInput = z.infer<typeof askSchema>;
export type StartInterviewInput = z.infer<typeof startInterviewSchema>;
