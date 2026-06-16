# 18 — Expansion Smoke Test: R1–R6 Happy Path (~20 min)

A fast go/no-go across the six expansion phases, mirroring doc 10 for the core.
If any **STOP** fails, halt and report — deep-test that area (docs 11–16) only
once the smoke passes.

**Pre-req:** API running on the live `intern` DB (or local), seed data present.
Keep `AI_DRY_RUN=true` and `PAYMENTS_DRY_RUN=true` for a free, deterministic run.
Have tokens for **student** (`student@gum-demo.in`), **instructor/mentor**
(`priya@gum-demo.in`) and **admin** (`admin@gum-demo.in`) — all `Password@123`.

> Tick as you go. Time budget in brackets. Paths are under `/v1`.

---

## A. R1 — Portfolio, wallet, scholarships (4 min)
1. ☐ `PUT /users/me/portfolio` (student) with a handle + `visibility:"public"` → 200, returns a `publicUrl`.
2. ☐ `GET /p/<handle>` logged-out → profile renders with stats. Set `visibility:"private"`, refetch → **404**. **[STOP if a private profile is publicly visible]**
3. ☐ `GET /users/me/resume` → a signed PDF URL.
4. ☐ Admin `POST /admin/scholarships { userId, discountType:"percent", discountValue:50 }` → `SCH-…` code. As that student `POST /coupons/validate` → valid; as **another** user → "not assigned to your account". **[STOP if a scholarship is redeemable by the wrong user]**

## B. R2 — AI layer (4 min)
5. ☐ Admin `POST /admin/ai/reindex { internshipId:1 }` → `{queued:true}`; log shows `embedding index complete`.
6. ☐ Enrolled student `POST /ai/ask { internshipId:1, question }` → `answer`, `citations[]`, `grounded:true`, a `threadId`.
7. ☐ Ask with an "ignore all previous instructions…" payload → response `flagged:true` and behaviour unchanged. **[STOP if the injection changes the system behaviour]**
8. ☐ Drive a user over `AI_DAILY_COST_CAP_USD` (seed an `ai_usage` row) → next `/ai/ask` returns **429 `AI_CAP_EXCEEDED`**. **[STOP if the cap doesn't stop spend]**
9. ☐ `POST /ai/interview` → Q1; `…/answer` ×5 → final `score`. `POST /ai/translate { lessonId, language:"hindi" }` → translated title/body.

## C. R3 — Gamification & forum (3 min)
10. ☐ Complete a lesson (`POST /lessons/:id/progress {completed:true}`) → `GET /me/xp` shows XP ↑, `first_steps` badge, streak 1.
11. ☐ Re-complete the same lesson → XP **unchanged** (idempotent). 
12. ☐ Student creates a forum thread; instructor replies (`isInstructor:true`); student accepts → thread `isResolved`.
13. ☐ Admin pins+locks the thread → student reply blocked **409**; `GET /leaderboard` ranks users by XP.

## D. R4 — Mentorship & assessment (4 min)
14. ☐ Mentor `POST /mentorship/slots` (free) + (paid ₹500). Student `GET /mentorship/slots` shows both.
15. ☐ Student books the **free** slot → `confirmed` + `joinUrl`. Book the **paid** slot → `pending_payment` + order; `…/confirm` with a bad signature → **401**, with `dev_ok` → `confirmed`. **[STOP if a bad signature confirms a paid booking]**
16. ☐ Book an already-booked slot → **409**.
17. ☐ `GET /assessment/web` → questions with **no answer key**; `POST /assessment/submit` (all correct) → `score:100`, `readiness:"ready"`, recommendations. **[STOP if the answer key leaks in the diagnostic payload]**

## E. R5 — Job board & employers (3 min)
18. ☐ Register employer; create a draft job; `…/submit` **before** verification → **409**.
19. ☐ Admin verifies the employer → submit job → admin publishes → it appears on `GET /jobs`.
20. ☐ Student `POST /jobs/:id/apply` → `applied` (portfolio handle + resume auto-attached); apply again → **409**. Employer shortlists → student sees `shortlisted`. **[STOP if a duplicate application is accepted]**

## F. R6 — B2B, CPD, bundles (2 min)
21. ☐ Admin creates a free bundle (2 internships) → student `POST /bundles/:slug/purchase` → `enrolled` into both. Paid bundle → order → `…/confirm` (`dev_ok`) → enrolled.
22. ☐ Register an org (billing **Maharashtra**); `…/seats/purchase {seats:5, unitPrice:1000}` → **B2B GST invoice** `B2B/<FY>/NNNN` with **IGST** (inter-state). **[STOP if GST is miscomputed]**
23. ☐ Add a member, `…/seats/assign` → member enrolled, `seatsRemaining` ↓; `GET /orgs/:id/team` shows the assignment.
24. ☐ Issue a certificate → `GET /me/cpd` shows hours (weeks × 5); re-issue → **no duplicate**.

---

### Go / No-go
All ticked and no **STOP** triggered → green-light the full expansion suite
(docs 11–16). Any STOP → file a bug (00 §6) and fix before deep-testing that phase.

**Cleanup:** if run against the live `intern` DB, delete the synthetic rows
afterward (portfolios, scholarship coupons, ai_*, forum_*, xp_*, user_badges,
streaks, mentor_*, assessment_attempts, employers/jobs/job_applications,
organizations/org_*, bundles, cpd_entries, and any test enrollments).
