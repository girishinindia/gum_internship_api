import type { Request, Response } from 'express';
import { ApiResponse } from '../../core/apiResponse';
import { AppError } from '../../core/appError';
import { mentorshipService } from './service';
import type { CreateSlotInput } from './schemas';

function uid(req: Request): number {
  if (!req.user) throw AppError.unauthorized();
  return req.user.id;
}

export const mentorshipController = {
  // mentor
  async createSlot(req: Request, res: Response): Promise<void> {
    ApiResponse.created(res, await mentorshipService.createSlot(uid(req), req.body as CreateSlotInput));
  },
  async mySlots(req: Request, res: Response): Promise<void> {
    ApiResponse.ok(res, await mentorshipService.mySlots(uid(req)));
  },
  async cancelSlot(req: Request, res: Response): Promise<void> {
    await mentorshipService.cancelSlot(uid(req), Number(req.params.slotId));
    ApiResponse.ok(res, { message: 'Slot cancelled' });
  },
  // student
  async listOpen(req: Request, res: Response): Promise<void> {
    const mentorUserId = req.query.mentorUserId ? Number(req.query.mentorUserId) : null;
    ApiResponse.ok(res, await mentorshipService.listOpen(mentorUserId));
  },
  async book(req: Request, res: Response): Promise<void> {
    const { slotId, note } = req.body as { slotId: number; note?: string };
    ApiResponse.created(res, await mentorshipService.book(uid(req), slotId, note ?? null));
  },
  async confirm(req: Request, res: Response): Promise<void> {
    const { razorpayPaymentId, signature } = req.body as { razorpayPaymentId: string; signature: string };
    ApiResponse.ok(res, await mentorshipService.confirmPayment(uid(req), Number(req.params.bookingId), razorpayPaymentId, signature));
  },
  async cancelBooking(req: Request, res: Response): Promise<void> {
    await mentorshipService.cancelBooking(uid(req), Number(req.params.bookingId));
    ApiResponse.ok(res, { message: 'Booking cancelled' });
  },
  async myBookings(req: Request, res: Response): Promise<void> {
    ApiResponse.ok(res, await mentorshipService.myBookings(uid(req)));
  },
};
