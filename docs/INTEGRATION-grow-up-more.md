# Integration Runbook — Grow Up More / GI Internship live providers

What was wired to the real services (values live in the git-ignored `.env`, never committed).

## Supabase (Postgres 17, project ixygmsqbpyyvjhxphpso)
- App objects live in schema **`intern`** (created on setup). Migrations 0001–0007 applied with `search_path=intern,extensions,public`; the `updated_at` trigger DO-block was switched `public→intern`. Extensions citext + pg_trgm reused (already installed).
- `src/db/pool.ts` pins `search_path` on every connection (`DB_SCHEMA=intern`) and connects over TLS with relaxed chain verification (Supabase pooler presents a chain Node doesn't bundle; `sslmode` is stripped from the URL and `ssl.rejectUnauthorized:false` is set — supply `ssl.ca` for stricter prod).
- Re-load: `drop schema if exists intern cascade; create schema intern;` then run the 7 files with that search_path.

## Bunny (verified PUT/GET/DELETE + Stream list)
- Single storage zone `growupmore-internship`; `env.ts` maps it onto both public+private slots. `STORAGE_DRY_RUN=false` → real uploads. Private reads signed with `BUNNY_STREAM_TOKEN_KEY` (no separate storage token in this deployment).
- Stream library `682477`; signed playback via `BUNNY_STREAM_TOKEN_KEY`, CDN host derived from `BUNNY_STREAM_CDN`.

## Email (Brevo) + SMS (SMS Gateway Hub, DLT)
- Exact templates ported to `src/services/notify/templates.ts`. **Email**: the provided light-blue HTML, product name = **GI Internship** (one `BRAND` constant). **SMS**: the 5 DLT-approved templates verbatim (ids + text unchanged — "Genius ITens (Grow Up More)").
- OTP purpose → template map in `notify/index.ts`: email_verify/phone_verify→registration·user_registration; password_reset→forgot_password.
- Flags: `EMAIL_DRY_RUN=false` (real), `SMS_DRY_RUN=true` (set `SMS_FORCE_SEND=true` + a real number to dispatch). Generic event SMS (2.10) is skipped — only the 5 approved DLT templates may be sent.
- Verified: a real branded OTP email delivered to the admin address; SMS request shape matches the approved integration.

## Razorpay — ⚠️ LIVE KEYS
- `PAYMENTS_DRY_RUN=false`. Order creation is free; **capture spends real money**. No capture was triggered during integration. Set `RAZORPAY_WEBHOOK_SECRET` from the Razorpay dashboard webhook before going live (currently a placeholder).

## Env var mapping
`src/config/env.ts` aliases the project's variable names (SMS_API_KEY, BUNNY_STORAGE_KEY, EMAIL_FROM, "15m"/"7d" TTLs, single zone, PORT 8001, DB_SCHEMA) onto the app's internal names, and adds two the .env lacked: **ENCRYPTION_KEY** (generated 32-byte AES key for PAN/bank) and **CERTIFICATE_VERIFY_BASE_URL**.

## Pending before full production
- Razorpay & Bunny-Stream webhook secrets (placeholders today).
- Upstash Redis queue / reCAPTCHA features are env-passthrough only (later phases).
- Cosmetic: certificate-number prefix still "GUM" (→ "GI" is a one-line change in .env).
