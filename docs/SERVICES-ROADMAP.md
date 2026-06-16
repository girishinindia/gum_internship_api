# GI Internship — Services Roadmap (post-core)

> The core platform (Phases 0–6) is built & live: discover → enroll → learn (video/live) → weekly projects → mentor rubric review → quizzes → verifiable certificate → GST payments → instructor payouts, across web (desktop+mobile), admin portal, Flutter, on a live Supabase `intern` schema with Bunny, Brevo, SMS-DLT and Razorpay wired.
>
> This roadmap lists every **additional** service worth adding, in dependency + impact order, grouped into release phases **R0–R6**. Each item is tagged: audience (🎓 student · 💼 professional · 👥 both) and effort (S ≤ days · M ≈ 1–2 wks · L ≈ 3–6 wks).

---

## R0 — Enablers (do first; mostly config/integration, unblocks later phases)

| # | Enabler | Effort | Unblocks |
|---|---|---|---|
| 0.1 | **Enable `pgvector`** on Supabase (`create extension vector`) | S | All AI/RAG features (R2) |
| 0.2 | **Finish FCM push sender** (service account → HTTP v1); device tokens already captured | S | Push notifications (R1) |
| 0.3 | **Confirm Upstash queue worker + pg_cron jobs** (both already provisioned/installed) | S | Async embeddings, digests, payout/reminder runs |
| 0.4 | **Set webhook secrets** (Razorpay + Bunny Stream) from dashboards | S | Reliable payment + encode callbacks |
| 0.5 | **RazorpayX payout account** + student bank-KYC capture | M | Stipend internships (R5) |
| 0.6 | **GitHub OAuth app** | S | Repo verification + AI code-review (R2/R4) |
| 0.7 | **WhatsApp provider** (Gupshup / Meta WABA) + template approval | M | WhatsApp alerts (R3) |
| 0.8 | **LinkedIn app + Open Badges issuer** | S | Portable credentials (R3) |

**What we already have (head start):** Anthropic + OpenAI + Google AI keys (in `.env`), pg_cron installed, Upstash Redis, stipend pricing in schema, coupon engine, event bus, Zoom provider, Bunny media, GST invoicing, certificates, notification service + DLT SMS.

---

## R1 — Quick wins: student trust & retention (≈1–2 weeks)

**Goal:** raise completion + shareability with parts we already own.

| Service | Who | Effort | Needs |
|---|---|---|---|
| **Resume / portfolio auto-builder** — PDF + web page generated from completed internships, projects, scores, certs | 👥 | S | pdfkit (have); 1 `portfolios` prefs table; export route |
| **Public credential wallet** — shareable profile of verified certs + project links (extends `/verify`) | 👥 | S | public profile route; privacy toggles |
| **Scholarships & student coupons** — need-based / merit discounts | 🎓 | S | coupon engine (have); eligibility rule |
| **Push notifications live** (enrollment, review, live reminders, certificate) | 👥 | S | R0.2 FCM sender |

**Compliance:** DPDP — explicit consent + visibility controls on the public profile.
**Success metric:** completion rate ↑, certificate-share rate, push opt-in %.

---

## R2 — AI layer (keys already provisioned) (≈2–3 weeks)

**Goal:** differentiators that are unusually cheap because the AI keys ship in `.env`.

| Service | Who | Effort | Needs |
|---|---|---|---|
| **AI study-buddy / doubt-solver (RAG)** — answers grounded in the learner's lesson content | 👥 | M | R0.1 pgvector; `lesson_embeddings` table; embedding job (queue); LLM call + guardrails; cost cap |
| **AI mock interview & feedback** — track-specific practice with scored, rubric-style feedback | 👥 | M | LLM (have); question bank; attempt + score storage |
| **AI lesson translation → Hindi / Gujarati** — auto-translate content; `languages[]` already exists | 🎓 | M | Google/AI keys (have); translation pipeline + human QA toggle |
| **AI code-review assist for mentors** — pre-fills the rubric from a GitHub submission | 💼 | M | R0.6 GitHub API; LLM; mentor still confirms (assist, not auto-grade) |

**Compliance/guardrails:** prompt-injection limits, no PII to models, per-user usage caps, "AI-assisted" labelling on mentor reviews.
**Success metric:** doubts resolved in-app, interview-practice usage, non-English enrollments.

---

## R3 — Engagement & reach (≈2–3 weeks)

**Goal:** habit + community + portable proof.

| Service | Who | Effort | Needs |
|---|---|---|---|
| **Gamification** — streaks, XP, badges, cohort leaderboard | 👥 | M | event bus (have); `xp_events`, `badges`, `streaks` tables |
| **Doubt forum / cohort community** — threaded Q&A with instructor badges | 👥 | M | `forum_threads`/`replies`; moderation in admin |
| **WhatsApp notifications** — reminders, results, payment receipts | 👥 | M | R0.7 WABA + approved templates |
| **Open Badges + LinkedIn "add to profile"** — make certs portable | 👥 | S | R0.8; badge baking |

**Compliance:** WABA opt-in + DLT-style template approval; community moderation policy.
**Success metric:** D7/D30 retention, forum activity, badge adds to LinkedIn.

---

## R4 — Mentorship & assessment (≈2–3 weeks)

**Goal:** personalised guidance + placement readiness.

| Service | Who | Effort | Needs |
|---|---|---|---|
| **1:1 mentorship booking** — paid or included slots with mentors | 👥 | M | `mentor_availability`/`bookings`; Zoom (have); payments (have) |
| **Skill assessment / placement-readiness score** — diagnostic + recommended internships | 🎓 | M | quiz engine (have); scoring rules; recommendation logic |
| **Mock tests / timed assessments** | 🎓 | S | quiz engine (have) |

**Success metric:** mentorship bookings, assessment completion → enrollment conversion.

---

## R5 — Career outcomes (flagship) (≈4–6 weeks)

**Goal:** close the loop to a job and pay learners.

| Service | Who | Effort | Needs |
|---|---|---|---|
| **Job board + employer portal** — employers post roles; learners apply with their GI portfolio | 👥 | L | `employers`, `jobs`, `applications` tables; employer role + onboarding/KYC; employer dashboard; moderation |
| **Hiring-partner referrals** — surface top performers to partner companies | 💼 | M | outcome data (have); consent; partner pipeline |
| **Stipend-paid internships** — pay students (schema already supports `stipend`) | 🎓 | M | R0.5 RazorpayX + bank-KYC; TDS handling; payout ledger (extend earnings) |

**Compliance:** TDS/202-O on stipends; employer verification; DPDP for sharing learner profiles with employers (opt-in).
**Success metric:** applications, interviews, placements, stipend disbursed.

---

## R6 — Professional & B2B scale (≈4–6 weeks)

**Goal:** monetise professionals + organisations.

| Service | Who | Effort | Needs |
|---|---|---|---|
| **Corporate / team upskilling** — orgs buy bulk seats, assign learners, track teams | 💼 | L | `organizations`, `org_members`, seat allocation; team dashboards; B2B GST invoice variant (have GST base) |
| **CPD / certified-hours tracking** — log learning hours for professional bodies | 💼 | S | hours ledger on enrollments |
| **Career-track subscriptions / bundles** — multi-internship paths at a bundle price | 👥 | M | bundle pricing; Razorpay subscriptions (or prepaid credits) |

**Compliance:** B2B GST (reverse-charge edge cases), org admin RBAC.
**Success metric:** B2B contract value, seats utilised, subscription MRR.

---

## Cross-cutting (run alongside every phase)

- **Analytics dashboards** — learner progress, funnel, completion, employer outcomes, AI usage/cost.
- **Compliance** — DPDP (consent, deletion, data-sharing), TDS on payouts, WABA/DLT, AI data handling.
- **Reliability** — finish queue worker + pg_cron jobs, retries/dead-letter (notification_failures exists), observability/alerting.
- **Supply-side (non-technical)** — recruit mentors, sign employer/hiring partners, translation QA reviewers.

---

## Consolidated "what we need" master checklist

**Integrations & keys**
- [x] AI: Anthropic + OpenAI + Google (in `.env`)
- [ ] pgvector enabled on Supabase
- [ ] RazorpayX payout account (+ student bank-KYC)
- [ ] GitHub OAuth app · [ ] LinkedIn app · [ ] Open Badges issuer
- [ ] WhatsApp Business (Gupshup/Meta) + approved templates
- [ ] FCM service account finalised
- [ ] Razorpay + Bunny webhook secrets set

**Database (new tables, all in `intern` schema)**
portfolios · forum_threads/forum_replies · xp_events/badges/user_badges/streaks · mentor_availability/mentor_bookings · lesson_embeddings (vector) · employers/jobs/job_applications · organizations/org_members/team_seats · cpd_hours · subscriptions/bundles.

**Infra:** Upstash queue worker (embeddings, notifications) · pg_cron schedules (digests, reminders, stipend/payout runs) · LLM cost guardrails.

**Compliance:** DPDP consent + account deletion + profile/employer data-sharing opt-in · TDS on stipends/payouts · WABA + DLT template approval · AI prompt/PII guardrails · B2B GST variants.

**People/ops:** mentor recruitment · employer & hiring-partner partnerships · content translation QA.

---

## Suggested build order (one-line)
**R0 enablers → R1 quick wins → R2 AI → R3 engagement → R4 mentorship → R5 job board + stipends → R6 corporate/B2B**, with analytics + compliance running throughout. R1 and the R0 enablers can start immediately; R2 unlocks the moment pgvector is enabled.
