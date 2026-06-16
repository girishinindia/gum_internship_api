# 08 — Cross-cutting: Security, Performance, Accessibility, Data & Sign-off

**Owner:** T5 · **Apps:** all
**Pre-req:** Everything up. This doc is the safety net — run after 01–07. Reference `internship-api/docs/security-audit-6.3.md` for the fixes these spot-checks confirm.

---

## PART A — Security spot-checks (OWASP + platform)

**T-08-01 — IDOR sweep**
- Steps: as user A, take an id that belongs to user B and call: `GET /enrollments/{B}/certificate/eligibility`, `/enrollments/{B}/attendance`, `/orders/{B}`, `/enrollments/{B}/offer-letter`, a submission/cert download not yours.
- Expected: every one → **403 or 404**, never another user's data.
- Pass ☐ Fail ☐

**T-08-02 — Role escalation**
- Steps: student token on instructor/admin endpoints; instructor on `/admin/*`; finance_admin on `/admin/users/:id/roles`.
- Expected: `FORBIDDEN` each time; super_admin passes.
- Pass ☐ Fail ☐

**T-08-03 — Webhook forgery** — Razorpay webhook with bad/missing signature → `401`; Bunny webhook with secret in `?secret=` (old style) → `401` (must be `x-webhook-secret` header). Pass ☐ Fail ☐

**T-08-04 — Payment tampering** — capture webhook with altered amount → flagged + `audit_logs.payment.amount_mismatch`, order stays unpaid. Pass ☐ Fail ☐

**T-08-05 — Signed-URL replay/expiry** — a playback/file signed URL works within TTL; tamper the token → fails; confirm TTL is short (≤4h video, ≤15m files). Non-enrolled user cannot mint one. Pass ☐ Fail ☐

**T-08-06 — OTP brute force** — 5 wrong codes → exhausted; rate limits hold (doc 01 T-01-04/05). Pass ☐ Fail ☐

**T-08-07 — JWT integrity** — call `/users/me` with an `alg:none` token carrying `roles:["super_admin"]` → `401` (algorithm pinned). Pass ☐ Fail ☐

**T-08-08 — PII exposure**
- Public verify returns only the 7 whitelisted fields (no email/phone/id).
- Instructor profile responses mask bank as `••••NNNN`; full PAN/account never returned.
- API logs: `authorization`, cookies, passwords, tokens are redacted; OTP codes are **not** logged in a prod build.
- Pass ☐ Fail ☐

**T-08-09 — Upload abuse** — wrong folder (role gate), >50 MB (cap), executable mime → rejected; files land in the **private** zone. Pass ☐ Fail ☐

**T-08-10 — Error hygiene** — force a 500 (e.g. malformed input that bypasses zod): response is the envelope with a generic message, **no stack trace**; the `x-request-id` header is present for correlation. Pass ☐ Fail ☐

## PART B — Performance / reliability

**T-08-11 — Catalog read latency** — list/detail respond quickly (subjectively snappy; p95 target <300ms reads). Pass ☐ Fail ☐
**T-08-12 — Pagination bounds** — `?limit=1000` is clamped to ≤100; `?page=99999` returns empty, not an error. Pass ☐ Fail ☐
**T-08-13 — Idempotency under retry** — re-deliver the same webhook several times: still exactly one capture/invoice/earning (doc 03 T-03-09). Pass ☐ Fail ☐
**T-08-14 — Graceful provider failure** — with NOTIFY/PAYMENTS dry-run, core flows never fail because a notification didn't send; failures are logged, not fatal. Pass ☐ Fail ☐
**T-08-15 — Health** — `GET /health` returns the envelope; unknown route → 404 envelope. Pass ☐ Fail ☐

## PART C — Accessibility & UX (web + mobile web)

**T-08-16 — Keyboard navigation** — every interactive element is reachable by Tab with a visible focus ring; modals/sheets trap focus and close on Esc. Pass ☐ Fail ☐
**T-08-17 — Contrast & sizing** — body text ≥ AA contrast; touch targets ≥ 44px on mobile; yellow never carries white text (uses dark text). Pass ☐ Fail ☐
**T-08-18 — Loading/empty/error states** — every async surface shows skeleton (not just spinner) → data, a friendly empty state with a CTA, and a retry on error. Pass ☐ Fail ☐
**T-08-19 — Money formatting** — amounts shown as `₹4,999` (Indian grouping) with GST treatment stated nearby; never raw `4999.00`. Pass ☐ Fail ☐
**T-08-20 — Screen reader smoke** — headings in order; images have alt or are decorative; verify page result is announced. Pass ☐ Fail ☐

## PART D — Data integrity (DB spot-checks)

**T-08-21 — Money columns** are `numeric(10,2)`; sums in ledgers/settlements reconcile to the paisa with no float drift. Pass ☐ Fail ☐
**T-08-22 — No orphans** — every captured payment has exactly one earning (external) or none (system); every issued certificate maps to a completed enrollment. Pass ☐ Fail ☐
**T-08-23 — Audit completeness** — each privileged mutation in docs 06 left an `audit_logs` row (actor, action, before/after). Pass ☐ Fail ☐
**T-08-24 — Reset restores exact sample data** — after a full DB reset + reseed, the deterministic ids in doc 00 §4 are reproduced. Pass ☐ Fail ☐

## PART E — Automated suites (run, attach output)

**T-08-25 — API tests** — `cd internship-api && npm run test:unit` and `DATABASE_URL_TEST=… npm run test:int` → all green (18 integration cases). Attach summary. Pass ☐ Fail ☐
**T-08-26 — Web E2E** — `cd internship-web && npx playwright install chromium && npm run e2e` with API+web up → catalog/auth specs green; note any `fixme` (pending UI). Pass ☐ Fail ☐

---

## Final sign-off (fill at the end of the cycle)

| Area | Doc | Tester | Cases run | Pass | S1 | S2 | S3 | S4 |
|---|---|---|---|---|---|---|---|---|
| Auth | 01 | T1 | | | | | | |
| Catalog | 02 | T1 | | | | | | |
| Commerce | 03 | T2 | | | | | | |
| Learning/Live | 04 | T1 | | | | | | |
| Projects/Quiz/Cert | 05 | T1+T3 | | | | | | |
| Instructor/Admin/Finance | 06 | T3+T4 | | | | | | |
| Mobile+Flutter | 07 | T5 | | | | | | |
| Cross-cutting | 08 | T5 | | | | | | |

**Release recommendation:** ☐ Go ☐ Go with caveats ☐ No-go
**Blockers (S1/S2 open):**
**Sign-off:** ___________________ Date: ___________

---

## Checklist
- ☐ IDOR, role-escalation, webhook-forgery, payment-tamper, signed-URL, OTP, JWT, PII, upload, error-hygiene
- ☐ Performance: latency, pagination clamp, idempotency, graceful failure, health
- ☐ Accessibility: keyboard, contrast/targets, async states, money formatting, screen reader
- ☐ Data: money precision, no orphans, audit completeness, reproducible reseed
- ☐ Automated suites executed and attached
- ☐ Sign-off table completed
