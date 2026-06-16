import { z } from 'zod';

export const createSlotSchema = z.object({
  startsAt: z.string().datetime({ offset: true }),
  durationMinutes: z.coerce.number().int().min(15).max(180).default(30),
  price: z.coerce.number().min(0).default(0),
  topic: z.string().trim().max(200).optional(),
});

export const bookSchema = z.object({
  slotId: z.coerce.number().int().positive(),
  note: z.string().trim().max(1000).optional(),
});

export const confirmSchema = z.object({
  razorpayPaymentId: z.string().min(3),
  signature: z.string().min(3),
});

export const openSlotsQuery = z.object({
  mentorUserId: z.coerce.number().int().positive().optional(),
});

export type CreateSlotInput = z.infer<typeof createSlotSchema>;
