-- ============================================================================
-- GUM Internships — 0001_init.sql
-- Complete initial schema. PostgreSQL 15+ (Supabase).
-- Conventions: snake_case, BIGINT IDENTITY PKs (generated always as identity),
-- created_at/updated_at
-- on every mutable table (audit_logs is immutable by design: created_at only).
-- FK deletes default to NO ACTION: rows are never hard-deleted by the app
-- (users are anonymized, content is archived); cascades only on pure
-- ownership children noted inline.
-- ============================================================================

create extension if not exists citext;

-- ============================================================================
-- ENUM TYPES
-- ============================================================================

create type user_status          as enum ('active', 'suspended', 'deleted');
create type role_name            as enum ('student', 'instructor', 'moderator', 'finance_admin', 'support', 'super_admin');
create type otp_channel          as enum ('sms', 'email');
create type otp_purpose          as enum ('signup', 'login', 'password_reset', 'phone_verify', 'email_verify');
create type instructor_type      as enum ('internal', 'external');
create type kyc_status           as enum ('pending', 'submitted', 'approved', 'rejected');
create type agreement_status     as enum ('pending', 'sent', 'signed');
create type pricing_type         as enum ('free', 'paid', 'stipend');           -- 'stipend' reserved: flows are P2, schema-ready now
create type provider_type        as enum ('system', 'external');
create type delivery_mode        as enum ('recorded', 'live', 'hybrid', 'project_only');
create type pace_type            as enum ('batch', 'self_paced');
create type internship_status    as enum ('draft', 'pending_review', 'published', 'rejected', 'archived');
create type batch_status         as enum ('scheduled', 'enrolling', 'ongoing', 'completed', 'cancelled');
create type lesson_type          as enum ('video', 'live', 'document', 'quiz');
create type video_status         as enum ('uploading', 'processing', 'ready', 'failed');
create type live_provider        as enum ('zoom', 'google_meet');
create type live_session_status  as enum ('scheduled', 'live', 'completed', 'cancelled');
create type enrollment_status    as enum ('pending_payment', 'waitlisted', 'active', 'completed', 'dropped', 'suspended');
create type progress_status      as enum ('not_started', 'in_progress', 'completed');
create type attendance_status    as enum ('present', 'late', 'absent');
create type discount_type        as enum ('percent', 'flat');
create type order_status         as enum ('created', 'pending', 'paid', 'failed', 'refunded', 'cancelled');
create type payment_status       as enum ('created', 'authorized', 'captured', 'failed', 'refunded');
create type refund_status        as enum ('requested', 'approved', 'rejected', 'processed');
create type earning_status       as enum ('pending', 'available', 'settled', 'reversed');
create type settlement_status    as enum ('initiated', 'processing', 'completed', 'failed');
create type submission_type      as enum ('file', 'github_url', 'live_url');
create type submission_status    as enum ('submitted', 'under_review', 'approved', 'changes_requested', 'rejected');
create type review_decision      as enum ('approved', 'changes_requested', 'rejected');
create type question_type        as enum ('single_choice', 'multiple_choice', 'true_false');
create type attempt_status       as enum ('in_progress', 'submitted', 'expired');
create type certificate_status   as enum ('issued', 'revoked');
create type notification_channel as enum ('email', 'sms', 'push', 'in_app');
create type notification_category as enum ('transactional', 'reminders', 'marketing');
create type notification_status  as enum ('pending', 'sent', 'delivered', 'failed', 'read');
create type ticket_category      as enum ('payment', 'content', 'technical', 'certificate', 'other');
create type ticket_status        as enum ('open', 'in_progress', 'resolved', 'closed');
create type ticket_priority      as enum ('low', 'medium', 'high', 'urgent');
create type banner_placement     as enum ('home_hero', 'home_strip', 'category_page');

-- ============================================================================
-- SEQUENCES for human-readable business numbers (formatted by the API)
-- ============================================================================

create sequence seq_order_no       start 1;
create sequence seq_invoice_no     start 1;
create sequence seq_certificate_no start 1;
create sequence seq_ticket_no      start 1;
create sequence seq_settlement_no  start 1;

-- ============================================================================
-- IDENTITY & ACCESS
-- ============================================================================

create table users (
  id                 bigint generated always as identity primary key,
  email              citext unique,
  phone              varchar(16) unique check (phone ~ '^\+?[0-9]{10,15}$'),
  password_hash      text,                              -- null for OTP-only accounts
  full_name          text not null,
  avatar_url         text,
  status             user_status not null default 'active',
  email_verified_at  timestamptz,
  phone_verified_at  timestamptz,
  marketing_consent  boolean not null default false,
  last_login_at      timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint users_contact_check check (email is not null or phone is not null)
);

create table roles (
  id          bigint generated always as identity primary key,
  name        role_name not null unique,
  description text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Reference data (not demo data): the six fixed roles, deterministic ids 1..6.
insert into roles (id, name, description) overriding system value values
  (1, 'student',       'Learner: enrolls, learns, submits, earns certificates'),
  (2, 'instructor',    'Authors and delivers internships (internal or external via profile)'),
  (3, 'moderator',     'Approves instructors and internships, moderates content'),
  (4, 'finance_admin', 'Orders, refunds, coupons, settlements, GST reports'),
  (5, 'support',       'Handles support tickets'),
  (6, 'super_admin',   'Full platform control');
select setval(pg_get_serial_sequence('roles', 'id'), 6);

create table user_roles (
  id         bigint generated always as identity primary key,
  user_id    bigint not null references users (id) on delete cascade,  -- ownership child
  role_id    bigint not null references roles (id),
  granted_by bigint references users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_roles_unique unique (user_id, role_id)
);

create table user_sessions (
  id                 bigint generated always as identity primary key,
  user_id            bigint not null references users (id) on delete cascade,  -- ownership child
  refresh_token_hash text not null unique,
  user_agent         text,
  ip_address         inet,
  expires_at         timestamptz not null,
  revoked_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table otp_codes (
  id          bigint generated always as identity primary key,
  user_id     bigint references users (id) on delete cascade,  -- null until account exists (signup OTP)
  destination text not null,                                 -- phone or email the code was sent to
  channel     otp_channel not null,
  purpose     otp_purpose not null,
  code_hash   text not null,
  attempts    smallint not null default 0 check (attempts >= 0),
  expires_at  timestamptz not null,
  consumed_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table instructor_profiles (
  id                            bigint generated always as identity primary key,
  user_id                       bigint not null unique references users (id),
  instructor_type               instructor_type not null default 'external',
  bio                           text,
  expertise                     text[] not null default '{}',
  linkedin_url                  text,
  website_url                   text,
  -- KYC (external only; encrypted values are AES-256-GCM ciphertexts from the API layer)
  kyc_status                    kyc_status not null default 'pending',
  kyc_documents                 jsonb not null default '[]',   -- [{type, bunny_path, uploaded_at}]
  pan_number_encrypted          text,
  gstin                         varchar(15),
  -- Bank (for payouts; also used for stipend payer config later)
  bank_account_name             text,
  bank_account_number_encrypted text,
  bank_account_last4            varchar(4),
  bank_ifsc                     varchar(11),
  -- Agreement & commercials
  agreement_status              agreement_status not null default 'pending',
  agreement_signed_at           timestamptz,
  revenue_share_percent         numeric(5,2) not null default 70.00
                                check (revenue_share_percent >= 0 and revenue_share_percent <= 100),
  rejection_reason              text,
  approved_by                   bigint references users (id),
  approved_at                   timestamptz,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);

-- ============================================================================
-- CATALOG & CONTENT
-- ============================================================================

create table categories (
  id            bigint generated always as identity primary key,
  name          text not null,
  slug          text not null unique,
  description   text,
  icon_url      text,
  display_order integer not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table internships (
  id                    bigint generated always as identity primary key,
  instructor_profile_id bigint not null references instructor_profiles (id),
  category_id           bigint not null references categories (id),
  created_by            bigint not null references users (id),
  title                 text not null,
  slug                  text not null unique,
  short_description     text,
  description           text,
  outcomes              text[] not null default '{}',
  prerequisites         text[] not null default '{}',
  languages             text[] not null default '{english}',
  provider_type         provider_type not null default 'system',
  pricing_type          pricing_type not null default 'free',
  price                 numeric(10,2) not null default 0 check (price >= 0),
  stipend_amount        numeric(10,2) check (stipend_amount >= 0),   -- used only when pricing_type='stipend' (P2 flows)
  currency              char(3) not null default 'INR',
  gst_rate              numeric(4,2) not null default 18.00,
  delivery_mode         delivery_mode not null,
  pace_type             pace_type not null default 'batch',
  duration_weeks        smallint check (duration_weeks > 0),
  thumbnail_url         text,
  promo_bunny_video_id  text,
  certificate_rules     jsonb not null default '{"min_progress_percent": 80, "require_all_mandatory_tasks_approved": true}',
  status                internship_status not null default 'draft',
  rejection_reason      text,
  published_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  -- paid ⇒ price > 0; free/stipend ⇒ price = 0
  constraint internships_pricing_check check ((pricing_type = 'paid' and price > 0) or (pricing_type <> 'paid' and price = 0)),
  -- stipend ⇔ stipend_amount present (keeps the stipend door open with zero future migration pain)
  constraint internships_stipend_check check ((pricing_type = 'stipend') = (stipend_amount is not null))
);

create table internship_batches (
  id                  bigint generated always as identity primary key,
  internship_id       bigint not null references internships (id),
  name                text not null,
  start_date          date not null,
  end_date            date not null,
  enrollment_deadline timestamptz,
  seats_total         integer not null check (seats_total > 0),
  seats_filled        integer not null default 0 check (seats_filled >= 0),
  waitlist_enabled    boolean not null default false,
  waitlist_limit      integer check (waitlist_limit > 0),
  status              batch_status not null default 'scheduled',
  timezone            text not null default 'Asia/Kolkata',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint batches_dates_check check (end_date >= start_date),
  constraint batches_seats_check check (seats_filled <= seats_total)
);

create table curriculum_sections (
  id            bigint generated always as identity primary key,
  internship_id bigint not null references internships (id),
  title         text not null,
  display_order integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table quizzes (
  id                 bigint generated always as identity primary key,
  internship_id      bigint not null references internships (id),
  title              text not null,
  description        text,
  pass_percent       numeric(5,2) not null default 60.00 check (pass_percent >= 0 and pass_percent <= 100),
  time_limit_minutes smallint check (time_limit_minutes > 0),
  max_attempts       smallint not null default 3 check (max_attempts > 0),
  shuffle_questions  boolean not null default false,
  is_published       boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table lessons (
  id               bigint generated always as identity primary key,
  section_id       bigint not null references curriculum_sections (id),
  title            text not null,
  type             lesson_type not null,
  display_order    integer not null default 0,
  duration_minutes smallint check (duration_minutes >= 0),
  bunny_video_id   text,            -- type='video': set when the Bunny Stream video object is created
  video_status     video_status,    -- type='video' lifecycle
  document_url     text,            -- type='document': Bunny Storage path
  quiz_id          bigint references quizzes (id),
  content          text,            -- optional rich notes shown with the lesson
  is_preview       boolean not null default false,
  is_mandatory     boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint lessons_quiz_check check (type <> 'quiz' or quiz_id is not null)
);

create table live_sessions (
  id                  bigint generated always as identity primary key,
  internship_id       bigint not null references internships (id),
  batch_id            bigint references internship_batches (id),
  lesson_id           bigint references lessons (id),       -- curriculum slot this session fulfils
  provider            live_provider not null,
  title               text not null,
  meeting_id          text,
  join_url            text not null,
  passcode            text,
  scheduled_start     timestamptz not null,
  scheduled_end       timestamptz not null,
  status              live_session_status not null default 'scheduled',
  recording_lesson_id bigint references lessons (id),       -- recording uploaded later as a video lesson
  created_by          bigint not null references users (id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint live_sessions_time_check check (scheduled_end > scheduled_start)
);

-- ============================================================================
-- COMMERCE
-- ============================================================================

create table coupons (
  id                  bigint generated always as identity primary key,
  code                text not null unique check (code = upper(code)),
  description         text,
  discount_type       discount_type not null,
  discount_value      numeric(10,2) not null check (discount_value > 0),
  max_discount_amount numeric(10,2) check (max_discount_amount > 0),
  internship_id       bigint references internships (id),    -- null = global coupon
  valid_from          timestamptz,
  valid_until         timestamptz,
  max_redemptions     integer check (max_redemptions > 0),
  redemption_count    integer not null default 0 check (redemption_count >= 0),
  per_user_limit      smallint not null default 1 check (per_user_limit > 0),
  min_order_amount    numeric(10,2) not null default 0,
  is_active           boolean not null default true,
  created_by          bigint references users (id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint coupons_percent_check check (discount_type <> 'percent' or discount_value <= 100)
);

create table orders (
  id               bigint generated always as identity primary key,
  order_no         text not null unique,                  -- e.g. ORD-2026-000001 (seq_order_no)
  user_id          bigint not null references users (id),
  internship_id    bigint not null references internships (id),
  batch_id         bigint references internship_batches (id),
  coupon_id        bigint references coupons (id),
  subtotal         numeric(10,2) not null check (subtotal >= 0),
  discount_amount  numeric(10,2) not null default 0 check (discount_amount >= 0),
  taxable_amount   numeric(10,2) not null check (taxable_amount >= 0),
  gst_rate         numeric(4,2) not null default 18.00,
  gst_amount       numeric(10,2) not null check (gst_amount >= 0),
  total_amount     numeric(10,2) not null check (total_amount >= 0),
  currency         char(3) not null default 'INR',
  status           order_status not null default 'created',
  razorpay_order_id text unique,
  invoice_no       text unique,                           -- GST invoice series (seq_invoice_no)
  invoice_url      text,                                  -- Bunny Storage (private zone)
  billing_name     text,
  billing_email    citext,
  billing_phone    varchar(16),
  billing_state    text,                                  -- GST place of supply
  billing_gstin    varchar(15),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table payments (
  id                  bigint generated always as identity primary key,
  order_id            bigint not null references orders (id),
  razorpay_payment_id text unique,
  razorpay_signature  text,
  amount              numeric(10,2) not null check (amount >= 0),
  currency            char(3) not null default 'INR',
  method              text,                               -- upi | card | netbanking | wallet (as reported)
  status              payment_status not null default 'created',
  captured_at         timestamptz,
  failure_code        text,
  failure_reason      text,
  webhook_payload     jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table refunds (
  id                 bigint generated always as identity primary key,
  order_id           bigint not null references orders (id),
  payment_id         bigint not null references payments (id),
  razorpay_refund_id text unique,
  amount             numeric(10,2) not null check (amount > 0),
  reason             text,
  status             refund_status not null default 'requested',
  requested_by       bigint not null references users (id),
  decided_by         bigint references users (id),
  decided_at         timestamptz,
  rejection_reason   text,
  processed_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- ============================================================================
-- ENROLLMENT & LEARNING
-- ============================================================================

create table enrollments (
  id                bigint generated always as identity primary key,
  user_id           bigint not null references users (id),
  internship_id     bigint not null references internships (id),
  batch_id          bigint references internship_batches (id),   -- null = self-paced
  order_id          bigint references orders (id),               -- null = free enrollment
  status            enrollment_status not null default 'active',
  progress_percent  numeric(5,2) not null default 0 check (progress_percent >= 0 and progress_percent <= 100),
  waitlist_position integer check (waitlist_position > 0),
  enrolled_at       timestamptz not null default now(),
  completed_at      timestamptz,
  dropped_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Integrity (not performance): one live enrollment per user per internship.
create unique index uq_enrollments_user_internship_live
  on enrollments (user_id, internship_id)
  where status <> 'dropped';

create table lesson_progress (
  id              bigint generated always as identity primary key,
  enrollment_id   bigint not null references enrollments (id),
  lesson_id       bigint not null references lessons (id),
  status          progress_status not null default 'in_progress',
  watched_seconds integer not null default 0 check (watched_seconds >= 0),
  completed_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint lesson_progress_unique unique (enrollment_id, lesson_id)
);

create table attendance_records (
  id               bigint generated always as identity primary key,
  live_session_id  bigint not null references live_sessions (id),
  enrollment_id    bigint not null references enrollments (id),
  status           attendance_status not null default 'present',
  joined_at        timestamptz,
  left_at          timestamptz,
  duration_minutes smallint check (duration_minutes >= 0),
  marked_by        bigint references users (id),          -- set when manually marked/overridden
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint attendance_unique unique (live_session_id, enrollment_id)
);

-- ============================================================================
-- QUIZZES (questions & attempts; quiz header is above with content)
-- ============================================================================

create table quiz_questions (
  id              bigint generated always as identity primary key,
  quiz_id         bigint not null references quizzes (id),
  question_text   text not null,
  question_type   question_type not null default 'single_choice',
  options         jsonb not null,                        -- [{"id":"a","text":"..."}, ...]
  correct_options jsonb not null,                        -- ["a"] or ["a","c"]
  explanation     text,
  marks           numeric(5,2) not null default 1 check (marks > 0),
  display_order   integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table quiz_attempts (
  id             bigint generated always as identity primary key,
  quiz_id        bigint not null references quizzes (id),
  enrollment_id  bigint not null references enrollments (id),
  attempt_number smallint not null check (attempt_number > 0),
  status         attempt_status not null default 'in_progress',
  started_at     timestamptz not null default now(),
  submitted_at   timestamptz,
  answers        jsonb not null default '{}',            -- {question_id: ["a","c"], ...}
  score          numeric(7,2),
  max_score      numeric(7,2),
  percent        numeric(5,2),
  passed         boolean,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint quiz_attempts_unique unique (quiz_id, enrollment_id, attempt_number)
);

-- ============================================================================
-- PROJECTS, SUBMISSIONS & REVIEWS
-- ============================================================================

create table projects (
  id            bigint generated always as identity primary key,
  internship_id bigint not null references internships (id),
  title         text not null,
  description   text,
  display_order integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table project_tasks (
  id                       bigint generated always as identity primary key,
  project_id               bigint not null references projects (id),
  week_number              smallint not null check (week_number > 0),
  title                    text not null,
  instructions             text,
  allowed_submission_types submission_type[] not null default '{file,github_url,live_url}',
  max_score                numeric(6,2) not null default 100 check (max_score > 0),
  rubric                   jsonb not null default '[]',  -- [{"criterion","weight","max_points"}, ...]
  due_offset_days          smallint check (due_offset_days >= 0),  -- relative to batch start_date
  is_mandatory             boolean not null default true,
  display_order            integer not null default 0,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create table submissions (
  id              bigint generated always as identity primary key,
  task_id         bigint not null references project_tasks (id),
  enrollment_id   bigint not null references enrollments (id),
  version         smallint not null default 1 check (version > 0),
  submission_type submission_type not null,
  file_url        text,                                  -- Bunny Storage private path (type='file')
  url_value       text,                                  -- github_url | live_url value
  notes           text,
  status          submission_status not null default 'submitted',
  submitted_at    timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint submissions_version_unique unique (task_id, enrollment_id, version),
  constraint submissions_payload_check check (
    (submission_type = 'file' and file_url is not null)
    or (submission_type in ('github_url', 'live_url') and url_value is not null)
  )
);

create table submission_reviews (
  id            bigint generated always as identity primary key,
  submission_id bigint not null unique references submissions (id),  -- one review per submission version
  reviewer_id   bigint not null references users (id),
  rubric_scores jsonb not null default '[]',             -- [{"criterion","points","max_points"}, ...]
  total_score   numeric(6,2),
  decision      review_decision not null,
  feedback      text,
  reviewed_at   timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint reviews_feedback_check check (decision = 'approved' or feedback is not null)
);

-- ============================================================================
-- EARNINGS & PAYOUTS (defined after commerce; settlements before earnings FK)
-- ============================================================================

create table payout_settlements (
  id                    bigint generated always as identity primary key,
  instructor_profile_id bigint not null references instructor_profiles (id),
  settlement_no         text not null unique,            -- e.g. SET-2026-000001 (seq_settlement_no)
  period_start          date not null,
  period_end            date not null,
  gross_amount          numeric(12,2) not null default 0 check (gross_amount >= 0),
  tds_amount            numeric(12,2) not null default 0 check (tds_amount >= 0),
  payable_amount        numeric(12,2) not null default 0 check (payable_amount >= 0),
  status                settlement_status not null default 'initiated',
  utr_number            text,                            -- bank transaction reference
  paid_at               timestamptz,
  initiated_by          bigint not null references users (id),
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint settlements_period_check check (period_end >= period_start)
);

create table instructor_earnings (
  id                    bigint generated always as identity primary key,
  instructor_profile_id bigint not null references instructor_profiles (id),
  internship_id         bigint not null references internships (id),
  order_id              bigint not null references orders (id),
  payment_id            bigint not null unique references payments (id),  -- exactly one earning per captured payment
  enrollment_id         bigint references enrollments (id),
  gross_amount          numeric(10,2) not null check (gross_amount >= 0),     -- net-of-GST order value
  revenue_share_percent numeric(5,2) not null,                               -- snapshot at capture time
  amount                numeric(10,2) not null check (amount >= 0),           -- instructor share
  status                earning_status not null default 'pending',
  available_at          timestamptz,                     -- refund window end
  settlement_id         bigint references payout_settlements (id),
  reversed_at           timestamptz,
  reversal_reason       text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- ============================================================================
-- CERTIFICATES
-- ============================================================================

create table certificates (
  id                bigint generated always as identity primary key,
  certificate_no    text not null unique,                -- GUM-2026-000001 (seq_certificate_no)
  enrollment_id     bigint not null unique references enrollments (id),
  user_id           bigint not null references users (id),
  internship_id     bigint not null references internships (id),
  verification_hash text not null unique,
  pdf_url           text,                                -- Bunny Storage (private; served via signed URL)
  qr_url            text,
  status            certificate_status not null default 'issued',
  metadata          jsonb not null default '{}',         -- immutable snapshot: learner name, title, dates
  issued_at         timestamptz not null default now(),
  revoked_at        timestamptz,
  revoked_reason    text,
  revoked_by        bigint references users (id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ============================================================================
-- NOTIFICATIONS
-- ============================================================================

create table notifications (
  id                  bigint generated always as identity primary key,
  user_id             bigint not null references users (id),
  channel             notification_channel not null,
  template_key        text not null,                     -- e.g. enrollment.confirmed
  title               text,
  body                text,
  data                jsonb not null default '{}',       -- deep-link payload
  status              notification_status not null default 'pending',
  provider_message_id text,
  error_message       text,
  sent_at             timestamptz,
  read_at             timestamptz,                       -- in_app channel
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table notification_preferences (
  id         bigint generated always as identity primary key,
  user_id    bigint not null references users (id) on delete cascade,  -- ownership child
  channel    notification_channel not null,
  category   notification_category not null,             -- transactional cannot be disabled (API-enforced)
  enabled    boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_prefs_unique unique (user_id, channel, category)
);

create table device_tokens (
  id         bigint generated always as identity primary key,
  user_id    bigint not null references users (id) on delete cascade,  -- ownership child
  token      text not null unique,
  platform   text not null check (platform in ('android', 'ios', 'web')),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- SUPPORT & CMS
-- ============================================================================

create table support_tickets (
  id              bigint generated always as identity primary key,
  ticket_no       text not null unique,                  -- TKT-2026-000001 (seq_ticket_no)
  user_id         bigint not null references users (id),
  internship_id   bigint references internships (id),
  category        ticket_category not null default 'other',
  subject         text not null,
  description     text not null,
  attachments     jsonb not null default '[]',           -- [bunny private paths]
  status          ticket_status not null default 'open',
  priority        ticket_priority not null default 'medium',
  assigned_to     bigint references users (id),
  resolution_note text,
  resolved_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table cms_banners (
  id            bigint generated always as identity primary key,
  title         text not null,
  image_url     text not null,
  link_url      text,
  placement     banner_placement not null default 'home_hero',
  display_order integer not null default 0,
  starts_at     timestamptz,
  ends_at       timestamptz,
  is_active     boolean not null default true,
  created_by    bigint references users (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table cms_pages (
  id               bigint generated always as identity primary key,
  slug             text not null unique,
  title            text not null,
  content_md       text not null default '',
  meta_title       text,
  meta_description text,
  is_published     boolean not null default false,
  published_at     timestamptz,
  updated_by       bigint references users (id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ============================================================================
-- AUDIT (immutable: created_at only, no updated_at, no updates expected)
-- ============================================================================

create table audit_logs (
  id          bigint generated always as identity primary key,
  actor_id    bigint references users (id),                -- null = system action
  actor_role  text,
  action      text not null,                             -- e.g. refund.approve, internship.publish
  entity_type text not null,
  entity_id   bigint,
  before_data jsonb,
  after_data  jsonb,
  ip_address  inet,
  user_agent  text,
  created_at  timestamptz not null default now()
);

-- ============================================================================
-- updated_at AUTO-TOUCH TRIGGER (every table that has the column)
-- ============================================================================

create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

do $$
declare t text;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid
    where n.nspname = 'public'
      and c.relkind = 'r'
      and a.attname = 'updated_at'
      and not a.attisdropped
  loop
    execute format(
      'create trigger %I before update on %I for each row execute function set_updated_at()',
      'trg_' || t || '_updated_at', t
    );
  end loop;
end $$;
