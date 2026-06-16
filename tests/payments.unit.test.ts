import {
  computeOrderAmounts,
  couponDiscount,
  fiscalYearLabel,
  formatInvoiceNo,
  instructorEarning,
} from '../src/modules/payments/gst';

describe('GST math', () => {
  it('intra-state splits CGST/SGST exactly', () => {
    const a = computeOrderAmounts({ price: 4999, discountAmount: 500, gstRate: 18, homeState: 'Gujarat', billingState: 'gujarat ' });
    expect(a.taxableAmount).toBe(4499);
    expect(a.gstAmount).toBe(809.82);
    expect(a.cgstAmount + a.sgstAmount).toBe(a.gstAmount);
    expect(a.igstAmount).toBe(0);
    expect(a.totalAmount).toBe(5308.82);
    expect(a.totalPaise).toBe(530882);
  });

  it('inter-state uses IGST only', () => {
    const a = computeOrderAmounts({ price: 7999, discountAmount: 0, gstRate: 18, homeState: 'Gujarat', billingState: 'Maharashtra' });
    expect(a.igstAmount).toBe(1439.82);
    expect(a.cgstAmount).toBe(0);
    expect(a.sgstAmount).toBe(0);
  });

  it('coupon percent respects cap and min order', () => {
    const coupon = { discount_type: 'percent' as const, discount_value: 10, max_discount_amount: 500, min_order_amount: 0 };
    expect(couponDiscount(coupon, 4999)).toBe(499.9);
    expect(couponDiscount(coupon, 9000)).toBe(500);
    expect(couponDiscount({ ...coupon, min_order_amount: 10000 }, 9000)).toBe(0);
  });

  it('fiscal year flips on April 1', () => {
    expect(fiscalYearLabel(new Date('2026-06-12'))).toBe('2026-27');
    expect(fiscalYearLabel(new Date('2026-03-31'))).toBe('2025-26');
    expect(formatInvoiceNo(1, new Date('2026-06-12'))).toBe('INV/2026-27/0001');
  });

  it('instructor earning: share after 2% gateway fee on total', () => {
    const e = instructorEarning({ taxableAmount: 4499, totalAmount: 5308.82, gatewayFeePercent: 2, sharePercent: 70 });
    expect(e.grossBase).toBe(4392.82);   // 4499 − 106.18
    expect(e.amount).toBe(3074.97);      // 70%
  });
});
