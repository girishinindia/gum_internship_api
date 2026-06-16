-- ============================================================================
-- GUM Internships — 0013 (R5: career outcomes — employers, jobs, applications)
-- ============================================================================
-- Runs in the `intern` schema.
--
-- IMPORTANT: the new 'employer' role_name enum value must be COMMITTED before
-- it is used. Apply in two steps:
--   Step A:  alter type role_name add value if not exists 'employer';   (commit)
--   Step B:  everything below (insert role + tables).
-- ============================================================================

-- ---- Step A (run + commit first) -------------------------------------------
-- alter type role_name add value if not exists 'employer';

-- ---- Step B ----------------------------------------------------------------
insert into roles (name, description)
  values ('employer', 'Posts jobs and reviews applicants')
  on conflict (name) do nothing;

-- Employers (one profile per owning user)
create table employers (
  id            bigint generated always as identity primary key,
  user_id       bigint not null unique references users (id) on delete cascade,
  company_name  text not null check (char_length(company_name) between 2 and 200),
  website       text,
  about         text check (char_length(about) <= 4000),
  logo_url      text,
  contact_email text,
  contact_phone text,
  gstin         varchar(20),
  kyc_status    text not null default 'pending',   -- pending | submitted | verified | rejected
  agreement_status text not null default 'pending',-- pending | accepted
  rejection_reason text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (kyc_status in ('pending', 'submitted', 'verified', 'rejected')),
  check (agreement_status in ('pending', 'accepted'))
);

-- Jobs
create table jobs (
  id              bigint generated always as identity primary key,
  employer_id     bigint not null references employers (id) on delete cascade,
  title           text not null check (char_length(title) between 3 and 200),
  description     text not null check (char_length(description) between 10 and 12000),
  location        text,
  work_mode       text not null default 'remote',       -- remote | onsite | hybrid
  employment_type text not null default 'internship',   -- internship | full_time | part_time | contract
  stipend_min     numeric(12,2),
  stipend_max     numeric(12,2),
  currency        char(3) not null default 'INR',
  skills          text[] not null default '{}',
  status          text not null default 'draft',          -- draft | pending_review | published | rejected | closed
  rejection_reason text,
  published_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (work_mode in ('remote', 'onsite', 'hybrid')),
  check (employment_type in ('internship', 'full_time', 'part_time', 'contract')),
  check (status in ('draft', 'pending_review', 'published', 'rejected', 'closed'))
);
create index idx_jobs_public on jobs (published_at desc) where status = 'published';
create index idx_jobs_employer on jobs (employer_id, created_at desc);

-- Applications (one per user per job)
create table job_applications (
  id               bigint generated always as identity primary key,
  job_id           bigint not null references jobs (id) on delete cascade,
  user_id          bigint not null references users (id) on delete cascade,
  status           text not null default 'applied',  -- applied | shortlisted | interview | offered | rejected | withdrawn
  portfolio_handle text,
  resume_url       text,
  cover_note       text check (char_length(cover_note) <= 4000),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (job_id, user_id),
  check (status in ('applied', 'shortlisted', 'interview', 'offered', 'rejected', 'withdrawn'))
);
create index idx_job_applications_job on job_applications (job_id, created_at desc);
create index idx_job_applications_user on job_applications (user_id, created_at desc);

create trigger trg_employers_updated_at before update on employers
  for each row execute function set_updated_at();
create trigger trg_jobs_updated_at before update on jobs
  for each row execute function set_updated_at();
create trigger trg_job_applications_updated_at before update on job_applications
  for each row execute function set_updated_at();

alter table employers        enable row level security;
alter table jobs             enable row level security;
alter table job_applications enable row level security;
