-- ============================================================================
-- GUM Internships — 0006_catalog_enroll_pay.sql (modules 2.3 + 2.4 + 2.5)
--
-- Catalog: difficulty level filter, FAQs (content JSON), denormalized
--   enrollment_count for the 'popular' sort (incremented on activation —
--   counters beat count(*) joins at catalog read volume).
-- Enrollments: offer letter number + stored PDF URL.
-- Orders: GST split columns — intra-state sales split into CGST+SGST,
--   inter-state use IGST (decided by billing_state vs GST_HOME_STATE).
-- ============================================================================

create type internship_level as enum ('beginner', 'intermediate', 'advanced');

alter table internships
  add column level            internship_level,
  add column faqs             jsonb not null default '[]',   -- [{"q","a"}]
  add column enrollment_count integer not null default 0 check (enrollment_count >= 0);

-- 'popular' catalog sort
create index idx_internships_popular
  on internships (enrollment_count desc, published_at desc)
  where status = 'published';

alter table enrollments
  add column offer_letter_no  text unique,                   -- OL-2026-000001
  add column offer_letter_url text;

create sequence seq_offer_letter_no start 1;

alter table orders
  add column cgst_amount numeric(10,2) not null default 0,
  add column sgst_amount numeric(10,2) not null default 0,
  add column igst_amount numeric(10,2) not null default 0;

-- coupon per-user-limit checks count a user's captured orders per coupon
create index idx_orders_coupon_user on orders (coupon_id, user_id) where coupon_id is not null;

-- give the seeded internships sensible levels for catalog testing
update internships set level = 'beginner'     where id in (1, 4);
update internships set level = 'intermediate' where id in (2, 3);
