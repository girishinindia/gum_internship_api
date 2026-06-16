import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env';
import { logger } from '../core/logger';

/**
 * Razorpay REST facade (module 2.5). PAYMENTS_DRY_RUN=true fabricates
 * provider ids so the whole order→webhook→invoice pipeline runs locally;
 * signature verification is REAL in both modes (the test script signs with
 * the same webhook secret).
 */

const BASE = 'https://api.razorpay.com/v1';

function authHeader(): string {
  return `Basic ${Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64')}`;
}

export const razorpayService = {
  async createOrder(amountPaise: number, receipt: string): Promise<{ razorpayOrderId: string }> {
    if (env.PAYMENTS_DRY_RUN) {
      const id = `order_dev_${randomBytes(7).toString('hex')}`;
      logger.info({ id, amountPaise, receipt }, '[DRY RUN] razorpay order');
      return { razorpayOrderId: id };
    }
    const res = await fetch(`${BASE}/orders`, {
      method: 'POST',
      headers: { authorization: authHeader(), 'content-type': 'application/json' },
      body: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt }),
    });
    if (!res.ok) throw new Error(`Razorpay order create failed: ${res.status}`);
    const body = (await res.json()) as { id: string };
    return { razorpayOrderId: body.id };
  },

  async createRefund(razorpayPaymentId: string, amountPaise: number): Promise<{ razorpayRefundId: string }> {
    if (env.PAYMENTS_DRY_RUN) {
      const id = `rfnd_dev_${randomBytes(7).toString('hex')}`;
      logger.info({ id, razorpayPaymentId, amountPaise }, '[DRY RUN] razorpay refund');
      return { razorpayRefundId: id };
    }
    const res = await fetch(`${BASE}/payments/${razorpayPaymentId}/refund`, {
      method: 'POST',
      headers: { authorization: authHeader(), 'content-type': 'application/json' },
      body: JSON.stringify({ amount: amountPaise }),
    });
    if (!res.ok) throw new Error(`Razorpay refund failed: ${res.status}`);
    const body = (await res.json()) as { id: string };
    return { razorpayRefundId: body.id };
  },

  /**
   * Webhook security: HMAC-SHA256 over the RAW request body with the webhook
   * secret, compared in constant time. Never parse-then-restringify (byte
   * differences break the signature) — app.ts captures req.rawBody for this.
   */
  verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean {
    if (!signature) return false;
    const expected = createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET).update(rawBody).digest('hex');
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(signature, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  },

  /**
   * Razorpay Checkout handler signature: HMAC-SHA256(order_id|payment_id) with
   * the KEY SECRET. Used by flows that confirm a payment client-side (e.g.
   * mentor session bookings) rather than via webhook. In PAYMENTS_DRY_RUN we
   * accept a dev token so the booking flow is testable end-to-end.
   */
  verifyCheckoutSignature(orderId: string, paymentId: string, signature: string | undefined): boolean {
    if (!signature) return false;
    if (env.PAYMENTS_DRY_RUN && signature === 'dev_ok') return true;
    const expected = createHmac('sha256', env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(signature, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  },
};
