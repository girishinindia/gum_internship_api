# internship-api — GUM Internships backend

Express + TypeScript (strict) API. Module sessions build on this scaffold; conventions live in `CLAUDE.md`, contracts in `docs/openapi.yaml`, schema in `supabase/migrations/`.

## Run

```bash
npm install
cp .env.example .env        # fill real values; boot crashes loudly on bad config
npm run dev                 # tsx watch, http://localhost:4000
```

Build & production:

```bash
npm run build               # tsc → dist/
npm start                   # node dist/server.js
```

Quality gates:

```bash
npm run typecheck           # strict TS, no emit
npm run lint
npm test                    # jest + supertest (no DB needed)
```

## Migrations

```bash
# Supabase CLI (project linked)
supabase db push            # applies supabase/migrations in order

# or plain psql
psql "$DATABASE_URL" -f supabase/migrations/0001_init.sql
psql "$DATABASE_URL" -f supabase/migrations/0002_indexes.sql
psql "$DATABASE_URL" -f supabase/migrations/0003_rls.sql
psql "$DATABASE_URL" -f supabase/migrations/0004_seed.sql   # dev/staging only
```

## Manual test checklist (scaffold acceptance)

```bash
curl -s localhost:4000/health
# → {"success":true,"data":{"status":"ok",...},"error":null}

curl -s localhost:4000/v1/nope
# → 404 {"success":false,"data":null,"error":{"code":"NOT_FOUND",...}}

curl -s localhost:4000/__dev/error          # development only
# → 409 {"success":false,...,"error":{"code":"CONFLICT","message":"Demo conflict..."}}

curl -sI localhost:4000/health | grep -i x-request-id
# → every response carries a request id (also accepted inbound)

curl -s -X POST localhost:4000/v1/x -H 'content-type: application/json' -d '{bad'
# → 400 VALIDATION_ERROR "Malformed JSON body"
```

All five verified against this scaffold (plus `npm run typecheck`, `npm test`, `npm run lint` all green).

## Layout

```
src/
  config/env.ts        zod-validated env (crashes at boot on bad config)
  core/                AppError, error codes→status map, envelope helper,
                       asyncHandler, global error + 404 middleware, logger
  middlewares/         requireAuth + requireRoles (finalized in 2.2),
                       rate limiter factory, zodValidate(schema, part)
  db/                  pg Pool (query/queryOne/tx) + service-role Supabase client
  modules/<14>/        one folder per module; empty routes.ts until its session
  routes/index.ts      mounts every module at /v1 (ownership map in comments)
  app.ts / server.ts   http pipeline / lifecycle, graceful shutdown
tests/                 supertest smoke tests for the acceptance criteria
```

## Module 2.2 — auth + users (done)

`/auth/register` (pending_verification + dual OTP), `/auth/otp/request|verify` (60s cooldown, 3/hour/identifier), `/auth/login` (email or phone), `/auth/refresh` (hashed rotating sessions + reuse detection revokes the fleet), `/auth/logout[-all]`, `/auth/password/forgot|reset|change`, `/users/me` GET/PATCH (track, resumeUrl), `/users/instructor-application` POST/GET (PAN/bank AES-256-GCM at rest, last4 only), `/admin/users` (filters + pagination, moderator/support).
Requires migration `0005_auth_users.sql`. Dev convenience: with `NOTIFY_DRY_RUN=true` outside production, OTP codes are echoed in `meta.dev.otp`.
Verified live: 22-step curl matrix incl. wrong OTP, refresh reuse, role-block, rate limits, duplicate email, weak password, encrypted-at-rest check.

## Notes for module sessions

- Controllers never build JSON by hand — use `ApiResponse.ok/created/paginated/fail`.
- Repositories use `query`/`queryOne`/`tx` from `src/db/pool.ts` (parameterized SQL only).
- `req.rawBody` is already captured for webhook HMAC verification (module 2.8).
- Money columns arrive as strings from pg (intentional); ids arrive as numbers.
- Known advisory: `multer` 1.x is deprecated upstream; planned swap to `multer@2` in module 2.5 (media) before any upload endpoint ships.

## Testing (Phase 6.1)

```bash
npm run test:unit          # fast, no DB
DATABASE_URL_TEST=postgresql://postgres:postgres@localhost:5432/gum_test npm run test:int
npm test                   # both
```
Integration suite rebuilds the test DB from supabase/migrations each run (globalSetup) and covers: full auth chain incl. refresh-reuse fleet revocation, free enrollment + offer letter + sequential-unlock/playback authz, paid order → HMAC webhook (duplicate-delivery idempotent, forged sig 401, tampered amount audited), project submit→resubmit→approve with weighted score, table-driven certificate eligibility (6 rule combos) + issue/verify/tamper, refund clawback math.

CI (GitHub Actions sketch):
```yaml
services:
  postgres:
    image: postgres:15
    env: { POSTGRES_PASSWORD: postgres }
    ports: ['5432:5432']
    options: --health-cmd pg_isready --health-interval 5s
steps:
  - uses: actions/setup-node@v4
    with: { node-version: 20 }
  - run: npm ci
  - run: npm run typecheck && npm run lint && npm run test:unit
  - run: npm run test:int
    env: { DATABASE_URL_TEST: postgresql://postgres:postgres@localhost:5432/gum_test }
```
