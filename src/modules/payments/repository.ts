import type { PoolClient } from 'pg';
import { query, queryOne } from '../../db/pool';
import type { OrderAmounts } from './gst';

/** Scholarship coupons assigned to a user that are still usable. */
export async function scholarshipsForUser(userId: number): Promise<unknown[]> {
  return query(
    `select c.code, c.discount_type as "discountType", c.discount_value as "discountValue",
            c.max_discount_amount as "maxDiscountAmount", c.eligibility_note as "eligibilityNote",
            c.valid_until as "validUntil", i.title as "internshipTitle", i.slug as "internshipSlug",
            (c.redemption_count >= coalesce(c.max_redemptions, 1)
             or exists (select 1 from orders o where o.coupon_id = c.id and o.user_id = $1 and o.status = 'paid')) as "used"
     from coupons c
     left join internships i on i.id = c.internship_id
     where c.kind = 'scholarship' and c.assigned_user_id = $1 and c.is_active = true
       and (c.valid_until is null or c.valid_until > now())
     order by c.created_at desc`,
    [userId],
  );
}

export interface OrderRow {
  id: number;
  order_no: string;
  user_id: number;
  internship_id: number;
  batch_id: number | null;
  coupon_id: number | null;
  subtotal: string;
  discount_amount: string;
  taxable_amount: string;
  gst_rate: string;
  gst_amount: string;
  cgst_amount: string;
  sgst_amount: string;
  igst_amount: string;
  total_amount: string;
  status: 'created' | 'pending' | 'paid' | 'failed' | 'refunded' | 'cancelled';
  razorpay_order_id: string | null;
  invoice_no: string | null;
  invoice_url: string | null;
  billing_name: string | null;
  billing_email: string | null;
  billing_phone: string | null;
  billing_state: string | null;
  billing_gstin: string | null;
  created_at: Date;
}

export interface CouponRow {
  id: number;
  code: string;
  description: string | null;
  discount_type: 'percent' | 'flat';
  discount_value: string;
  max_discount_amount: string | null;
  internship_id: number | null;
  valid_from: Date | null;
  valid_until: Date | null;
  max_redemptions: number | null;
  redemption_count: number;
  per_user_limit: number;
  min_order_amount: string;
  is_active: boolean;
  // R1-S5 scholarships
  kind: 'standard' | 'scholarship';
  assigned_user_id: number | null;
  eligibility_note: string | null;
}

export interface RefundRow {
  id: number;
  order_id: number;
  payment_id: number;
  razorpay_refund_id: string | null;
  amount: string;
  reason: string | null;
  status: 'requested' | 'approved' | 'rejected' | 'processed';
  requested_by: number;
}

const O_COLS = `id, order_no, user_id, internship_id, batch_id, coupon_id, subtotal,
  discount_amount, taxable_amount, gst_rate, gst_amount, cgst_amount, sgst_amount,
  igst_amount, total_amount, status, razorpay_order_id, invoice_no, invoice_url,
  billing_name, billing_email, billing_phone, billing_state, billing_gstin, created_at`;

export const paymentsRepository = {
  couponByCode(code: string): Promise<CouponRow | null> {
    return queryOne<CouponRow>(`select * from coupons where code = $1`, [code]);
  },

  async userCouponUses(couponId: number, userId: number): Promise<number> {
    const row = await queryOne<{ n: number }>(
      `select count(*)::int8 as n from orders
       where coupon_id = $1 and user_id = $2 and status in ('created', 'pending', 'paid')`,
      [couponId, userId],
    );
    return row?.n ?? 0;
  },

  async insertOrder(
    client: PoolClient,
    input: {
      userId: number;
      internshipId: number;
      batchId: number | null;
      couponId: number | null;
      amounts: OrderAmounts;
      billing: { name: string; email: string; phone: string; state: string; gstin: string | null };
    },
  ): Promise<OrderRow> {
    const res = await client.query<OrderRow>(
      `insert into orders
         (order_no, user_id, internship_id, batch_id, coupon_id, subtotal, discount_amount,
          taxable_amount, gst_rate, gst_amount, cgst_amount, sgst_amount, igst_amount,
          total_amount, status, billing_name, billing_email, billing_phone, billing_state, billing_gstin)
       values ('ORD-' || extract(year from now())::int || '-' || lpad(nextval('seq_order_no')::text, 6, '0'),
               $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'created',
               $14, $15, $16, $17, $18)
       returning ${O_COLS}`,
      [
        input.userId,
        input.internshipId,
        input.batchId,
        input.couponId,
        input.amounts.subtotal,
        input.amounts.discountAmount,
        input.amounts.taxableAmount,
        input.amounts.gstRate,
        input.amounts.gstAmount,
        input.amounts.cgstAmount,
        input.amounts.sgstAmount,
        input.amounts.igstAmount,
        input.amounts.totalAmount,
        input.billing.name,
        input.billing.email,
        input.billing.phone,
        input.billing.state,
        input.billing.gstin,
      ],
    );
    const row = res.rows[0];
    if (!row) throw new Error('order insert returned no row');
    return row;
  },

  orderById(id: number): Promise<OrderRow | null> {
    return queryOne<OrderRow>(`select ${O_COLS} from orders where id = $1`, [id]);
  },

  orderByRazypayOrderId(razorpayOrderId: string): Promise<OrderRow | null> {
    return queryOne<OrderRow>(`select ${O_COLS} from orders where razorpay_order_id = $1`, [
      razorpayOrderId,
    ]);
  },

  myOrders(userId: number, limit: number, offset: number): Promise<(OrderRow & { internship_title: string; total_count: number })[]> {
    return query(
      `select o.*, i.title as internship_title, count(*) over()::int8 as total_count
       from (select ${O_COLS} from orders where user_id = $1) o
       join internships i on i.id = o.internship_id
       order by o.created_at desc limit ${limit} offset ${offset}`,
      [userId],
    );
  },

  setRazorpayOrderId(orderId: number, razorpayOrderId: string): Promise<unknown> {
    return query(`update orders set razorpay_order_id = $2, status = 'pending' where id = $1`, [
      orderId,
      razorpayOrderId,
    ]);
  },

  setOrderStatus(client: PoolClient, orderId: number, status: OrderRow['status']): Promise<unknown> {
    return client.query(`update orders set status = $2 where id = $1`, [orderId, status]);
  },

  cancelOrder(orderId: number): Promise<unknown> {
    return query(`update orders set status = 'cancelled' where id = $1`, [orderId]);
  },

  async paymentByProviderId(razorpayPaymentId: string): Promise<{ id: number; status: string } | null> {
    return queryOne(`select id, status from payments where razorpay_payment_id = $1`, [
      razorpayPaymentId,
    ]);
  },

  async insertCapturedPayment(
    client: PoolClient,
    input: {
      orderId: number;
      razorpayPaymentId: string;
      amount: number;
      method: string | null;
      payload: unknown;
    },
  ): Promise<number> {
    const res = await client.query<{ id: number }>(
      `insert into payments (order_id, razorpay_payment_id, amount, method, status, captured_at, webhook_payload)
       values ($1, $2, $3, $4, 'captured', now(), $5)
       on conflict (razorpay_payment_id) do nothing
       returning id`,
      [input.orderId, input.razorpayPaymentId, input.amount, input.method, JSON.stringify(input.payload)],
    );
    return res.rows[0]?.id ?? 0; // 0 → duplicate delivery, caller treats as no-op
  },

  insertFailedPayment(input: {
    orderId: number;
    razorpayPaymentId: string | null;
    amount: number;
    failureCode: string | null;
    failureReason: string | null;
    payload: unknown;
  }): Promise<unknown> {
    return query(
      `insert into payments (order_id, razorpay_payment_id, amount, status, failure_code, failure_reason, webhook_payload)
       values ($1, $2, $3, 'failed', $4, $5, $6)
       on conflict (razorpay_payment_id) do nothing`,
      [
        input.orderId,
        input.razorpayPaymentId,
        input.amount,
        input.failureCode,
        input.failureReason,
        JSON.stringify(input.payload),
      ],
    );
  },

  bumpCouponRedemption(client: PoolClient, couponId: number): Promise<unknown> {
    return client.query(`update coupons set redemption_count = redemption_count + 1 where id = $1`, [
      couponId,
    ]);
  },

  async assignInvoiceNo(client: PoolClient, orderId: number, invoiceNo: string): Promise<void> {
    await client.query(`update orders set invoice_no = $2 where id = $1 and invoice_no is null`, [
      orderId,
      invoiceNo,
    ]);
  },

  async nextInvoiceSeq(client: PoolClient): Promise<number> {
    const res = await client.query<{ n: number }>(`select nextval('seq_invoice_no')::int8 as n`);
    return Number(res.rows[0]?.n ?? 0);
  },

  setInvoiceUrl(orderId: number, url: string): Promise<unknown> {
    return query(`update orders set invoice_url = $2 where id = $1`, [orderId, url]);
  },

  insertEarning(
    client: PoolClient,
    input: {
      instructorProfileId: number;
      internshipId: number;
      orderId: number;
      paymentId: number;
      enrollmentId: number | null;
      grossAmount: number;
      sharePercent: number;
      amount: number;
      availableAfterDays: number;
    },
  ): Promise<unknown> {
    return client.query(
      `insert into instructor_earnings
         (instructor_profile_id, internship_id, order_id, payment_id, enrollment_id,
          gross_amount, revenue_share_percent, amount, status, available_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', now() + ($9 || ' days')::interval)
       on conflict (payment_id) do nothing`,
      [
        input.instructorProfileId,
        input.internshipId,
        input.orderId,
        input.paymentId,
        input.enrollmentId,
        input.grossAmount,
        input.sharePercent,
        input.amount,
        input.availableAfterDays,
      ],
    );
  },

  reverseEarningByOrder(orderId: number, reason: string): Promise<unknown> {
    return query(
      `update instructor_earnings
       set status = 'reversed', reversed_at = now(), reversal_reason = $2
       where order_id = $1 and status in ('pending', 'available')`,
      [orderId, reason],
    );
  },

  capturedPaymentForOrder(orderId: number): Promise<{ id: number; razorpay_payment_id: string | null; amount: string } | null> {
    return queryOne(
      `select id, razorpay_payment_id, amount from payments
       where order_id = $1 and status = 'captured' order by id desc limit 1`,
      [orderId],
    );
  },

  insertRefundRequest(input: {
    orderId: number;
    paymentId: number;
    amount: string;
    reason: string;
    requestedBy: number;
  }): Promise<RefundRow> {
    return queryOne<RefundRow>(
      `insert into refunds (order_id, payment_id, amount, reason, status, requested_by)
       values ($1, $2, $3, $4, 'requested', $5)
       returning id, order_id, payment_id, razorpay_refund_id, amount, reason, status, requested_by`,
      [input.orderId, input.paymentId, input.amount, input.reason, input.requestedBy],
    ) as Promise<RefundRow>;
  },

  refundById(id: number): Promise<RefundRow | null> {
    return queryOne<RefundRow>(
      `select id, order_id, payment_id, razorpay_refund_id, amount, reason, status, requested_by
       from refunds where id = $1`,
      [id],
    );
  },

  openRefundForOrder(orderId: number): Promise<RefundRow | null> {
    return queryOne<RefundRow>(
      `select id, order_id, payment_id, razorpay_refund_id, amount, reason, status, requested_by
       from refunds where order_id = $1 and status in ('requested', 'approved')`,
      [orderId],
    );
  },

  updateRefund(
    id: number,
    fields: { status: RefundRow['status']; razorpayRefundId?: string; decidedBy?: number; rejectionReason?: string },
  ): Promise<unknown> {
    return query(
      `update refunds set
         status = $2::refund_status,
         razorpay_refund_id = coalesce($3, razorpay_refund_id),
         decided_by = coalesce($4, decided_by),
         decided_at = case when $4 is not null then now() else decided_at end,
         rejection_reason = coalesce($5, rejection_reason),
         processed_at = case when $2::refund_status = 'processed' then now() else processed_at end
       where id = $1
         -- SEC-08: decisions (decided_by set) may only claim a 'requested' row,
         -- so two admins racing the same refund can't double-approve.
         and ($4::int8 is null or status = 'requested')`,
      [id, fields.status, fields.razorpayRefundId ?? null, fields.decidedBy ?? null, fields.rejectionReason ?? null],
    );
  },

  adminRefunds(
    status: string | undefined,
    limit: number,
    offset: number,
  ): Promise<(RefundRow & { order_no: string; user_name: string; total_count: number })[]> {
    return query(
      `select r.id, r.order_id, r.payment_id, r.razorpay_refund_id, r.amount, r.reason,
              r.status, r.requested_by, o.order_no, u.full_name as user_name,
              count(*) over()::int8 as total_count
       from refunds r
       join orders o on o.id = r.order_id
       join users u on u.id = r.requested_by
       where ($1::refund_status is null or r.status = $1)
       order by r.created_at asc
       limit ${limit} offset ${offset}`,
      [status ?? null],
    );
  },

  markOrderRefunded(orderId: number): Promise<unknown> {
    return query(`update orders set status = 'refunded' where id = $1`, [orderId]);
  },

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminOrders(status: string | undefined, q: string | undefined, limit: number, offset: number): Promise<(Record<string, any> & { total_count: number })[]> {
    return query(
      `select o.id, o.order_no, o.total_amount, o.status, o.invoice_no, o.invoice_url, o.created_at,
              u.full_name as user_name, u.email::text as user_email, i.title as internship_title,
              exists (select 1 from refunds rf where rf.order_id = o.id) as has_refund,
              count(*) over()::int8 as total_count
       from orders o
       join users u on u.id = o.user_id
       left join internships i on i.id = o.internship_id
       where ($1::order_status is null or o.status = $1)
         and ($2::text is null or o.order_no ilike $2 or u.full_name ilike $2 or u.email::text ilike $2)
       order by o.created_at desc
       limit ${limit} offset ${offset}`,
      [status ?? null, q ? `%${q}%` : null],
    );
  },
};
