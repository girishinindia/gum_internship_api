-- ============================================================================
-- GUM Internships — 0009 (R2: AI layer — RAG, chat threads, usage/cost cap)
-- ============================================================================
-- Requires pgvector (enabled in R0-S1; extension lives in `extensions`).
-- Embedding dim = 1536 (OpenAI text-embedding-3-small / env AI_EMBED_DIM).
-- Runs in the `intern` schema.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Lesson embeddings (RAG corpus) — chunked lesson content as vectors
-- ----------------------------------------------------------------------------
create table lesson_embeddings (
  id            bigint generated always as identity primary key,
  lesson_id     bigint not null references lessons (id) on delete cascade,
  internship_id bigint not null references internships (id) on delete cascade,
  chunk_index   integer not null,
  content       text not null,
  token_count   integer,
  embedding     extensions.vector(1536) not null,
  content_hash  text not null,                 -- skip re-embedding unchanged chunks
  created_at    timestamptz not null default now(),
  unique (lesson_id, chunk_index)
);
create index idx_lesson_embeddings_internship on lesson_embeddings (internship_id);
-- ANN index for cosine distance (ivfflat; lists tuned for a small corpus)
create index idx_lesson_embeddings_vec
  on lesson_embeddings using ivfflat (embedding extensions.vector_cosine_ops)
  with (lists = 100);

-- ----------------------------------------------------------------------------
-- 2. AI chat threads + messages (study-buddy conversations)
-- ----------------------------------------------------------------------------
create type ai_thread_kind as enum ('study_buddy', 'mock_interview');
create type ai_message_role as enum ('user', 'assistant', 'system');

create table ai_threads (
  id            bigint generated always as identity primary key,
  user_id       bigint not null references users (id) on delete cascade,
  kind          ai_thread_kind not null default 'study_buddy',
  internship_id bigint references internships (id) on delete set null,
  title         text,
  metadata      jsonb not null default '{}',   -- e.g. interview track/state
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index idx_ai_threads_user on ai_threads (user_id, created_at desc);

create table ai_messages (
  id          bigint generated always as identity primary key,
  thread_id   bigint not null references ai_threads (id) on delete cascade,
  role        ai_message_role not null,
  content     text not null,
  citations   jsonb not null default '[]',     -- [{lessonId,title,chunkIndex}]
  created_at  timestamptz not null default now()
);
create index idx_ai_messages_thread on ai_messages (thread_id, created_at);

-- ----------------------------------------------------------------------------
-- 3. AI usage ledger (per-user cost cap + observability)
-- ----------------------------------------------------------------------------
create table ai_usage (
  id            bigint generated always as identity primary key,
  user_id       bigint not null references users (id) on delete cascade,
  feature       text not null,                 -- ask | interview | embed | translate
  provider      text not null,                 -- anthropic | openai | google
  model         text not null,
  input_tokens  integer not null default 0,
  output_tokens integer not null default 0,
  cost_usd      numeric(10,6) not null default 0,
  thread_id     bigint references ai_threads (id) on delete set null,
  created_at    timestamptz not null default now()
);
-- daily-spend lookups per user
create index idx_ai_usage_user_day on ai_usage (user_id, created_at);

-- ----------------------------------------------------------------------------
-- 4. Mock interview attempts (scored sessions)
-- ----------------------------------------------------------------------------
create table ai_interview_attempts (
  id            bigint generated always as identity primary key,
  user_id       bigint not null references users (id) on delete cascade,
  thread_id     bigint references ai_threads (id) on delete set null,
  track         text not null,
  internship_id bigint references internships (id) on delete set null,
  status        text not null default 'in_progress',  -- in_progress | scored
  question_count integer not null default 0,
  overall_score numeric(5,2),
  feedback      jsonb not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index idx_ai_interview_user on ai_interview_attempts (user_id, created_at desc);

-- ----------------------------------------------------------------------------
-- 5. Lesson translations (Hindi / Gujarati etc.)
-- ----------------------------------------------------------------------------
create table lesson_translations (
  id            bigint generated always as identity primary key,
  lesson_id     bigint not null references lessons (id) on delete cascade,
  language      text not null,                 -- 'hi','gu',… (matches languages[])
  title         text not null,
  content       text not null,
  source_hash   text not null,                 -- detect stale translations
  status        text not null default 'machine',  -- machine | human_reviewed
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (lesson_id, language)
);

-- ----------------------------------------------------------------------------
-- 6. updated_at triggers + RLS (default-deny; API uses service role)
-- ----------------------------------------------------------------------------
create trigger trg_ai_threads_updated_at before update on ai_threads
  for each row execute function set_updated_at();
create trigger trg_ai_interview_updated_at before update on ai_interview_attempts
  for each row execute function set_updated_at();
create trigger trg_lesson_translations_updated_at before update on lesson_translations
  for each row execute function set_updated_at();

alter table lesson_embeddings     enable row level security;
alter table ai_threads            enable row level security;
alter table ai_messages           enable row level security;
alter table ai_usage              enable row level security;
alter table ai_interview_attempts enable row level security;
alter table lesson_translations   enable row level security;
