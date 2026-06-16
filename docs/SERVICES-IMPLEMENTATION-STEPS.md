# GI Internship — Services Implementation Steps

> How we'll work: I implement **one phase at a time, step by step**, only when you say **"proceed to R{n}"** (whole phase) or **"proceed to R{n} step {k}"** (single step).
> Every step is an atomic unit: build → verify (tsc/jest + live check on the real `intern` Supabase) → commit. New migrations continue from `0008`. Nothing is built until you give the go.
>
> Legend: ▶️ I can do now · 🔑 needs a credential/account from you first · 👤 needs an external signup.

---

## R0 — Enablers (do first; unblocks later phases)

| Step | Title | Action | Verify |
|---|---|---|---|
| **R0-S1** ▶️ | Enable pgvector | `create extension vector` in the Supabase project | query `pg_extension` shows `vector` |
| **R0-S2** 🔑 | FCM push sender | Implement FCM HTTP v1 sender + token pruning (needs FCM **service-account JSON**) | send a test push / dry-log |
| **R0-S3** ▶️ | Queue worker + pg_cron | Stand up the Upstash queue worker + a pg_cron tick (reminders/digests) | a scheduled job runs & logs |
| **R0-S4** 🔑 | Webhook secrets | Set Razorpay + Bunny-Stream webhook secrets in `.env` (from dashboards) | signed webhook verifies |
| **R0-S5** 🔑 | RazorpayX payouts | Payout account + student bank-KYC capture fields | test payout in sandbox |
| **R0-S6** 👤 | GitHub OAuth app | Client id/secret for repo verify + code-review | OAuth round-trip |
| **R0-S7** 👤 | WhatsApp (WABA) | Gupshup/Meta account + approved templates | template send |
| **R0-S8** 👤 | LinkedIn + Open Badges | LinkedIn app + badge issuer keys | add-to-profile link works |

> I can start **R0-S1 and R0-S3 immediately**. The rest need you to hand me the credential/account when its phase comes up.

---

## R1 — Quick wins (student trust & retention)  — ✅ DONE (S6 deferred)

| Step | Title | Builds | Status |
|---|---|---|---|
| **R1-S1** | Migration `0008_portfolio.sql` | `portfolios` (handle, headline, visibility, links) + scholarship coupon columns | ✅ applied to live `intern` |
| **R1-S2** | Portfolio aggregation service | `portfolio` module: completed internships, project scores, certificates, stats | ✅ |
| **R1-S3** | Resume PDF | pdfkit resume + `GET /users/me/resume` (signed Bunny URL) | ✅ verified live |
| **R1-S4** | Public credential wallet | API `GET /p/:handle` (privacy-aware) + web `/u/[handle]` + `/my/portfolio` editor | ✅ verified live |
| **R1-S5** | Scholarships | `kind`+`assigned_user_id` on coupons; `POST /admin/scholarships`; redemption guard | ✅ verified live |
| **R1-S6** | Push live | wire FCM into notifications for key events (needs R0-S2 creds) | ⏸️ DEFERRED — awaiting Firebase service-account JSON |
| **R1-S7** | Verify + commit | tsc/jest + live check on intern DB; tester doc `11` | ✅ |

---

## R2 — AI layer (keys in `.env`; pgvector enabled)  — ✅ DONE (S7 deferred)

| Step | Title | Builds | Status |
|---|---|---|---|
| **R2-S1** | Migration `0009_ai.sql` | `lesson_embeddings(vector 1536, HNSW)`, `ai_threads`, `ai_messages`, `ai_usage`, `ai_interview_attempts`, `lesson_translations` | ✅ applied to live `intern` |
| **R2-S2** | Embedding pipeline | `ai/embeddings.ts`: chunk lessons → embed (hash-skip unchanged) → store; `POST /admin/ai/reindex` | ✅ verified live |
| **R2-S3** | AI client wrapper | `services/ai/*`: Anthropic chat (+OpenAI fallback), OpenAI embeddings, PII strip, injection defang, per-user daily $ cap; safe dry-run | ✅ |
| **R2-S4** | Study-buddy | `POST /ai/ask` — RAG over lesson vectors + grounded answer + citations; threads/messages | ✅ verified live |
| **R2-S5** | Mock interview | `POST /ai/interview`, `/ai/interview/:id/answer` — 5 Qs + scored feedback, attempt storage | ✅ verified live |
| **R2-S6** | Lesson translation | `POST /ai/translate` — Hindi/Gujarati via `languages[]`, cached by source hash | ✅ verified live |
| **R2-S7** | Code-review assist (stretch) | rubric pre-fill from GitHub submission | ⏸️ DEFERRED — needs R0-S6 GitHub OAuth |
| **R2-S8** | Verify + commit | tsc + jest (guardrail/pricing/chunk/dry-run) + live cost-cap check; tester doc `12` | ✅ |

---

## R3 — Engagement & reach  — ✅ DONE (S4 + Open Badges deferred)

| Step | Title | Builds | Status |
|---|---|---|---|
| **R3-S1** | Migration `0010_gamification.sql` | `xp_events` (idempotent), `badges` (+6 seeded), `user_badges`, `streaks`; forum in `0011` | ✅ applied to live `intern` |
| **R3-S2** | Gamification service | event-bus subscribers (lesson/task/certificate) award XP + badges + daily streak; `GET /me/xp`, `/me/badges`, `/leaderboard` | ✅ verified live |
| **R3-S3** | Forum (migration `0011`) | `forum_threads`/`forum_replies`, threads/replies/accept-answer + instructor-badge, staff pin/lock/delete moderation | ✅ verified live |
| **R3-S4** | WhatsApp channel | provider + DLT-style template registry | ⏸️ DEFERRED — needs R0-S7 WhatsApp WABA |
| **R3-S5** | Open Badges + LinkedIn | LinkedIn "Add to profile" link on certificates ✅ (no creds); Open Badges baking ⏸️ DEFERRED (needs R0-S8 issuer key) | ◑ partial |
| **R3-S6** | Verify + commit | tsc + jest (levels + LinkedIn URL) + live check (XP/badge/streak/forum/leaderboard); tester doc `13` | ✅ |

---

## R4 — Mentorship & assessment  — ✅ DONE

| Step | Title | Builds | Status |
|---|---|---|---|
| **R4-S1** | Migration `0012_mentorship.sql` | `mentor_availability`, `mentor_bookings`, `assessment_questions` (+11 seeded), `assessment_attempts` | ✅ applied to live `intern` |
| **R4-S2** | Booking service | mentor slots; student books (race-safe slot claim); free/included → confirm + Zoom meeting; paid → Razorpay order + signed `/confirm`; cancel + listings | ✅ verified live |
| **R4-S3** | Assessment/readiness | self-contained diagnostic per track (no answer-key leak), server-side scoring → readiness band + internship recommendations | ✅ verified live |
| **R4-S4** | Verify + commit | tsc + jest + live check (free/paid booking, signature reject, double-book guard, scoring); tester doc `14` | ✅ |

---

## R5 — Career outcomes (flagship)  — ✅ DONE (stipend payouts deferred)

| Step | Title | Builds | Status |
|---|---|---|---|
| **R5-S1** | Migration `0013_jobs.sql` | `employer` role_name enum value; `employers`, `jobs`, `job_applications` | ✅ applied to live `intern` |
| **R5-S2** | Employer onboarding | self-service register (company + contact + gstin), grants employer role, accept-agreement + submit for verification | ✅ verified live |
| **R5-S3** | Job board | job CRUD (draft→pending_review→published), public board + filters, apply-with-portfolio (auto-attaches handle + resume), dup-application guard | ✅ verified live |
| **R5-S4** | Employer dashboard + moderation | employer applicant pipeline (shortlist/interview/offer/reject); admin verifies employers + publishes/rejects jobs | ✅ verified live |
| **R5-S5** | Stipend payouts | student payees + RazorpayX + TDS | ⏸️ DEFERRED — needs R0-S5 RazorpayX |
| **R5-S6** | Verify + commit | tsc + jest + live check (onboarding, publish gate, apply, moderation, dup-guard); tester doc `15` | ✅ |

---

## R6 — Professional & B2B  — ✅ DONE

| Step | Title | Builds | Status |
|---|---|---|---|
| **R6-S1** | Migration `0014_orgs.sql` | `organizations`, `org_members`, `org_seats`, `org_seat_orders` (B2B GST), `cpd_entries`, `bundles` | ✅ applied to live `intern` |
| **R6-S2** | Org onboarding + teams | register org, add members, purchase seat block (GST via shared helper + `B2B/…` invoice), assign seat → enroll member, team dashboard | ✅ verified live |
| **R6-S3** | CPD hours | `cpd_entries` ledger; auto-award on `certificate.issued` (event subscriber, idempotent per enrollment); `GET /me/cpd` | ✅ verified live |
| **R6-S4** | Subscriptions / bundles | bundle catalogue (admin); public listing; purchase — free enrolls into all, paid via Razorpay order + signed `/confirm` | ✅ verified live |
| **R6-S5** | Verify + commit | tsc + jest + live check (bundles free/paid, B2B GST invoice, seat assign, CPD award + idempotency); tester doc `16` | ✅ |

> **Roadmap R0–R6 complete.** Deferred items (credential-gated): push (R0-S2/R1-S6,
> Firebase) · webhook secrets (R0-S4) · stipend payouts/RazorpayX (R0-S5/R5-S5) ·
> GitHub OAuth + AI code-review (R0-S6/R2-S7) · WhatsApp (R0-S7/R3-S4) ·
> Open Badges baking (R0-S8/part of R3-S5).

---

## How each step runs (the contract)
1. You say **"proceed to R{n}"** or **"proceed to R{n} step {k}"**.
2. I implement only that scope, against the real `intern` schema where relevant.
3. I verify live (tsc + jest + a real DB/endpoint check), clean any test rows, and commit.
4. I report what changed in 2–3 lines and wait for the next "proceed".

**Ready to start:** R0-S1 (pgvector) and R0-S3 (queue/cron) need nothing from you. For R0-S2/S4/S5/S6/S7/S8 I'll ask you for the specific credential when we reach them.
