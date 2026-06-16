# Environment Configuration Guide

Every service reads a `.env` file. The API **crashes on boot** if a *required*
variable is missing or invalid (validated by `src/config/env.ts` with zod) —
this is intentional, so you never run with half a config. Everything else has a
safe default.

There are three env files, one per app:

| App | File | Purpose |
|---|---|---|
| `internship-api` | `internship-api/.env` | the backend (DB, auth, providers, features) |
| `internship-web` | `internship-web/.env.local` | student/instructor web app |
| `internship-admin` | `internship-admin/.env.local` | admin portal |

Copy the `*.example` files and fill them in:

```bash
cp internship-api/.env.example        internship-api/.env
cp internship-web/.env.local.example  internship-web/.env.local
cp internship-admin/.env.local.example internship-admin/.env.local
```

> **How the API loader works.** `env.ts` first *aliases* the Grow Up More
> variable names (e.g. `SMS_API_KEY`, `BUNNY_STORAGE_KEY`, `EMAIL_FROM`) onto the
> app's internal names and fills operational defaults, **then** validates. So you
> can use either naming style. Secrets are never logged; `.env` is gitignored.

---

## 1. API — REQUIRED (boot fails without these)

| Variable | What it is | How to get / generate |
|---|---|---|
| `DATABASE_URL` | Postgres connection (Supabase session pooler) | Supabase → Project → Settings → Database → Connection string. Keep `?sslmode=require`. |
| `SUPABASE_URL` | Project URL | Supabase → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key (server-only, bypasses RLS) | Supabase → Settings → API. **Never** ship to a browser. |
| `CORS_ORIGINS` | Comma-separated allowed origins | e.g. `http://localhost:3000,http://localhost:3100` |
| `JWT_ACCESS_SECRET` | Access-token signing secret (≥32 chars) | `openssl rand -hex 32` |
| `JWT_REFRESH_SECRET` | Refresh-token signing secret (≥32 chars) | `openssl rand -hex 32` (different value) |
| `ENCRYPTION_KEY` | AES-256-GCM key for PAN/bank fields — **exactly 64 hex chars** | `openssl rand -hex 32` |
| `SMS_API_KEY` / `SMS_SENDER_ID` / `SMS_ENTITY_ID` / `SMS_DLT_TEMPLATE_ID` | SMS Gateway Hub DLT credentials | from your SMS Gateway Hub + DLT registration |
| `BREVO_API_KEY` / `EMAIL_FROM` / `EMAIL_FROM_NAME` | Transactional email (Brevo) | Brevo → SMTP & API → API Keys; a verified sender address |
| `BUNNY_STORAGE_ZONE` / `BUNNY_STORAGE_KEY` / `BUNNY_CDN_URL` | File storage zone | bunny.net → Storage → your zone (FTP & API password) |
| `BUNNY_STREAM_LIBRARY_ID` / `BUNNY_STREAM_API_KEY` / `BUNNY_STREAM_CDN` / `BUNNY_STREAM_TOKEN_KEY` | Lesson video | bunny.net → Stream → your library |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | Payments (web checkout) | Razorpay Dashboard → Settings → API Keys |
| `CERTIFICATE_VERIFY_BASE_URL` | Public verify URL base | e.g. `https://your-web-domain/verify` |

> SMS/Bunny/Brevo are required because the loader has no safe fallback for them.
> In **dry-run** (below) they aren't actually called, but the values must still
> parse — put any placeholder during pure local dev.

## 2. API — operational toggles (have defaults; change per environment)

| Variable | Default | Meaning |
|---|---|---|
| `NODE_ENV` | `development` | `production` in prod |
| `PORT` | `8001` | API port |
| `DB_SCHEMA` | `intern` | Postgres schema all objects live in |
| `API_BASE_URL` / `WEB_APP_URL` / `ADMIN_APP_URL` | localhost | absolute URLs used in links/emails |
| `NOTIFY_DRY_RUN` | `false` | master switch — when `true`, email/SMS are logged, not sent |
| `EMAIL_DRY_RUN` | `false` | log emails instead of sending |
| `SMS_DRY_RUN` | `true` | log SMS instead of sending (DLT-safe default) |
| `PAYMENTS_DRY_RUN` | `false` | fabricate Razorpay orders so checkout works without real money |
| `STORAGE_DRY_RUN` | `false` | write files to local `var/storage` instead of Bunny |
| `LIVE_DRY_RUN` | `true` | fabricate Zoom/Meet links instead of calling the provider |
| `AI_DRY_RUN` | `false` | return placeholder AI answers + pseudo-vectors (no provider calls) |
| `GST_RATE_PERCENT` / `GST_HOME_STATE` | `18` / `Gujarat` | invoice tax math |
| `JWT_ACCESS_TTL_MINUTES` / `JWT_REFRESH_TTL_DAYS` | `15` / `7` | token lifetimes |
| `RATE_LIMIT_*_PER_MINUTE` | 100 / 20 / 5 | general / auth / OTP throttles |

> **Tip for local/staging:** set `NOTIFY_DRY_RUN=true`, `PAYMENTS_DRY_RUN=true`,
> `AI_DRY_RUN=true`, `STORAGE_DRY_RUN=true`, `LIVE_DRY_RUN=true` to run the entire
> platform — including all R0–R6 features — with **zero** external calls or spend.

## 3. AI layer (R2) — already wired, keys optional

| Variable | Default | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | `unset` | chat (study-buddy, interview, translation) |
| `OPENAI_API_KEY` | `unset` | embeddings (RAG) + chat fallback |
| `GOOGLE_API_KEY` | `unset` | reserved |
| `AI_CHAT_MODEL` | `claude-3-5-haiku-20241022` | primary chat model |
| `AI_EMBED_MODEL` / `AI_EMBED_DIM` | `text-embedding-3-small` / `1536` | must match the `lesson_embeddings` vector size |
| `AI_DAILY_COST_CAP_USD` | `0.5` | per-user/day spend ceiling; `0` = unlimited |
| `AI_MAX_OUTPUT_TOKENS` | `1024` | response cap |

If a key is `unset` (or `AI_DRY_RUN=true`), that provider is treated as not
configured and the feature degrades safely.

---

## 4. Feature-activation matrix (the deferred / credential-gated pieces)

Each of these is **built and inert** today. Drop the values in and it activates
— no code change. (See `docs/SERVICES-IMPLEMENTATION-STEPS.md` for the roadmap IDs.)

### 4.1 Push notifications — Firebase / FCM (R0-S2, R1-S6)
1. Firebase Console → your project → **Project settings → Service accounts → Generate new private key** (downloads a JSON).
2. From that JSON set in `internship-api/.env`:
   ```
   FCM_PROJECT_ID=<project_id>
   FCM_CLIENT_EMAIL=<client_email>
   FCM_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n…\n-----END PRIVATE KEY-----\n"
   ```
   (Keep the `\n` escapes on one line, in quotes.)
3. Restart the API. Until set, push logs `[FCM not configured] push skipped`.

### 4.2 Payment & encode webhooks (R0-S4)
```
RAZORPAY_WEBHOOK_SECRET=<from Razorpay → Settings → Webhooks>
BUNNY_STREAM_WEBHOOK_SECRET=<the secret you set on Bunny Stream's webhook>
```
Without these, signed webhooks are rejected (safe default).

### 4.3 Stipend payouts — RazorpayX (R0-S5, R5-S5)
Requires a **RazorpayX** account (separate from Checkout). Once enabled, the
stipend-payout step can be built; it also needs student bank-KYC capture. *Not
yet wired* — this is the one remaining un-built feature.

### 4.4 GitHub OAuth — repo verification + AI code-review (R0-S6, R2-S7)
GitHub → Settings → Developer settings → **OAuth Apps → New** →
```
GITHUB_CLIENT_ID=<client id>
GITHUB_CLIENT_SECRET=<client secret>
```
(env keys reserved; wiring lands when you provide the app.)

### 4.5 WhatsApp alerts — WABA (R0-S7, R3-S4)
Needs a Gupshup or Meta WhatsApp Business account + approved templates. Provide
the provider API key + template ids to activate the WhatsApp channel.

### 4.6 Open Badges baking (R0-S8, part of R3-S5)
Needs an Open Badges **issuer key**. The LinkedIn "Add to Profile" link already
works with no credentials; baking signed badge images is what this unlocks.

---

## 5. Web app — `internship-web/.env.local`

| Variable | Required | Notes |
|---|---|---|
| `API_URL` | ✅ | server-side base URL of the API, e.g. `http://localhost:8001` (no `/v1`). Used by RSC/route handlers. |
| `NEXT_PUBLIC_SITE_URL` | recommended | absolute site URL for SEO/canonical/OG tags, e.g. `http://localhost:3000` |

The browser never gets tokens or the API key — the web app proxies through
`/api/proxy/*` and stores httpOnly cookies (`gum_at` / `gum_rt`).

## 6. Admin app — `internship-admin/.env.local`

| Variable | Required | Notes |
|---|---|---|
| `API_URL` | ✅ | API base URL, same as web |

---

## 7. Quick start (local, zero external calls)

```bash
# 1. API
cp internship-api/.env.example internship-api/.env
#   set DATABASE_URL + SUPABASE_* to your project; generate the 3 secrets:
#   openssl rand -hex 32   (JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, ENCRYPTION_KEY)
#   set *_DRY_RUN=true for NOTIFY / PAYMENTS / AI / STORAGE / LIVE
cd internship-api && npm install && npm run dev      # :8001

# 2. Web + Admin
echo "API_URL=http://localhost:8001" > internship-web/.env.local
echo "API_URL=http://localhost:8001" > internship-admin/.env.local
(cd internship-web && npm install && npm run dev)    # :3000
(cd internship-admin && npm install && npm run dev)  # :3100
```

Seed logins (all `Password@123`): `admin@gum-demo.in`, `priya@gum-demo.in`,
`student@gum-demo.in`.

## 8. Production checklist

- [ ] `NODE_ENV=production`
- [ ] All *required* vars set with **real** values (§1)
- [ ] Turn dry-runs **off**: `NOTIFY_DRY_RUN`, `PAYMENTS_DRY_RUN`, `STORAGE_DRY_RUN`, `LIVE_DRY_RUN`, `AI_DRY_RUN` = `false` (keep `SMS_DRY_RUN` per DLT readiness)
- [ ] Fresh `JWT_*` + `ENCRYPTION_KEY` (never reuse dev secrets)
- [ ] `RAZORPAY_WEBHOOK_SECRET` + `BUNNY_STREAM_WEBHOOK_SECRET` set
- [ ] `CORS_ORIGINS` = your real web + admin domains only
- [ ] `CERTIFICATE_VERIFY_BASE_URL`, `WEB_APP_URL`, `ADMIN_APP_URL` = real domains
- [ ] AI keys set (or `AI_DRY_RUN=true` to keep AI off)
- [ ] `.env` files are NOT committed (already gitignored)
