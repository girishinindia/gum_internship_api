# Security Audit — Phase 6.3 (2026-06-12)

Scope: internship-api against OWASP Top 10 + platform threats (signed-URL leakage/replay, webhook forgery, IDOR, role escalation, upload abuse, OTP brute force, payment tampering, PII exposure). HIGH findings are FIXED in this commit (SEC-IDs referenced in code comments).

## Findings

| ID | Sev | File | Issue | Fix |
|---|---|---|---|---|
| SEC-01 | **HIGH** | certificates/routes.ts | IDOR: `GET /enrollments/:id/certificate/eligibility` had no ownership check — any logged-in user could probe any learner's progress/scores/attendance | ✅ Fixed: owner-or-staff check, 404 otherwise |
| SEC-02 | **HIGH** | live/routes.ts | IDOR: `GET /enrollments/:id/attendance` leaked attendance % of arbitrary enrollments | ✅ Fixed: owner-or-staff check |
| SEC-03 | **HIGH** | media/routes.ts | Bunny webhook secret in `?secret=` query string — query strings persist in access logs, proxies, pino req.url | ✅ Fixed: moved to `x-webhook-secret` header (configure in Bunny accordingly) |
| SEC-04 | **HIGH** | payments/service.ts | Payment amount tampering was log-only — finance had no durable signal of mismatch attempts | ✅ Fixed: `payment.amount_mismatch` audit row with expected/received paise |
| SEC-05 | **HIGH** | middlewares/auth.ts | `jwt.verify` without pinned algorithms (library defaults) | ✅ Fixed: `algorithms: ['HS256']` |
| SEC-06 | **HIGH** | services/notify/index.ts | NOTIFY_DRY_RUN=true in prod would log raw OTP codes | ✅ Fixed: codes echoed only when `!isProd`, regardless of dry-run flag |
| SEC-07 | MED→fixed | admin/service.ts | CSV formula injection (`=cmd()` in names) in exports opened in Excel/Sheets | ✅ Fixed: `'` prefix on `= + - @` cells |
| SEC-08 | MED→fixed | payments/repository.ts | Refund decision check-then-act race: two admins could double-decide | ✅ Fixed: decision UPDATE claims only `status='requested'` rows |
| SEC-09 | MED | media/service.ts | Upload MIME **blocklist** (executables) is weaker than an allowlist | Recommend per-folder allowlists (resumes: pdf/doc; submissions: pdf/zip/png/mp4) — schedule with media hardening |
| SEC-10 | MED | certificates/routes.ts | `/verify/:no` shares the 100/min general limiter — bulk scraping of names possible | Recommend dedicated 10/min/IP limiter + bot challenge at CDN |
| SEC-11 | MED | enrollments (design) | Sequential bigint ids are enumerable; mitigated by ownership checks everywhere + slugs/business-numbers on public surfaces (schema-notes) | Accepted risk; keep ownership checks mandatory in code review checklist |
| SEC-12 | LOW | bunnyStream.ts | Signed playback URLs replayable within TTL (≤4h) by design | Residual; IP-lock flag exists (`BUNNY_TOKEN_IP_LOCK`), watermark note in SECURITY.md |
| SEC-13 | LOW | otp flow | Verify brute force: capped at 5 attempts/code + 10/min/IP + 6-digit random — residual risk acceptable | None needed; keep caps |
| SEC-14 | LOW | admin manualEnroll | moderator/support can comp paid internships (by design, audited) | Monitor via audit dashboards |
| SEC-15 | LOW | env.ts | Demo placeholder secrets in `.env.example` could be deployed as-is | Boot-time warning when `change-me` values detected in prod — add with ops hardening |

Verified clean: parameterized SQL everywhere (no string interpolation of user input — limit/offset are server-computed integers); stack traces never leave the process; bcrypt(10)+sha256-salted OTPs+AES-256-GCM PAN/bank; pino redacts authorization/cookies/passwords/tokens; helmet+CORS allowlist; webhook HMAC constant-time over raw body; envelope errors carry no internals; public verify returns a fixed 7-field whitelist; role guards on every non-public route (matrix-checked); refresh reuse nukes the device fleet.

## Re-test

`tests/security.int.test.ts` (6.1 suite) regression-tests SEC-01/02/03/05 plus the IDOR matrix on submissions/orders/offer letters.
