-- 0020 — First-party product analytics event store. Append-only; headline
-- metrics are also computed live from source tables in the admin analytics API.
set search_path = intern, public;
create table if not exists analytics_events (
  id         bigint generated always as identity primary key,
  name       text not null,
  user_id    bigint,
  props      jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_analytics_name_time on analytics_events (name, created_at desc);
create index if not exists idx_analytics_time on analytics_events (created_at);
