-- ============================================================================
-- GUM Internships — 0010 (R3: gamification — XP, badges, streaks)
-- ============================================================================
-- Runs in the `intern` schema. Awards are driven by the event bus (R3-S2);
-- xp_events carries a unique source key so awards are idempotent.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. XP ledger — one row per awarded action (append-only)
-- ----------------------------------------------------------------------------
create table xp_events (
  id          bigint generated always as identity primary key,
  user_id     bigint not null references users (id) on delete cascade,
  kind        text not null,                 -- lesson_completed | task_approved | certificate | forum_answer | streak_bonus
  points      integer not null check (points >= 0),
  -- stable de-dup key, e.g. 'lesson:123' / 'submission:456' — one award each
  source_key  text not null,
  metadata    jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  unique (user_id, source_key)
);
create index idx_xp_events_user on xp_events (user_id, created_at desc);

-- ----------------------------------------------------------------------------
-- 2. Badge catalogue + awards
-- ----------------------------------------------------------------------------
create table badges (
  id          bigint generated always as identity primary key,
  code        text not null unique,          -- machine code, e.g. 'first_steps'
  name        text not null,
  description text not null,
  icon        text,                          -- emoji or icon key
  tier        text not null default 'bronze',-- bronze | silver | gold
  created_at  timestamptz not null default now()
);

create table user_badges (
  id         bigint generated always as identity primary key,
  user_id    bigint not null references users (id) on delete cascade,
  badge_id   bigint not null references badges (id) on delete cascade,
  awarded_at timestamptz not null default now(),
  unique (user_id, badge_id)
);
create index idx_user_badges_user on user_badges (user_id, awarded_at desc);

-- ----------------------------------------------------------------------------
-- 3. Streaks — daily learning activity per user
-- ----------------------------------------------------------------------------
create table streaks (
  user_id        bigint primary key references users (id) on delete cascade,
  current_streak integer not null default 0,
  longest_streak integer not null default 0,
  last_active_on date,
  updated_at     timestamptz not null default now()
);

create trigger trg_streaks_updated_at before update on streaks
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- 4. Seed badge catalogue
-- ----------------------------------------------------------------------------
insert into badges (code, name, description, icon, tier) values
  ('first_steps',  'First Steps',      'Completed your first lesson.',                 '👣', 'bronze'),
  ('task_master',  'Task Master',      'Got a project task approved by a mentor.',     '✅', 'silver'),
  ('graduate',     'Graduate',         'Earned a completion certificate.',             '🎓', 'gold'),
  ('streak_7',     'Week Warrior',     'Kept a 7-day learning streak.',                '🔥', 'silver'),
  ('streak_30',    'Unstoppable',      'Kept a 30-day learning streak.',               '⚡', 'gold'),
  ('helper',       'Community Helper', 'Posted 5 helpful forum replies.',              '🤝', 'silver')
on conflict (code) do nothing;

-- ----------------------------------------------------------------------------
-- 5. RLS (default-deny; API uses service role)
-- ----------------------------------------------------------------------------
alter table xp_events    enable row level security;
alter table badges       enable row level security;
alter table user_badges  enable row level security;
alter table streaks      enable row level security;
