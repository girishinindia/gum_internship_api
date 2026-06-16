/** Pure money/GST helpers — no IO, fully unit-tested. All amounts in INR rupees (2dp). */

export interface CouponLite {
  discount_type: 'percent' | 'flat';
  discount_value: string | number;
  max_discount_amount: string | number | null;
  min_order_amount: string | number;
}

export interface OrderAmounts {
  subtotal: number;
  discountAmount: number;
  taxableAmount: number;
  gstRate: number;
  gstAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  totalAmount: number;
  totalPaise: number;
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function couponDiscount(coupon: CouponLite, subtotal: number): number {
  if (subtotal < Number(coupon.min_order_amount)) return 0;
  let discount =
    coupon.discount_type === 'percent'
      ? (subtotal * Number(coupon.discount_value)) / 100
      : Number(coupon.discount_value);
  const cap = coupon.max_discount_amount === null ? null : Number(coupon.max_discount_amount);
  if (cap !== null) discount = Math.min(discount, cap);
  return round2(Math.min(discount, subtotal));
}

/**
 * GST split: place of supply (billing state) equals our home state →
 * intra-state: CGST + SGST (half each); otherwise inter-state: IGST.
 */
export function computeOrderAmounts(input: {
  price: number;
  discountAmount: number;
  gstRate: number;
  homeState: string;
  billingState: string;
}): OrderAmounts {
  const subtotal = round2(input.price);
  const discountAmount = round2(Math.min(input.discountAmount, subtotal));
  const taxableAmount = round2(subtotal - discountAmount);
  const gstAmount = round2((taxableAmount * input.gstRate) / 100);
  const intraState = normalizeState(input.billingState) === normalizeState(input.homeState);
  const cgstAmount = intraState ? round2(gstAmount / 2) : 0;
  // SGST takes the rounding remainder so cgst+sgst === gstAmount exactly.
  const sgstAmount = intraState ? round2(gstAmount - cgstAmount) : 0;
  const igstAmount = intraState ? 0 : gstAmount;
  const totalAmount = round2(taxableAmount + gstAmount);
  return {
    subtotal,
    discountAmount,
    taxableAmount,
    gstRate: input.gstRate,
    gstAmount,
    cgstAmount,
    sgstAmount,
    igstAmount,
    totalAmount,
    totalPaise: Math.round(totalAmount * 100),
  };
}

export function normalizeState(s: string): string {
  return s.trim().toLowerCase();
}

/** Indian fiscal year label: Apr 1 boundary. June 2026 → '2026-27'. */
export function fiscalYearLabel(date: Date): string {
  const y = date.getFullYear();
  const startYear = date.getMonth() + 1 >= 4 ? y : y - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

/** INV/2026-27/0001 — sequence is globally monotonic (unique + sequential). */
export function formatInvoiceNo(seq: number, date: Date): string {
  return `INV/${fiscalYearLabel(date)}/${String(seq).padStart(4, '0')}`;
}

/** Instructor earning: share % applied to (taxable − gateway fee on total). */
export function instructorEarning(input: {
  taxableAmount: number;
  totalAmount: number;
  gatewayFeePercent: number;
  sharePercent: number;
}): { grossBase: number; amount: number } {
  const gatewayFee = round2((input.totalAmount * input.gatewayFeePercent) / 100);
  const grossBase = round2(Math.max(input.taxableAmount - gatewayFee, 0));
  return { grossBase, amount: round2((grossBase * input.sharePercent) / 100) };
}
