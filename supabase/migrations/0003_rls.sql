-- ============================================================================
-- GUM Internships — 0003_rls.sql
--
-- ACCESS-MODEL ASSUMPTION (read this first):
-- The Express API is the ONLY data-plane client. It connects with the
-- Supabase SERVICE ROLE, which BYPASSES RLS entirely. End users never talk
-- to PostgREST/Supabase directly — all authorization (ownership checks,
-- role guards) is enforced in the API's service layer.
--
-- RLS here is DEFENSE-IN-DEPTH: if the anon or authenticated key ever leaks
-- into a client bundle, the blast radius is zero on PII/finance tables and
-- read-only-public on marketing/catalog tables.
--
-- Strategy:
--   1. Enable RLS on EVERY table. With RLS enabled and no policy, anon and
--      authenticated get NOTHING (default-deny). The service role is
--      unaffected.
--   2. Add narrow anon SELECT policies ONLY for data that is public anyway
--      (active categories, published internships and their outline, active
--      banners, published pages).
--   3. No INSERT/UPDATE/DELETE policy exists for anon/authenticated anywhere.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Default-deny: enable RLS on all tables
-- ----------------------------------------------------------------------------

alter table users                    enable row level security;
alter table roles                    enable row level security;
alter table user_roles               enable row level security;
alter table user_sessions            enable row level security;
alter table otp_codes                enable row level security;
alter table instructor_profiles     enable row level security;
alter table categories               enable row level security;
alter table internships              enable row level security;
alter table internship_batches       enable row level security;
alter table curriculum_sections      enable row level security;
alter table quizzes                  enable row level security;
alter table lessons                  enable row level security;
alter table live_sessions            enable row level security;
alter table coupons                  enable row level security;
alter table orders                   enable row level security;
alter table payments                 enable row level security;
alter table refunds                  enable row level security;
alter table enrollments              enable row level security;
alter table lesson_progress          enable row level security;
alter table attendance_records       enable row level security;
alter table quiz_questions           enable row level security;
alter table quiz_attempts            enable row level security;
alter table projects                 enable row level security;
alter table project_tasks            enable row level security;
alter table submissions              enable row level security;
alter table submission_reviews       enable row level security;
alter table payout_settlements       enable row level security;
alter table instructor_earnings      enable row level security;
alter table certificates             enable row level security;
alter table notifications            enable row level security;
alter table notification_preferences enable row level security;
alter table device_tokens            enable row level security;
alter table support_tickets          enable row level security;
alter table cms_banners              enable row level security;
alter table cms_pages                enable row level security;
alter table audit_logs               enable row level security;

-- Belt-and-braces on the most sensitive tables: FORCE applies RLS even to the
-- table owner (service role still bypasses via BYPASSRLS privilege).
alter table users                force row level security;
alter table otp_codes            force row level security;
alter table user_sessions        force row level security;
alter table instructor_profiles  force row level security;
alter table orders               force row level security;
alter table payments             force row level security;
alter table refunds              force row level security;
alter table instructor_earnings  force row level security;
alter table payout_settlements   force row level security;
alter table audit_logs           force row level security;

-- ----------------------------------------------------------------------------
-- 2. Public read policies (anon + authenticated) for genuinely public data
-- ----------------------------------------------------------------------------

-- Active categories are public catalog chrome.
create policy public_read_categories on categories
  for select to anon, authenticated
  using (is_active);

-- Published internships are the public catalog.
create policy public_read_internships on internships
  for select to anon, authenticated
  using (status = 'published');

-- Batches of published internships (seat availability on detail pages).
create policy public_read_batches on internship_batches
  for select to anon, authenticated
  using (
    exists (
      select 1 from internships i
      where i.id = internship_batches.internship_id
        and i.status = 'published'
    )
  );

-- Curriculum OUTLINE of published internships (titles/structure; lesson
-- content URLs are minted by the API only, never stored as public secrets).
create policy public_read_sections on curriculum_sections
  for select to anon, authenticated
  using (
    exists (
      select 1 from internships i
      where i.id = curriculum_sections.internship_id
        and i.status = 'published'
    )
  );

create policy public_read_lessons on lessons
  for select to anon, authenticated
  using (
    exists (
      select 1 from curriculum_sections s
      join internships i on i.id = s.internship_id
      where s.id = lessons.section_id
        and i.status = 'published'
    )
  );

-- Live banners and published CMS pages are public marketing content.
create policy public_read_banners on cms_banners
  for select to anon, authenticated
  using (
    is_active
    and (starts_at is null or starts_at <= now())
    and (ends_at   is null or ends_at   >= now())
  );

create policy public_read_pages on cms_pages
  for select to anon, authenticated
  using (is_published);

-- Role catalog is harmless reference data.
create policy public_read_roles on roles
  for select to anon, authenticated
  using (true);

-- ----------------------------------------------------------------------------
-- 3. Explicitly NO policies for anything else.
-- users, otp_codes, user_sessions, user_roles, instructor_profiles, coupons,
-- orders, payments, refunds, enrollments, lesson_progress, attendance_records,
-- quizzes, quiz_questions (answers!), quiz_attempts, projects, project_tasks,
-- submissions, submission_reviews, instructor_earnings, payout_settlements,
-- certificates (verification is API-mediated to rate-limit scraping),
-- notifications, notification_preferences, device_tokens, support_tickets,
-- live_sessions (join URLs are gated), audit_logs
-- → default-deny for anon/authenticated. The API (service role) is the only
--   reader/writer.
-- ----------------------------------------------------------------------------
