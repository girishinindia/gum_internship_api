import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../core/asyncHandler';
import { requireAuth, requireRoles } from '../../middlewares/auth';
import { zodValidate } from '../../middlewares/zodValidate';
import { mentorshipController as c } from './controller';
import { bookSchema, confirmSchema, createSlotSchema, openSlotsQuery } from './schemas';

const router = Router();
const slotIdParam = z.object({ slotId: z.coerce.number().int().positive() });
const bookingIdParam = z.object({ bookingId: z.coerce.number().int().positive() });

// ---- Mentor (instructor) ---------------------------------------------------
router.post('/mentorship/slots', requireAuth, requireRoles('instructor', 'moderator', 'super_admin'),
  zodValidate(createSlotSchema), asyncHandler(c.createSlot));
router.get('/mentorship/slots/mine', requireAuth, requireRoles('instructor', 'moderator', 'super_admin'),
  asyncHandler(c.mySlots));
router.delete('/mentorship/slots/:slotId', requireAuth, requireRoles('instructor', 'moderator', 'super_admin'),
  zodValidate(slotIdParam, 'params'), asyncHandler(c.cancelSlot));

// ---- Student ---------------------------------------------------------------
router.get('/mentorship/slots', requireAuth, zodValidate(openSlotsQuery, 'query'), asyncHandler(c.listOpen));
router.post('/mentorship/bookings', requireAuth, zodValidate(bookSchema), asyncHandler(c.book));
router.post('/mentorship/bookings/:bookingId/confirm', requireAuth,
  zodValidate(bookingIdParam, 'params'), zodValidate(confirmSchema), asyncHandler(c.confirm));
router.delete('/mentorship/bookings/:bookingId', requireAuth,
  zodValidate(bookingIdParam, 'params'), asyncHandler(c.cancelBooking));
router.get('/mentorship/bookings/mine', requireAuth, asyncHandler(c.myBookings));

export default router;
