# 17 — R0 Enablers: Infrastructure Verification

R0 isn't a user-facing feature — it's the platform plumbing the later phases
(R1–R6) depend on. This doc verifies those enablers are live and that the
credential-gated ones fail **safely** (inert, not broken) until configured.

Run these as an operator with database + API-log access. Most checks are SQL on
the live `intern` schema or a glance at the API boot log.

---

## 17.1 pgvector (unblocks R2 AI / RAG)

| # | Check | How | Expected |
|---|---|---|---|
| 1 | Extension enabled | `select extname, extversion from pg_extension where extname='vector';` | One row, version ≥ 0.8.0. |
| 2 | Vector type usable | `select '[1,2,3]'::extensions.vector(3) <-> '[1,2,4]'::extensions.vector(3);` | Returns a distance (≈1), no error. |
| 3 | RAG index present | `select indexname from pg_indexes where tablename='lesson_embeddings';` | Includes the HNSW index `idx_lesson_embeddings_vec`. |

## 17.2 pg_cron maintenance jobs

| # | Check | How | Expected |
|---|---|---|---|
| 1 | Jobs scheduled | `select jobname, schedule from cron.job order by jobname;` | Three: `intern_mature_earnings` (`5 * * * *`), `intern_cleanup_otp` (`30 3 * * *`), `intern_expire_quiz_attempts` (`15 * * * *`). |
| 2 | A run was recorded | `select jobname, status, start_time from cron.job_run_details order by start_time desc limit 5;` | Recent rows with `status='succeeded'` (after the first scheduled tick). |
| 3 | Earnings maturation logic | confirm the job SQL flips `instructor_earnings` from `pending`→`available` once `available_at <= now()`. | A matured row moves to `available` on the next hourly run. |

## 17.3 In-process job queue (notifications, embeddings, PDFs)

| # | Check | How | Expected |
|---|---|---|---|
| 1 | Queue runs jobs | trigger anything async (e.g. claim a certificate, or `POST /admin/ai/reindex`). | API log shows `job done { job: … }`. |
| 2 | Failures don't break the chain | n/a (by design) | A failing job logs `job failed` and the next job still runs. |

## 17.4 FCM push sender — **inert until configured** (R0-S2)

The sender is built but must degrade safely while `FCM_PROJECT_ID` is `unset`.

| # | Check | How | Expected |
|---|---|---|---|
| 1 | Not configured by default | inspect `.env` (FCM_* placeholders) | `FCM_PROJECT_ID` is `unset`/placeholder. |
| 2 | Push is skipped, not errored | cause a push-eligible notification (e.g. enrollment) with a device token present | API log: `[FCM not configured] push skipped` — **no thrown error, no crash**. |
| 3 | Activation path documented | `.env.example` has the FCM block | Dropping a real service account (`FCM_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY`) activates it with no code change. |

## 17.5 Other credential-gated enablers (expected state today)

These are intentionally **not yet active** — verify each is absent/inert, not
half-wired:

| Enabler | Today's expected state |
|---|---|
| Razorpay + Bunny **webhook secrets** (R0-S4) | placeholders; live webhooks unverified until set. |
| **RazorpayX** payouts (R0-S5) | no payout account; stipend payouts (R5-S5) deferred. |
| **GitHub OAuth** (R0-S6) | not configured; AI code-review (R2-S7) deferred. |
| **WhatsApp WABA** (R0-S7) | not configured; WhatsApp alerts (R3-S4) deferred. |
| **Open Badges** issuer (R0-S8) | not configured; badge baking deferred (LinkedIn add-to-profile already works). |

---

### Pass criteria
pgvector usable · 3 cron jobs scheduled (and a succeeded run) · queue logs
`job done` · FCM logs "skipped" without error · no half-configured credential
path throws on a normal request.
