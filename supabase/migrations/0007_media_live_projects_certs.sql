-- ============================================================================
-- GUM Internships — 0007 (modules 2.6–2.12 deltas)
-- ============================================================================

-- 2.8: video links as a submission type (used at runtime only, never here)
alter type submission_type add value if not exists 'video_url';

-- 2.7: reminder bookkeeping for the T-24h / T-1h sweep
alter table live_sessions
  add column reminder_24h_sent_at timestamptz,
  add column reminder_1h_sent_at  timestamptz;
create index idx_live_sessions_reminders
  on live_sessions (scheduled_start)
  where status = 'scheduled' and (reminder_24h_sent_at is null or reminder_1h_sent_at is null);

-- 2.8: task weighting for the aggregate project score; late/resubmit tracking
alter table project_tasks add column weight numeric(6,2) not null default 1 check (weight > 0);
alter table submissions
  add column is_late boolean not null default false,
  add column resubmit_due_on date;
alter table enrollments add column project_score numeric(6,2);

-- 2.9: certificate grade band
alter table certificates add column grade varchar(2);

-- 2.10: dead-letter log for provider failures (after one retry)
create table notification_failures (
  id         bigint generated always as identity primary key,
  user_id    bigint references users (id),
  event      text not null,
  channel    notification_channel not null,
  error      text not null,
  payload    jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index idx_notification_failures_created on notification_failures (created_at desc);

-- 2.12: support ticket replies (threading)
create table ticket_replies (
  id         bigint generated always as identity primary key,
  ticket_id  bigint not null references support_tickets (id),
  author_id  bigint not null references users (id),
  body       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_ticket_replies_ticket on ticket_replies (ticket_id, created_at);
create trigger trg_ticket_replies_updated_at before update on ticket_replies
  for each row execute function set_updated_at();

-- seeded demo tasks get meaningful weights (final week counts double)
update project_tasks set weight = 2 where week_number = 4;
