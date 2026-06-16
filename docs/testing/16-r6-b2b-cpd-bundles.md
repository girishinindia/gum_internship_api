# 16 — R6: Corporate/B2B, CPD Hours & Bundles

Covers the final R6 release. No new credentials required (Razorpay in dry-run
unless `PAYMENTS_DRY_RUN=false`).

Seed logins (all `Password@123`): `student@gum-demo.in`, `admin@gum-demo.in`,
`priya@gum-demo.in`.

---

## 16.1 Organizations & team seats (B2B)

| # | Step | Expected |
|---|---|---|
| 1 | `POST /orgs/register { name, gstin, billingState, billingEmail }`. | 201; the caller becomes owner + admin member. |
| 2 | `GET /orgs/mine`. | Orgs you own/admin, with seat + member counts. |
| 3 | `POST /orgs/:id/members { email, role }`. | Adds an existing user as member/admin. Unknown email → 404. |
| 4 | `POST /orgs/:id/seats/purchase { seats, unitPrice }`. | 201 with a **B2B GST invoice** (`B2B/<FY>/NNNN`), GST split by billing state (intra-state CGST+SGST, inter-state IGST), and the org's seat pool grows. |
| 5 | `POST /orgs/:id/seats/assign { memberUserId, internshipId }`. | Consumes one seat and enrolls the member (active). `seatsRemaining` returned. No seats left → 409; member already assigned that internship → 409; non-member → 400. |
| 6 | `GET /orgs/:id/team`. | Team dashboard: seatsTotal/Used/Remaining, members with their assigned internships + progress, and the invoice list. |

## 16.2 CPD certified hours

| # | Step | Expected |
|---|---|---|
| 1 | A learner earns a certificate (`certificate.issued`). | A `cpd_entries` row is auto-created: hours = program weeks × 5. |
| 2 | `GET /me/cpd`. | `{ totalHours, entries[] }` with per-internship hours + notes. |
| 3 | Re-issue / re-fire for the same enrollment. | No duplicate — the ledger is idempotent per enrollment. |

## 16.3 Career-track bundles

| # | Step | Expected |
|---|---|---|
| 1 | Admin: `POST /admin/bundles { slug, name, internshipIds[], price }`. | 201; bundle created (active). |
| 2 | `GET /bundles` / `GET /bundles/:slug`. | Catalogue + detail with the included internships. |
| 3 | `POST /bundles/:slug/purchase` on a **free** bundle. | `status:"enrolled"`; the learner is enrolled into every internship in the bundle. |
| 4 | Purchase a **paid** bundle. | `status:"pending_payment"` + `payment{ razorpayOrderId, amount, currency, keyId }`. |
| 5 | `POST /bundles/:slug/confirm { razorpayOrderId, razorpayPaymentId, signature }`. | Signature verified → enrolled into all. In `PAYMENTS_DRY_RUN`, `signature:"dev_ok"`. Bad signature → 401. |

---

### API reference (R6)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/orgs/register` | any user | create an organization |
| GET | `/orgs/mine` | owner/admin | my organizations |
| POST | `/orgs/:id/members` | org admin | add a member by email |
| POST | `/orgs/:id/seats/purchase` | org admin | buy a seat block (B2B GST invoice) |
| POST | `/orgs/:id/seats/assign` | org admin | assign a seat → enrol a member |
| GET | `/orgs/:id/team` | org admin | team dashboard + invoices |
| GET | `/me/cpd` | any user | certified-hours ledger |
| GET | `/bundles` · `/bundles/:slug` | any user | bundle catalogue / detail |
| POST | `/bundles/:slug/purchase` | any user | buy (free→enrol, paid→order) |
| POST | `/bundles/:slug/confirm` | any user | confirm paid bundle → enrol |
| POST | `/admin/bundles` | staff | create a bundle |

**Roadmap complete (R0–R6).** Remaining work is credential-gated only: push
(Firebase), webhook secrets, stipend payouts (RazorpayX), GitHub OAuth + AI
code-review, WhatsApp (WABA), and Open Badges baking. The B2B seat purchase uses
the shared GST helper; wiring it into the full invoice-PDF + Razorpay pipeline is
an optional finance enhancement.
