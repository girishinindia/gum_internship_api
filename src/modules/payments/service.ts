import dayjs from 'dayjs';
import { env } from '../../config/env';
import { buildPagination } from '../../core/apiResponse';
import type { PaginationMeta } from '../../core/apiResponse';
import { AppError } from '../../core/appError';
import { ErrorCodes } from '../../core/errorCodes';
import { logger } from '../../core/logger';
import { tx } from '../../db/pool';
import { jobQueue } from '../../services/jobQueue';
import { notifyService } from '../../services/notify';
import { generateInvoicePdf } from '../../services/pdf';
import { razorpayService } from '../../services/razorpay';
import { storageService } from '../../services/storage';
import { enrollmentsRepository } from '../enrollments/repository';
import { enrollmentsService } from '../enrollments/service';
import {
  computeOrderAmounts,
  couponDiscount,
  formatInvoiceNo,
  instructorEarning,
  round2,
} from './gst';
import type { CouponRow, OrderRow } from './repository';
import { paymentsRepository as repo } from './repository';
import type { CouponValidateInput, OrderConfirmInput, OrderCreateInput } from './schemas';

interface CouponCheck {
  valid: boolean;
  reason?: string;
  coupon?: CouponRow;
  discount: number;
}

async function checkCoupon(
  code: string,
  internshipId: number,
  userId: number,
  subtotal: number,
): Promise<CouponCheck> {
  const coupon = await repo.couponByCode(code);
  if (!coupon || !coupon.is_active) return { valid: false, reason: 'Unknown or inactive coupon', discount: 0 };
  const now = Date.now();
  if (coupon.valid_from && new Date(coupon.valid_from).getTime() > now)
    return { valid: false, reason: 'Coupon not active yet', discount: 0 };
  if (coupon.valid_until && new Date(coupon.valid_until).getTime() < now)
    return { valid: false, reason: 'Coupon expired', discount: 0 };
  if (coupon.internship_id !== null && coupon.internship_id !== internshipId)
    return { valid: false, reason: 'Coupon not valid for this internship', discount: 0 };
  // R1-S5: scholarships are bound to one student — only the assignee may redeem.
  if (coupon.assigned_user_id !== null && coupon.assigned_user_id !== userId)
    return { valid: false, reason: 'This scholarship is not assigned to your account', discount: 0 };
  if (coupon.max_redemptions !== null && coupon.redemption_count >= coupon.max_redemptions)
    return { valid: false, reason: 'Coupon fully redeemed', discount: 0 };
  if ((await repo.userCouponUses(coupon.id, userId)) >= coupon.per_user_limit)
    return { valid: false, reason: 'You have already used this coupon', discount: 0 };
  if (subtotal < Number(coupon.min_order_amount))
    return { valid: false, reason: `Minimum order ₹${coupon.min_order_amount}`, discount: 0 };
  return { valid: true, coupon, discount: couponDiscount(coupon, subtotal) };
}

function orderDto(o: OrderRow): Record<string, unknown> {
  return {
    id: o.id,
    orderNo: o.order_no,
    internshipId: o.internship_id,
    batchId: o.batch_id,
    subtotal: Number(o.subtotal),
    discountAmount: Number(o.discount_amount),
    taxableAmount: Number(o.taxable_amount),
    gstRate: Number(o.gst_rate),
    gstAmount: Number(o.gst_amount),
    cgstAmount: Number(o.cgst_amount),
    sgstAmount: Number(o.sgst_amount),
    igstAmount: Number(o.igst_amount),
    totalAmount: Number(o.total_amount),
    status: o.status,
    razorpayOrderId: o.razorpay_order_id,
    invoiceNo: o.invoice_no,
    createdAt: o.created_at,
  };
}

function checkoutParams(order: OrderRow): Record<string, unknown> {
  return {
    order: orderDto(order),
    razorpayKeyId: env.RAZORPAY_KEY_ID,
    razorpayOrderId: order.razorpay_order_id,
    amountPaise: Math.round(Number(order.total_amount) * 100),
    currency: 'INR',
    // The client must follow the SERVER's mode, not a public env key: in dry-run
    // there is no real gateway, so the client confirms with the dev token.
    devMode: env.PAYMENTS_DRY_RUN,
    prefill: { name: order.billing_name, email: order.billing_email, contact: order.billing_phone },
  };
}

export const paymentsService = {
  async validateCoupon(userId: number, input: CouponValidateInput): Promise<Record<string, unknown>> {
    const internship = await enrollmentsRepository.internshipLite(input.internshipId);
    if (!internship || internship.status !== 'published') throw AppError.notFound('Internship');
    const subtotal = round2(Number(internship.price));
    const check = await checkCoupon(input.code, input.internshipId, userId, subtotal);
    const amounts = computeOrderAmounts({
      price: subtotal,
      discountAmount: check.discount,
      gstRate: Number(internship.gst_rate),
      homeState: env.GST_HOME_STATE,
      billingState: env.GST_HOME_STATE, // preview assumes intra-state; final split at order time
    });
    return {
      valid: check.valid,
      code: input.code,
      reason: check.reason ?? null,
      discountAmount: check.discount,
      finalTotal: amounts.totalAmount,
    };
  },

  /** WEB CHECKOUT ONLY (mobile is consumption-first). */
  async createOrder(userId: number, input: OrderCreateInput): Promise<Record<string, unknown>> {
    const internship = await enrollmentsRepository.internshipLite(input.internshipId);
    if (!internship || internship.status !== 'published') throw AppError.notFound('Internship');
    if (internship.pricing_type !== 'paid') {
      throw AppError.validation('This internship is free — enroll directly');
    }
    if (internship.pace_type === 'batch' && !input.batchId) {
      throw AppError.validation('batchId is required for cohort internships');
    }

    const subtotal = round2(Number(internship.price));
    let couponId: number | null = null;
    let discount = 0;
    if (input.couponCode) {
      const check = await checkCoupon(input.couponCode, input.internshipId, userId, subtotal);
      if (!check.valid || !check.coupon) {
        throw new AppError(ErrorCodes.COUPON_INVALID, check.reason ?? 'Invalid coupon');
      }
      couponId = check.coupon.id;
      discount = check.discount;
    }

    const amounts = computeOrderAmounts({
      price: subtotal,
      discountAmount: discount,
      gstRate: Number(internship.gst_rate),
      homeState: env.GST_HOME_STATE,
      billingState: input.billingState,
    });

    const order = await tx((client) =>
      repo.insertOrder(client, {
        userId,
        internshipId: input.internshipId,
        batchId: input.batchId ?? null,
        couponId,
        amounts,
        billing: {
          name: input.billingName,
          email: input.billingEmail,
          phone: input.billingPhone,
          state: input.billingState,
          gstin: input.billingGstin ?? null,
        },
      }),
    );

    // Reserve the seat-checked pending enrollment; roll the order back if it fails.
    try {
      await enrollmentsService.reservePendingEnrollment(
        userId,
        input.internshipId,
        input.batchId ?? null,
        order.id,
      );
    } catch (err) {
      await repo.cancelOrder(order.id);
      throw err;
    }

    const { razorpayOrderId } = await razorpayService.createOrder(amounts.totalPaise, order.order_no);
    await repo.setRazorpayOrderId(order.id, razorpayOrderId);
    const fresh = await repo.orderById(order.id);
    return checkoutParams(fresh as OrderRow);
  },

  /** Failed/abandoned payment → fresh Razorpay order for the SAME order row. */
  async retryOrder(userId: number, orderId: number): Promise<Record<string, unknown>> {
    const order = await repo.orderById(orderId);
    if (!order || order.user_id !== userId) throw AppError.notFound('Order');
    if (order.status === 'paid') throw AppError.conflict('Order is already paid');
    if (order.status === 'cancelled' || order.status === 'refunded') {
      throw AppError.conflict('Order can no longer be paid — create a new one');
    }
    const { razorpayOrderId } = await razorpayService.createOrder(
      Math.round(Number(order.total_amount) * 100),
      `${order.order_no}-retry`,
    );
    await repo.setRazorpayOrderId(order.id, razorpayOrderId);
    return checkoutParams((await repo.orderById(order.id)) as OrderRow);
  },

  /**
   * Synchronous confirmation from Razorpay Checkout's success handler. Verifies
   * the handler signature with the KEY SECRET (no webhook secret required), then
   * runs the SAME idempotent capture pipeline as the webhook — so enrolment +
   * invoice happen instantly and the browser never has to poll. The webhook,
   * once configured, is a redundant backup (deduped by razorpay_payment_id).
   */
  async confirmCheckout(userId: number, orderId: number, input: OrderConfirmInput): Promise<Record<string, unknown>> {
    const order = await repo.orderById(orderId);
    if (!order || order.user_id !== userId) throw AppError.notFound('Order');
    if (order.status === 'paid') return { status: 'paid', orderId: order.id };
    if (order.status === 'cancelled' || order.status === 'refunded') {
      throw AppError.conflict('Order can no longer be paid — create a new one');
    }
    if (!order.razorpay_order_id) throw AppError.conflict('Order has no payment session');
    if (!razorpayService.verifyCheckoutSignature(order.razorpay_order_id, input.razorpayPaymentId, input.razorpaySignature)) {
      throw new AppError(ErrorCodes.WEBHOOK_SIGNATURE_INVALID, 'Payment could not be verified');
    }
    // The signature proves Razorpay accepted this payment for THIS order, so we
    // finalise against the amount we charged; onPaymentCaptured re-checks it and
    // dedups, making a later webhook delivery a no-op.
    const amountPaise = Math.round(Number(order.total_amount) * 100);
    await this.onPaymentCaptured(
      { id: input.razorpayPaymentId, order_id: order.razorpay_order_id, amount: amountPaise, method: 'razorpay' },
      { source: 'checkout-handler', confirmedAt: new Date().toISOString() },
    );
    const fresh = await repo.orderById(orderId);
    return { status: fresh?.status ?? 'pending', orderId };
  },

  async myOrders(userId: number, page: number, limit: number): Promise<{ items: unknown[]; pagination: PaginationMeta }> {
    const rows = await repo.myOrders(userId, limit, (page - 1) * limit);
    const total = rows[0]?.total_count ?? 0;
    return {
      items: rows.map((r) => ({ ...orderDto(r), internshipTitle: r.internship_title })),
      pagination: buildPagination(page, limit, total),
    };
  },

  async getOrder(userId: number, orderId: number): Promise<Record<string, unknown>> {
    const order = await repo.orderById(orderId);
    if (!order || order.user_id !== userId) throw AppError.notFound('Order');
    return orderDto(order);
  },

  async invoiceLink(userId: number, orderId: number): Promise<Record<string, unknown>> {
    const order = await repo.orderById(orderId);
    if (!order || order.user_id !== userId) throw AppError.notFound('Order');
    if (!order.invoice_url) throw AppError.notFound('Invoice (generated after successful payment)');
    return { invoiceNo: order.invoice_no, ...storageService.signedPrivateUrl(order.invoice_url) };
  },

  /**
   * Razorpay webhook. Security: HMAC-SHA256 over RAW body, constant-time
   * compare; unknown events → 200 (ack, no-op); duplicate deliveries are
   * detected via payments.razorpay_payment_id unique + insert-on-conflict, so
   * the entire capture pipeline runs at most once per payment id.
   */
  async handleWebhook(rawBody: Buffer | undefined, signature: string | undefined): Promise<{ status: string }> {
    if (!rawBody || !razorpayService.verifyWebhookSignature(rawBody, signature)) {
      throw new AppError(ErrorCodes.WEBHOOK_SIGNATURE_INVALID, 'Invalid webhook signature');
    }
    const event = JSON.parse(rawBody.toString('utf8')) as {
      event: string;
      payload?: { payment?: { entity?: Record<string, unknown> }; refund?: { entity?: Record<string, unknown> } };
    };

    switch (event.event) {
      case 'payment.captured':
        return this.onPaymentCaptured(event.payload?.payment?.entity ?? {}, event);
      case 'payment.failed':
        return this.onPaymentFailed(event.payload?.payment?.entity ?? {}, event);
      case 'refund.processed':
        return this.onRefundProcessed(event.payload?.refund?.entity ?? {});
      default:
        return { status: 'ignored' };
    }
  },

  async onPaymentCaptured(entity: Record<string, unknown>, payload: unknown): Promise<{ status: string }> {
    const razorpayPaymentId = String(entity.id ?? '');
    const razorpayOrderId = String(entity.order_id ?? '');
    const amountPaise = Number(entity.amount ?? 0);
    if (!razorpayPaymentId || !razorpayOrderId) return { status: 'ignored' };

    const existing = await repo.paymentByProviderId(razorpayPaymentId);
    if (existing) return { status: 'duplicate-ignored' };

    const order = await repo.orderByRazypayOrderId(razorpayOrderId);
    if (!order) {
      logger.warn({ razorpayOrderId }, 'webhook for unknown order');
      return { status: 'ignored' };
    }
    if (amountPaise !== Math.round(Number(order.total_amount) * 100)) {
      logger.error({ orderId: order.id, amountPaise }, 'webhook amount mismatch — manual review');
      // SEC-04: tamper attempts must be visible to finance, not just in logs.
      const { query: dbq } = await import('../../db/pool');
      await dbq(
        `insert into audit_logs (action, entity_type, entity_id, after_data)
         values ('payment.amount_mismatch', 'order', $1, $2)`,
        [order.id, JSON.stringify({ expectedPaise: Math.round(Number(order.total_amount) * 100), receivedPaise: amountPaise, razorpayPaymentId })],
      );
      return { status: 'amount-mismatch-flagged' };
    }

    const internship = await enrollmentsRepository.internshipLite(order.internship_id);
    let invoiceNo: string | null = null;

    const inserted = await tx(async (client) => {
      const paymentId = await repo.insertCapturedPayment(client, {
        orderId: order.id,
        razorpayPaymentId,
        amount: round2(amountPaise / 100),
        method: entity.method ? String(entity.method) : null,
        payload,
      });
      if (paymentId === 0) return false; // raced duplicate delivery
      await repo.setOrderStatus(client, order.id, 'paid');
      if (order.coupon_id) await repo.bumpCouponRedemption(client, order.coupon_id);
      const seq = await repo.nextInvoiceSeq(client);
      invoiceNo = formatInvoiceNo(seq, new Date());
      await repo.assignInvoiceNo(client, order.id, invoiceNo);

      if (internship && internship.provider_type === 'external') {
        const earning = instructorEarning({
          taxableAmount: Number(order.taxable_amount),
          totalAmount: Number(order.total_amount),
          gatewayFeePercent: env.GATEWAY_FEE_PERCENT,
          sharePercent: Number(internship.revenue_share_percent),
        });
        const enrollment = await enrollmentsRepository.findByOrderId(order.id);
        await repo.insertEarning(client, {
          instructorProfileId: internship.instructor_profile_id,
          internshipId: internship.id,
          orderId: order.id,
          paymentId,
          enrollmentId: enrollment?.id ?? null,
          grossAmount: earning.grossBase,
          sharePercent: Number(internship.revenue_share_percent),
          amount: earning.amount,
          availableAfterDays: env.REFUND_WINDOW_DAYS,
        });
      }
      return true;
    });

    if (!inserted) return { status: 'duplicate-ignored' };

    await enrollmentsService.activateEnrollmentByOrder(order.id);
    this.queueInvoice(order.id);
    return { status: 'processed' };
  },

  async onPaymentFailed(entity: Record<string, unknown>, payload: unknown): Promise<{ status: string }> {
    const razorpayOrderId = String(entity.order_id ?? '');
    const order = razorpayOrderId ? await repo.orderByRazypayOrderId(razorpayOrderId) : null;
    if (!order || order.status === 'paid') return { status: 'ignored' };
    await repo.insertFailedPayment({
      orderId: order.id,
      razorpayPaymentId: entity.id ? String(entity.id) : null,
      amount: round2(Number(entity.amount ?? 0) / 100),
      failureCode: entity.error_code ? String(entity.error_code) : null,
      failureReason: entity.error_description ? String(entity.error_description) : null,
      payload,
    });
    // Order stays 'pending' — the student can POST /orders/:id/retry.
    return { status: 'failure-recorded' };
  },

  async onRefundProcessed(entity: Record<string, unknown>): Promise<{ status: string }> {
    const razorpayRefundId = String(entity.id ?? '');
    if (!razorpayRefundId) return { status: 'ignored' };
    return this.finalizeRefundByProviderId(razorpayRefundId);
  },

  async finalizeRefundByProviderId(razorpayRefundId: string): Promise<{ status: string }> {
    const refund = await import('../../db/pool').then(({ queryOne }) =>
      queryOne<{ id: number; order_id: number; status: string }>(
        `select id, order_id, status from refunds where razorpay_refund_id = $1`,
        [razorpayRefundId],
      ),
    );
    if (!refund || refund.status === 'processed') return { status: 'duplicate-ignored' };
    await repo.updateRefund(refund.id, { status: 'processed' });
    await repo.markOrderRefunded(refund.order_id);
    await repo.reverseEarningByOrder(refund.order_id, 'refund processed');
    await enrollmentsService.suspendEnrollmentByOrder(refund.order_id);
    return { status: 'refund-processed' };
  },

  async requestRefund(userId: number, orderId: number, reason: string): Promise<Record<string, unknown>> {
    const order = await repo.orderById(orderId);
    if (!order || order.user_id !== userId) throw AppError.notFound('Order');
    if (order.status !== 'paid') throw AppError.conflict('Only paid orders can be refunded');
    if (await repo.openRefundForOrder(orderId)) {
      throw AppError.conflict('A refund request is already open for this order');
    }
    const payment = await repo.capturedPaymentForOrder(orderId);
    if (!payment) throw AppError.conflict('No captured payment found for this order');
    const refund = await repo.insertRefundRequest({
      orderId,
      paymentId: payment.id,
      amount: order.total_amount,
      reason,
      requestedBy: userId,
    });
    return { id: refund.id, status: refund.status, amount: Number(refund.amount) };
  },

  async decideRefund(
    actorId: number,
    refundId: number,
    decision: 'approved' | 'rejected',
    reason?: string,
  ): Promise<Record<string, unknown>> {
    const refund = await repo.refundById(refundId);
    if (!refund) throw AppError.notFound('Refund');
    if (refund.status !== 'requested') throw AppError.conflict('Refund already decided');

    if (decision === 'rejected') {
      if (!reason) throw AppError.validation('reason is required when rejecting');
      await repo.updateRefund(refundId, { status: 'rejected', decidedBy: actorId, rejectionReason: reason });
      await enrollmentsRepository.audit({
        actorId, action: 'refund.reject', entityType: 'refund', entityId: refundId,
        before: { status: 'requested' }, after: { status: 'rejected', reason },
      });
      return { id: refundId, status: 'rejected' };
    }

    const payment = await repo.capturedPaymentForOrder(refund.order_id);
    if (!payment?.razorpay_payment_id) throw AppError.conflict('Captured payment missing provider id');
    const { razorpayRefundId } = await razorpayService.createRefund(
      payment.razorpay_payment_id,
      Math.round(Number(refund.amount) * 100),
    );
    await repo.updateRefund(refundId, { status: 'approved', razorpayRefundId, decidedBy: actorId });
    await enrollmentsRepository.audit({
      actorId, action: 'refund.approve', entityType: 'refund', entityId: refundId,
      before: { status: 'requested' }, after: { status: 'approved', razorpayRefundId },
    });
    // Real mode: Razorpay calls back with refund.processed. Dry run: settle now.
    if (env.PAYMENTS_DRY_RUN) await this.finalizeRefundByProviderId(razorpayRefundId);
    return { id: refundId, status: env.PAYMENTS_DRY_RUN ? 'processed' : 'approved', razorpayRefundId };
  },

  async adminRefunds(status: string | undefined, page: number, limit: number): Promise<{ items: unknown[]; pagination: PaginationMeta }> {
    const rows = await repo.adminRefunds(status, limit, (page - 1) * limit);
    const total = rows[0]?.total_count ?? 0;
    return {
      items: rows.map((r) => ({
        id: r.id, orderId: r.order_id, orderNo: r.order_no, userName: r.user_name,
        amount: Number(r.amount), reason: r.reason, status: r.status,
      })),
      pagination: buildPagination(page, limit, total),
    };
  },

  async adminOrders(status: string | undefined, q: string | undefined, page: number, limit: number): Promise<{ items: unknown[]; pagination: PaginationMeta }> {
    const rows = await repo.adminOrders(status, q, limit, (page - 1) * limit);
    const total = rows[0]?.total_count ?? 0;
    return {
      items: rows.map((r) => ({
        id: r.id, orderNo: r.order_no, userName: r.user_name, userEmail: r.user_email,
        internshipTitle: r.internship_title, totalAmount: Number(r.total_amount),
        status: r.status, invoiceNo: r.invoice_no, invoiceUrl: r.invoice_url,
        hasRefund: r.has_refund, createdAt: r.created_at,
      })),
      pagination: buildPagination(page, limit, total),
    };
  },

  /** Async invoice pipeline: pdf → Bunny private → email. Idempotent via invoice_url. */
  queueInvoice(orderId: number): void {
    jobQueue.enqueue(`invoice:${orderId}`, async () => {
      const order = await repo.orderById(orderId);
      if (!order || !order.invoice_no || order.invoice_url) return;
      const internship = await enrollmentsRepository.internshipLite(order.internship_id);
      const pdf = await generateInvoicePdf({
        invoiceNo: order.invoice_no,
        invoiceDate: dayjs(order.created_at).format('DD MMM YYYY'),
        orderNo: order.order_no,
        billing: {
          name: order.billing_name ?? '—',
          email: order.billing_email,
          phone: order.billing_phone,
          state: order.billing_state ?? '—',
          gstin: order.billing_gstin,
        },
        seller: { name: 'GUM Internships', state: env.GST_HOME_STATE, gstin: '24XXXXX0000X1Z5' },
        lineDescription: internship?.title ?? 'Internship program fee',
        subtotal: order.subtotal,
        discount: order.discount_amount,
        taxable: order.taxable_amount,
        gstRate: order.gst_rate,
        cgst: order.cgst_amount,
        sgst: order.sgst_amount,
        igst: order.igst_amount,
        total: order.total_amount,
      });
      const path = await storageService.upload(
        'private',
        `invoices/${order.invoice_no.replaceAll('/', '-')}.pdf`,
        pdf,
        'application/pdf',
      );
      await repo.setInvoiceUrl(order.id, path);
      if (order.billing_email) {
        await notifyService.sendEmail(
          order.billing_email,
          order.billing_name ?? 'there',
          `Payment received — invoice ${order.invoice_no}`,
          `<p>Thank you! Your payment for order <strong>${order.order_no}</strong> is confirmed. Your GST invoice <strong>${order.invoice_no}</strong> is available in your dashboard.</p>`,
        );
      }
      logger.info({ orderId, invoiceNo: order.invoice_no }, 'invoice generated');
    });
  },
};
