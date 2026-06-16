-- ============================================================================
-- GUM Internships — 0012 (R4: mentorship booking + skill assessment)
-- ============================================================================
-- Runs in the `intern` schema.
--   mentor_availability  — bookable slots a mentor publishes
--   mentor_bookings      — a student's booking of a slot (1:1 with slot)
--   assessment_questions — diagnostic question bank per track
--   assessment_attempts  — scored diagnostic runs + internship recommendations
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Mentor availability (slots)
-- ----------------------------------------------------------------------------
create table mentor_availability (
  id               bigint generated always as identity primary key,
  mentor_user_id   bigint not null references users (id) on delete cascade,
  starts_at        timestamptz not null,
  duration_minutes integer not null default 30 check (duration_minutes between 15 and 180),
  price            numeric(10,2) not null default 0 check (price >= 0),  -- 0 = free / included
  currency         char(3) not null default 'INR',
  topic            text,
  status           text not null default 'open',   -- open | booked | cancelled
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (status in ('open', 'booked', 'cancelled'))
);
create index idx_mentor_avail_open
  on mentor_availability (mentor_user_id, starts_at)
  where status = 'open';
create index idx_mentor_avail_upcoming
  on mentor_availability (starts_at) where status = 'open';

-- ----------------------------------------------------------------------------
-- 2. Mentor bookings (one per slot)
-- ----------------------------------------------------------------------------
create table mentor_bookings (
  id                  bigint generated always as identity primary key,
  slot_id             bigint not null unique references mentor_availability (id) on delete cascade,
  student_user_id     bigint not null references users (id) on delete cascade,
  mentor_user_id      bigint not null references users (id) on delete cascade,
  status              text not null default 'confirmed',  -- pending_payment | confirmed | cancelled | completed
  price               numeric(10,2) not null default 0,
  currency            char(3) not null default 'INR',
  razorpay_order_id   text,
  razorpay_payment_id text,
  provider            text,                  -- zoom | google_meet
  meeting_id          text,
  join_url            text,
  passcode            text,
  student_note        text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (status in ('pending_payment', 'confirmed', 'cancelled', 'completed'))
);
create index idx_mentor_bookings_student on mentor_bookings (student_user_id, created_at desc);
create index idx_mentor_bookings_mentor on mentor_bookings (mentor_user_id, created_at desc);

-- ----------------------------------------------------------------------------
-- 3. Skill assessment (diagnostic) — track-based question bank + attempts
-- ----------------------------------------------------------------------------
create table assessment_questions (
  id            bigint generated always as identity primary key,
  track         text not null,               -- e.g. 'web', 'data', 'flutter', 'marketing'
  question_text text not null,
  options       jsonb not null,              -- ["A","B","C","D"]
  correct_index integer not null check (correct_index >= 0),
  display_order integer not null default 0,
  created_at    timestamptz not null default now()
);
create index idx_assessment_questions_track on assessment_questions (track, display_order);

create table assessment_attempts (
  id              bigint generated always as identity primary key,
  user_id         bigint not null references users (id) on delete cascade,
  track           text not null,
  score           numeric(5,2) not null,     -- 0..100
  correct_count   integer not null,
  question_count  integer not null,
  recommendations jsonb not null default '[]',
  answers         jsonb not null default '[]',
  created_at      timestamptz not null default now()
);
create index idx_assessment_attempts_user on assessment_attempts (user_id, created_at desc);

-- ----------------------------------------------------------------------------
-- 4. updated_at triggers + seed diagnostic questions
-- ----------------------------------------------------------------------------
create trigger trg_mentor_avail_updated_at before update on mentor_availability
  for each row execute function set_updated_at();
create trigger trg_mentor_bookings_updated_at before update on mentor_bookings
  for each row execute function set_updated_at();

insert into assessment_questions (track, question_text, options, correct_index, display_order) values
  ('web', 'Which HTTP method is idempotent and used to fully replace a resource?', '["POST","PUT","PATCH","CONNECT"]', 1, 1),
  ('web', 'In an Express app, where does request validation belong in the layered flow?', '["After the controller","Before the controller (middleware)","Inside the repository","In the database"]', 1, 2),
  ('web', 'Which status code means the request was understood but refused due to permissions?', '["401","403","404","500"]', 1, 3),
  ('web', 'A foreign key primarily enforces what?', '["Uniqueness","Referential integrity","Encryption","Indexing"]', 1, 4),
  ('data', 'In pandas, which method gives summary statistics of numeric columns?', '["describe()","head()","info()","groupby()"]', 0, 1),
  ('data', 'Overfitting is best described as a model that…', '["Generalises well","Memorises training data, fails on new data","Underuses features","Trains too slowly"]', 1, 2),
  ('data', 'Which metric suits an imbalanced classification problem?', '["Accuracy","F1-score","Total count","Learning rate"]', 1, 3),
  ('flutter', 'In Flutter, which widget rebuilds when its state changes?', '["StatelessWidget","StatefulWidget","Container","Text"]', 1, 1),
  ('flutter', 'Riverpod is primarily used for…', '["Networking","State management","Animations","Local storage"]', 1, 2),
  ('marketing', 'CTR stands for…', '["Cost To Reach","Click-Through Rate","Customer Target Ratio","Channel Traffic Report"]', 1, 1),
  ('marketing', 'Which metric measures revenue per rupee of ad spend?', '["CPC","ROAS","CPM","CTR"]', 1, 2);

-- ----------------------------------------------------------------------------
-- 5. RLS (default-deny; API uses service role)
-- ----------------------------------------------------------------------------
alter table mentor_availability   enable row level security;
alter table mentor_bookings       enable row level security;
alter table assessment_questions  enable row level security;
alter table assessment_attempts   enable row level security;
