import { env } from '../../config/env';
import { AppError } from '../../core/appError';
import { ErrorCodes } from '../../core/errorCodes';
import { liveProviders } from '../../services/liveProviders';
import { razorpayService } from '../../services/razorpay';
import { mentorshipRepository as repo } from './repository';

async function createMeetingFor(slot: { id: number; starts_at: Date; duration_minutes: number; topic: string | null }): Promise<{ provider: string; meetingId: string; joinUrl: string; passcode: string | null }> {
  const m = await liveProviders.zoom.createMeeting({
    title: `Mentorship session${slot.topic ? `: ${slot.topic}` : ''}`,
    startsAt: new Date(slot.starts_at),
    durationMinutes: slot.duration_minutes,
  });
  return { provider: 'zoom', meetingId: m.meetingId, joinUrl: m.joinUrl, passcode: m.passcode };
}

export const mentorshipService = {
  // ---- Mentor side ---------------------------------------------------------
  async createSlot(mentorUserId: number, input: { startsAt: string; durationMinutes: number; price: number; topic?: string }): Promise<Record<string, unknown>> {
    if (new Date(input.startsAt).getTime() <= Date.now()) throw AppError.validation('Slot must be in the future.');
    return repo.createSlot(mentorUserId, input);
  },

  async mySlots(mentorUserId: number): Promise<unknown[]> {
    return repo.mySlots(mentorUserId);
  },

  async cancelSlot(mentorUserId: number, slotId: number): Promise<void> {
    const ok = await repo.cancelSlot(mentorUserId, slotId);
    if (!ok) throw AppError.conflict('Slot not found, not yours, or already booked/cancelled.');
  },

  // ---- Student side --------------------------------------------------------
  async listOpen(mentorUserId: number | null): Promise<unknown[]> {
    return repo.openSlots(mentorUserId);
  },

  async book(studentUserId: number, slotId: number, note: string | null): Promise<Record<string, unknown>> {
    const slot = await repo.slotById(slotId);
    if (!slot || slot.status !== 'open') throw AppError.conflict('This slot is no longer available.');
    if (new Date(slot.starts_at).getTime() <= Date.now()) throw AppError.conflict('This slot is in the past.');
    if (slot.mentor_user_id === studentUserId) throw AppError.validation('You cannot book your own slot.');

    const price = Number(slot.price);
    const paid = price > 0;
    const booking = await repo.claimSlotAndBook(
      slotId, studentUserId, slot.mentor_user_id, price, slot.currency,
      paid ? 'pending_payment' : 'confirmed', note,
    );
    if (!booking) throw AppError.conflict('This slot was just booked by someone else.');

    if (!paid) {
      const meeting = await createMeetingFor(slot);
      await repo.confirmBooking(booking.id, null, meeting);
      return { bookingId: booking.id, status: 'confirmed', joinUrl: meeting.joinUrl, passcode: meeting.passcode };
    }

    // Paid: create a Razorpay order; client pays, then calls /confirm.
    const { razorpayOrderId } = await razorpayService.createOrder(Math.round(price * 100), `mentor_booking_${booking.id}`);
    await repo.setBookingOrder(booking.id, razorpayOrderId);
    return {
      bookingId: booking.id,
      status: 'pending_payment',
      payment: { razorpayOrderId, amount: price, currency: slot.currency, keyId: env.RAZORPAY_KEY_ID },
    };
  },

  /** Confirm a paid booking after Razorpay Checkout returns a signed payment. */
  async confirmPayment(studentUserId: number, bookingId: number, razorpayPaymentId: string, signature: string): Promise<Record<string, unknown>> {
    const b = await repo.bookingById(bookingId);
    if (!b || Number(b.student_user_id) !== studentUserId) throw AppError.notFound('Booking');
    if (b.status !== 'pending_payment') throw AppError.conflict(`Booking is ${String(b.status)}, not awaiting payment.`);
    if (!razorpayService.verifyCheckoutSignature(String(b.razorpay_order_id), razorpayPaymentId, signature)) {
      throw new AppError(ErrorCodes.WEBHOOK_SIGNATURE_INVALID, 'Payment signature verification failed.');
    }
    const slot = await repo.slotById(Number(b.slot_id));
    if (!slot) throw AppError.notFound('Slot');
    const meeting = await createMeetingFor(slot);
    await repo.confirmBooking(bookingId, razorpayPaymentId, meeting);
    return { bookingId, status: 'confirmed', joinUrl: meeting.joinUrl, passcode: meeting.passcode };
  },

  async cancelBooking(studentUserId: number, bookingId: number): Promise<void> {
    const b = await repo.bookingById(bookingId);
    if (!b || Number(b.student_user_id) !== studentUserId) throw AppError.notFound('Booking');
    if (b.status === 'cancelled') return;
    await repo.releaseSlotForBooking(bookingId); // frees the slot for rebooking
  },

  async myBookings(studentUserId: number): Promise<unknown[]> {
    return repo.myBookings(studentUserId);
  },
};
