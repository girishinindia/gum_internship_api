import { env } from '../../config/env';
import { AppError } from '../../core/appError';
import { ErrorCodes } from '../../core/errorCodes';
import { computeOrderAmounts, fiscalYearLabel } from '../payments/gst';
import { orgsRepository as repo } from './repository';

async function requireManage(orgId: number, userId: number): Promise<{ id: number; billing_state: string | null; seats_total: number }> {
  const o = await repo.manageable(orgId, userId);
  if (!o) throw new AppError(ErrorCodes.FORBIDDEN, 'You do not manage this organization.');
  return o;
}

export const orgsService = {
  async register(ownerUserId: number, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return repo.create(ownerUserId, input);
  },

  async myOrgs(userId: number): Promise<unknown[]> {
    return repo.myOrgs(userId);
  },

  async addMemberByEmail(orgId: number, actorId: number, email: string, role: 'admin' | 'member'): Promise<Record<string, unknown>> {
    await requireManage(orgId, actorId);
    const user = await repo.findUserByEmail(email.toLowerCase());
    if (!user) throw AppError.notFound('No user with that email (they must sign up first)');
    await repo.addMember(orgId, user.id, role);
    return { userId: user.id, role };
  },

  /**
   * B2B seat purchase. Computes GST via the shared helper (intra/inter-state),
   * issues a B2B invoice number, and increases the org's seat pool.
   */
  async purchaseSeats(orgId: number, actorId: number, seats: number, unitPrice: number): Promise<Record<string, unknown>> {
    const org = await requireManage(orgId, actorId);
    const subtotal = Math.round(seats * unitPrice * 100) / 100;
    const amounts = computeOrderAmounts({
      price: subtotal,
      discountAmount: 0,
      gstRate: env.GST_RATE_PERCENT,
      homeState: env.GST_HOME_STATE,
      billingState: org.billing_state ?? env.GST_HOME_STATE,
    });
    const seq = await repo.nextInvoiceSeq();
    const invoiceNo = `B2B/${fiscalYearLabel(new Date())}/${String(seq).padStart(4, '0')}`;
    return repo.recordSeatOrder(orgId, seats, unitPrice, amounts, invoiceNo, actorId);
  },

  async assignSeat(orgId: number, actorId: number, memberUserId: number, internshipId: number): Promise<Record<string, unknown>> {
    const org = await requireManage(orgId, actorId);
    if (!(await repo.isMember(orgId, memberUserId))) throw AppError.validation('That user is not a member of this organization.');
    if (await repo.memberHasSeat(orgId, memberUserId, internshipId)) {
      throw AppError.conflict('That member is already assigned this internship.');
    }
    const used = await repo.seatsUsed(orgId);
    if (used >= org.seats_total) throw AppError.conflict('No seats remaining — purchase more seats.');
    const { enrollmentId } = await repo.assignSeat(orgId, memberUserId, internshipId, actorId);
    return { enrollmentId, seatsRemaining: org.seats_total - used - 1 };
  },

  async team(orgId: number, actorId: number): Promise<Record<string, unknown>> {
    const org = await requireManage(orgId, actorId);
    const [members, used, orders] = await Promise.all([
      repo.teamDashboard(orgId), repo.seatsUsed(orgId), repo.seatOrders(orgId),
    ]);
    return {
      orgId,
      seatsTotal: org.seats_total,
      seatsUsed: used,
      seatsRemaining: org.seats_total - used,
      members,
      invoices: orders,
    };
  },
};
