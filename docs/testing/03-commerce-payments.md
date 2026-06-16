# 03 — Enrollment, Payments, Coupons, Invoices & Refunds

**Owner:** T2 · **Apps:** Web :3000, API :4000, Admin :3100 (refund approval)
**Pre-req:** `PAYMENTS_DRY_RUN=true` (no real money; webhook is simulated). Logged in as `student@gum-demo.in`.

> How dry-run checkout works: creating an order returns Razorpay checkout params, but instead of a real popup you simulate the captured webhook with `internship-api/scripts/test-webhook.sh <razorpayOrderId> <amountPaise>`. The web success screen polls order status until `paid`.

---

## Flow A — Free enrollment

**T-03-01 — Enroll free (instant)**
- Steps: open Full-Stack internship (id 1) → Enroll for free → pick batch 1.
- Expected: 201, status `active` immediately; lands in classroom/my-internships. After a moment an **offer letter** (`OL-YYYY-NNNNNN`) is downloadable.
- Pass ☐ Fail ☐

**T-03-02 — Duplicate enrollment blocked** → `ALREADY_ENROLLED`. Pass ☐ Fail ☐

**T-03-03 — Waitlist** (internship 4 / a seats=1 batch — create via admin or use Flutter cohort): second learner when full + waitlist on → status `waitlisted`, position shown. Pass ☐ Fail ☐

## Flow B — Coupon validation (live)

**T-03-04 — Valid coupon preview**
- Steps: on paid checkout (internship 2) apply `FLUTTER500`.
- Expected: `valid:true`, discount ₹500, final total recomputed to **₹5,308.82** (server-computed, never client math).
- Pass ☐ Fail ☐

**T-03-05 — Coupon rule failures** (each returns `valid:false` + reason):
- `FLUTTER500` on internship 3 → "not valid for this internship". ☐
- `EARLYBIRD25` after its window / max redemptions → expired/redeemed. ☐
- a coupon below its min order → "Minimum order ₹…". ☐
- Pass ☐ Fail ☐

## Flow C — Paid checkout (web only)

**T-03-06 — Create order with exact GST (inter-state)**
- Steps: internship 2, batch 2, coupon FLUTTER500, billing state **Maharashtra** → create order.
- Expected: order shows discount ₹500, taxable ₹4,499, **IGST ₹809.82**, total ₹5,308.82; `amountPaise` 530882; a `pending_payment` enrollment exists.
- Pass ☐ Fail ☐

**T-03-07 — Intra-state split**
- Steps: same but billing **Gujarat**.
- Expected: **CGST ₹404.91 + SGST ₹404.91**, IGST 0, same total.
- Pass ☐ Fail ☐

**T-03-08 — Capture via webhook → activation + invoice**
- Steps: run `./scripts/test-webhook.sh <razorpayOrderId> 530882`.
- Expected: order → `paid`; enrollment → `active`; **GST invoice** `INV/2026-27/NNNN` generated (PDF in `var/storage/private/invoices/`); web success screen stops polling and shows "activated" with offer-letter download + Start Learning.
- Pass ☐ Fail ☐

**T-03-09 — Webhook idempotency (CRITICAL)**
- Steps: the script posts the same payment **twice**.
- Expected: first → `processed`; second → `duplicate-ignored`; exactly **one** captured payment row, **one** invoice, **one** earning. No double-charge artifacts.
- Pass ☐ Fail ☐

**T-03-10 — Forged signature rejected**
- Steps: script's bad-signature call.
- Expected: `401` — no state change.
- Pass ☐ Fail ☐

**T-03-11 — Amount tampering flagged**
- Steps: post a captured webhook with a wrong amount (e.g. `1`).
- Expected: status `amount-mismatch-flagged`; order stays unpaid; an `audit_logs` row `payment.amount_mismatch` is written for finance.
- Pass ☐ Fail ☐

**T-03-12 — Payment failure + retry**
- Steps: simulate `payment.failed`; then `POST /orders/:id/retry`.
- Expected: order stays `pending`; retry issues a fresh Razorpay order for the same order row; a subsequent capture activates it.
- Pass ☐ Fail ☐

**T-03-13 — Closed-popup / abandoned**
- Steps: create order, never capture; revisit.
- Expected: order remains `pending`/resumable; seat not consumed permanently; UI offers "Resume payment".
- Pass ☐ Fail ☐

## Flow D — Instructor earning on capture

**T-03-14 — External-instructor earning recorded**
- Steps: after T-03-08 (internship 2 is Priya's, external).
- Expected: one `instructor_earnings` row, gross ₹4,392.82, share 70%, **amount ₹3,074.97**, status `pending` (matures after the 7-day refund window).
- Pass ☐ Fail ☐

**T-03-15 — System internship = no earning**
- Steps: a paid capture on internship 3 (system/internal Rahul).
- Expected: **no** earnings row created.
- Pass ☐ Fail ☐

## Flow E — Refund + clawback (needs Admin doc 06 to approve)

**T-03-16 — Request refund**
- Steps: as the buyer, request a refund on the paid order with a reason.
- Expected: 201, status `requested`; appears in admin refund queue.
- Pass ☐ Fail ☐

**T-03-17 — Approve → clawback chain**
- Steps: T4 approves in admin (doc 06).
- Expected (dry-run settles inline): order → `refunded`; enrollment → `suspended`; seat released; the linked earning → `reversed` (shows **negative** in the instructor ledger); audit `refund.approve` written.
- Pass ☐ Fail ☐

**T-03-18 — Invoice download (owner only)**
- Steps: open `/orders/:id/invoice`.
- Expected: signed URL to the PDF; a different user gets 404/forbidden.
- Pass ☐ Fail ☐

---

## Checklist
- ☐ Free enrollment + offer letter; duplicate + waitlist rules
- ☐ Coupon valid + every rule-failure reason
- ☐ GST exact: IGST (inter-state) and CGST/SGST (intra-state), to the paisa
- ☐ Capture → activate → invoice; **idempotent on duplicate webhook**
- ☐ Forged signature 401; amount tamper flagged + audited
- ☐ Failure → retry; abandoned order resumable
- ☐ Earning only for external internships, exact math
- ☐ Refund → suspend + seat release + earning reversal + audit
