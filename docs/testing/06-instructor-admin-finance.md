# 06 — Instructor Portal, Admin, Moderation & Finance

**Owner:** T3 (instructor) + T4 (admin/finance) · **Apps:** Web :3000 (/instructor), Admin :3100
**Pre-req:** Admin portal up. Logins: `priya@gum-demo.in` (instructor), `admin@gum-demo.in` (super_admin). For role-scoped checks, T4 may also create finance_admin/moderator/support users via super_admin role grant.

---

## PART 1 — Instructor portal (Web :3000/instructor) — T3

**T-06-01 — Instructor dashboard** loads (earnings summary, pending reviews count, upcoming live). Non-instructor visiting `/instructor` → redirected to `/my`. Pass ☐ Fail ☐
**T-06-02 — Review queue** — see doc 05 Flow B (rubric scoring UI, approve/resubmit). Pass ☐ Fail ☐
**T-06-03 — Batch manager** — create a batch on own internship; edit seats (cannot set below seats already filled → `CONFLICT`); list students with progress/attendance. Pass ☐ Fail ☐
**T-06-04 — Live scheduler** — see doc 04 Flow D. Pass ☐ Fail ☐
**T-06-05 — Earnings ledger** — summary (pending/available/settled/reversed/lifetime) + 12-month grouping; reversed entries show **negative**. Pass ☐ Fail ☐
**T-06-06 — Payout statements** — open a settlement → statement PDF (signed URL). Pass ☐ Fail ☐
**T-06-07 — Ownership** — instructor cannot manage another instructor's internship/batch/review (403/404). Pass ☐ Fail ☐

> Note: the full internship **builder** (curriculum/video/quiz editors) depends on the backend authoring CRUD session which is still pending — mark its sub-cases **blocked/N-A** until that ships.

## PART 2 — Admin RBAC & navigation — T4

**T-06-08 — Staff-only login**
- Steps: try to log in to :3100 as `student@gum-demo.in`.
- Expected: `403` "staff accounts only" — student cannot enter the admin portal.
- Pass ☐ Fail ☐

**T-06-09 — RBAC nav filtering**
- Steps: log in as different roles (grant test users moderator / finance_admin / support).
- Expected: sidebar shows only that role's sections (moderator → KYC/internships/CMS/audit; finance_admin → orders/refunds/settlements; support → tickets/users). super_admin sees all. Role badge shown in topbar.
- Pass ☐ Fail ☐

**T-06-10 — Audit affordance** — confirm dialogs show "this action is logged"; topbar carries the audit notice. Pass ☐ Fail ☐

**T-06-11 — DataTable mechanics** — server pagination (page ←/→), column sort, filter inputs, CSV export button present on Users. Pass ☐ Fail ☐

## PART 3 — Moderation — T4

**T-06-12 — Instructor KYC queue**
- Pre: a `submitted` application exists (doc 01 T-01-13, or fixture).
- Steps: open KYC queue → review documents/bank-last4/expertise → **Approve**.
- Expected: applicant gains `instructor` role; agreement marked sent; revenue share set (default 70%, editable); audit `kyc.approved` written.
- Pass ☐ Fail ☐

**T-06-13 — KYC reject with reason template** → status `rejected` + reason; applicant may re-apply. Pass ☐ Fail ☐

**T-06-14 — Internship moderation** — a `pending_review` internship → preview → Approve (→ `published`, public) or Reject (reason required). Audit written. Pass ☐ Fail ☐

**T-06-15 — CMS** — create a banner (home_hero) → appears in public `/catalog/banners`; create page `refund-policy` (published) → visible at `/pages/refund-policy`. Pass ☐ Fail ☐

## PART 4 — Users & enrollment ops — T4

**T-06-16 — User search + filters** (q / role / status). Pass ☐ Fail ☐
**T-06-17 — Suspend → sessions revoked** — suspend a user; confirm their active sessions are revoked (they're logged out on next call); restore works. Audit written. Pass ☐ Fail ☐
**T-06-18 — Role grant/revoke is super_admin-only** — finance_admin/moderator attempting `/admin/users/:id/roles` → `403`. Pass ☐ Fail ☐
**T-06-19 — Manual enroll** (support/moderator) — comp a learner into a batch; audited. Pass ☐ Fail ☐
**T-06-20 — Batch transfer** — move an enrollment to another batch of the same internship; seat math adjusts; cross-internship transfer rejected; audit `enrollment.transfer`. Pass ☐ Fail ☐
**T-06-21 — CSV export streams** — Users export downloads a CSV; a name beginning with `=`/`+`/`-`/`@` is prefixed with `'` (formula-injection guard). Pass ☐ Fail ☐

## PART 5 — Finance — T4

**T-06-22 — Orders explorer** (filter status/date/internship). Pass ☐ Fail ☐
**T-06-23 — Refund queue + decision** — approve/reject a refund (see doc 03 Flow E for the downstream chain). Reject requires reason. Pass ☐ Fail ☐
**T-06-24 — Settlement run**
- Steps: create a settlement for Priya (profile 3) for the period covering a captured+matured earning.
- Expected: groups available earnings → settlement `draft` with gross, TDS (config %), payable. Move `draft→approved`; then `approved→paid` **requires a UTR** (paid without UTR rejected). Linked earnings → `settled`. Audit at each step.
- Pass ☐ Fail ☐
**T-06-25 — Double-decision race** — two approvals of the same refund: second is a no-op (only `requested` rows transition). Pass ☐ Fail ☐

## PART 6 — Dashboard & audit — T4

**T-06-26 — Dashboard stats** — today/7d/30d signups, enrollments, revenue; completion rate; pending counters (KYC, reviews, refunds, tickets) **deep-link** to their queues. Pass ☐ Fail ☐
**T-06-27 — Audit log search** — filter by action (e.g. `kyc`, `refund`, `settlement`); rows carry actor, entity, before/after. Pass ☐ Fail ☐
**T-06-28 — Support tickets** — user raises a ticket (`/tickets`); staff sees it in the queue, assigns, replies (thread), resolves with note → requester notified; status transitions audited. Pass ☐ Fail ☐

---

## Checklist
- ☐ Instructor: dashboard, review queue, batches, earnings, statements, ownership guard
- ☐ Admin: staff-only login, RBAC nav per role, audit affordance, DataTable mechanics
- ☐ Moderation: KYC approve/reject (role grant + audit), internship publish/reject, CMS
- ☐ Users/ops: search, suspend+session-revoke, super_admin-only roles, manual enroll, transfer, CSV (injection-safe)
- ☐ Finance: orders, refunds, settlement draft→approved→paid(+UTR), double-decision guard
- ☐ Dashboard counters deep-link; audit search; ticket thread end-to-end
