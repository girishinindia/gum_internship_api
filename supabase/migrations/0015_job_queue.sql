-- 0015 — Durable background-job queue (opt-in via JOB_QUEUE_DRIVER=pg).
-- The worker also creates this table on first run (ensureSchema), so applying
-- this migration is optional; it's here for teams that apply migrations explicitly.
set search_path = intern, public;

create table if not exists job_queue (
  id            bigint generated always as identity primary key,
  name          text not null,
  payload       jsonb not null default '{}'::jsonb,
  status        text not null default 'pending',   -- pending | active | completed | failed
  attempts      integer not null default 0,
  max_attempts  integer not null default 5,
  run_at        timestamptz not null default now(),
  last_error    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Fast claim of due work (the hot path: WHERE status='pending' AND run_at<=now()).
create index if not exists idx_job_queue_due on job_queue (run_at) where status = 'pending';
