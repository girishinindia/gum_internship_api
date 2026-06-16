-- ============================================================================
-- GUM Internships — 0011 (R3: doubt forum / cohort community)
-- ============================================================================
-- Threaded Q&A scoped to an internship. Instructor replies are badge-flagged.
-- Moderation: pin / lock / soft-delete by staff. Runs in `intern` schema.
-- ============================================================================

create table forum_threads (
  id            bigint generated always as identity primary key,
  internship_id bigint not null references internships (id) on delete cascade,
  user_id       bigint not null references users (id) on delete cascade,
  title         text not null check (char_length(title) between 3 and 200),
  body          text not null check (char_length(body) between 1 and 8000),
  is_pinned     boolean not null default false,
  is_locked     boolean not null default false,
  is_resolved   boolean not null default false,
  is_deleted    boolean not null default false,
  reply_count   integer not null default 0,
  last_reply_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index idx_forum_threads_internship
  on forum_threads (internship_id, is_pinned desc, last_reply_at desc nulls last, created_at desc)
  where not is_deleted;

create table forum_replies (
  id            bigint generated always as identity primary key,
  thread_id     bigint not null references forum_threads (id) on delete cascade,
  user_id       bigint not null references users (id) on delete cascade,
  body          text not null check (char_length(body) between 1 and 8000),
  is_instructor boolean not null default false,  -- snapshot: author was staff/instructor
  is_accepted   boolean not null default false,  -- marked as the answer by OP/staff
  is_deleted    boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index idx_forum_replies_thread on forum_replies (thread_id, created_at)
  where not is_deleted;

create trigger trg_forum_threads_updated_at before update on forum_threads
  for each row execute function set_updated_at();
create trigger trg_forum_replies_updated_at before update on forum_replies
  for each row execute function set_updated_at();

alter table forum_threads enable row level security;
alter table forum_replies enable row level security;
