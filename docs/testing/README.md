# GUM Internships — Tester Documentation

Read in order. **Everyone starts with 00.**

| # | Document | Primary tester(s) |
|---|---|---|
| 00 | [Master Test Plan & Setup](./00-master-test-plan.md) — environment, sample data, tester assignments, bug template | ALL |
| 01 | [Auth & Onboarding](./01-auth-onboarding.md) | T1, T2 |
| 02 | [Catalog & Discovery](./02-catalog-discovery.md) | T1 |
| 03 | [Enrollment, Payments, Coupons, Invoices, Refunds](./03-commerce-payments.md) | T2 |
| 04 | [Learning, Live Sessions & Media](./04-learning-live-media.md) | T1 |
| 05 | [Projects, Quizzes & Certificates](./05-projects-quizzes-certificates.md) | T1, T3 |
| 06 | [Instructor, Admin, Moderation & Finance](./06-instructor-admin-finance.md) | T3, T4 |
| 07 | [Mobile Web (auto in :3000) & Flutter App](./07-mobile-web-and-flutter.md) | T5, T1 |
| 08 | [Cross-cutting: Security, Performance, A11y & Sign-off](./08-cross-cutting-and-bug-template.md) | T5 |
| 09 | [Test-Run Tracker](./09-test-run-tracker.html) — printable one-page grid of all 162 cases (open in a browser → Print → A4) | ALL |
| 10 | [Smoke Test — Happy Path in 15 min](./10-smoke-test-15min.md) — fast go/no-go before the full suite | ALL (first) |

### Expansion suite — services roadmap R0–R6

These cover the post-core phases. The platform ships with `AI_DRY_RUN=true` and
`PAYMENTS_DRY_RUN=true` so the whole suite runs free and deterministic.

| # | Document | Phase |
|---|---|---|
| 17 | [R0 Enablers — Infrastructure Verification](./17-r0-enablers-verification.md) — pgvector, pg_cron, queue, FCM-inert | R0 |
| 11 | [Portfolio, Credential Wallet, Resume & Scholarships](./11-r1-portfolio-scholarships.md) | R1 |
| 12 | [AI Layer — study-buddy (RAG), mock interview, translation](./12-r2-ai-layer.md) | R2 |
| 13 | [Gamification, Forum & Portable Credentials](./13-r3-gamification-forum.md) | R3 |
| 14 | [Mentorship Booking & Skill Assessment](./14-r4-mentorship-assessment.md) | R4 |
| 15 | [Job Board, Employer Portal & Applications](./15-r5-jobs-employers.md) | R5 |
| 16 | [Corporate/B2B, CPD Hours & Bundles](./16-r6-b2b-cpd-bundles.md) | R6 |
| 18 | [Expansion Smoke Test — R1–R6 happy path (~20 min)](./18-expansion-smoke-test.md) | R1–R6 |
| 19 | [Expansion Test-Run Tracker](./19-expansion-test-run-tracker.html) — printable R0–R6 grid (open in browser → Print → A4) | ALL |

## Suggested order of use
1. **Doc 00** — set up the environment.
2. **Doc 10** — run the 15-minute core smoke test. If it hits a STOP, fix before going further.
3. **Docs 01–08** — full per-area core testing; print **Doc 09** as your tick-sheet.
4. **Doc 17** — confirm R0 enablers are live (operator).
5. **Doc 18** — run the expansion smoke test. If it hits a STOP, fix before deep-testing that phase.
6. **Docs 11–16** — full per-phase expansion testing; print **Doc 19** as your tick-sheet.

## The 5 testers at a glance
- **T1 — Student journeys:** 01, 02, 04, 07 (mobile web)
- **T2 — Commerce:** 01, 03
- **T3 — Instructor & content:** 05, 06 (instructor)
- **T4 — Admin & finance:** 06 (admin/finance)
- **T5 — Cross-cutting & mobile:** 07, 08

## Ground rules
1. Do the setup in 00 §3 before anything else; OTP codes and payments are in **dry-run** (no real email/money).
2. Run cases top-to-bottom — later cases depend on earlier state.
3. Log every failure with the bug template (00 §6) and a severity.
4. Verify the money math (00 §4.4) **to the paisa**.
5. The hard compliance gate: **no in-app payment** on mobile web or Flutter (07).
6. Fill the sign-off table in 08 at the end.
