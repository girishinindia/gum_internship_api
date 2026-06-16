-- ============================================================================
-- GUM Internships — 0008 (R1: portfolios, credential wallet, scholarships)
-- ============================================================================
-- Adds:
--   1. portfolios            — 1:1 with users; public handle + visibility +
--                              privacy toggles + social links (R1-S1/S2/S4)
--   2. coupon scholarship     — coupon_kind + assigned_user_id + eligibility
--                              note, extending the existing coupon engine (R1-S5)
-- Runs in the `intern` schema (search_path is pinned by the API pool and by the
-- migration session). set_updated_at() already exists from 0001.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Portfolios (credential wallet + resume source)
-- ----------------------------------------------------------------------------
create type portfolio_visibility as enum ('private', 'unlisted', 'public');

create table portfolios (
  id                bigint generated always as identity primary key,
  user_id           bigint not null unique references users (id) on delete cascade,
  -- public lookup key (never the raw id): 4–40 chars, lowercase, slug-safe
  handle            text not null unique
                      check (handle = lower(handle)
                             and handle ~ '^[a-z0-9][a-z0-9-]{2,38}[a-z0-9]$'),
  headline          text check (char_length(headline) <= 160),
  bio               text check (char_length(bio) <= 2000),
  location          text check (char_length(location) <= 120),
  visibility        portfolio_visibility not null default 'private',
  -- privacy toggles (DPDP): granular control over what the public page renders
  show_certificates boolean not null default true,
  show_projects     boolean not null default true,
  show_contact      boolean not null default false,
  -- social/external links: { github, linkedin, website, twitter }
  links             jsonb not null default '{}',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- public page resolves by handle, but only when visibility <> 'private'
create index idx_portfolios_public_handle
  on portfolios (handle)
  where visibility <> 'private';

create trigger trg_portfolios_updated_at
  before update on portfolios
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- 2. Scholarships — targeted coupons issued to a specific student
-- ----------------------------------------------------------------------------
-- 'standard'    — the existing generic coupon behaviour (default)
-- 'scholarship' — issued to ONE student; only that user can redeem it
create type coupon_kind as enum ('standard', 'scholarship');

alter table coupons
  add column kind             coupon_kind not null default 'standard',
  add column assigned_user_id bigint references users (id),
  add column eligibility_note text;

-- a scholarship MUST be bound to a student; a standard coupon MUST NOT be
alter table coupons
  add constraint coupons_scholarship_assignment
  check (
    (kind = 'scholarship' and assigned_user_id is not null)
    or (kind = 'standard' and assigned_user_id is null)
  );

-- fast lookup of a student's scholarship offers
create index idx_coupons_assigned_user
  on coupons (assigned_user_id)
  where assigned_user_id is not null;

-- ----------------------------------------------------------------------------
-- 3. RLS — default-deny on new table (API uses service role; defense-in-depth)
-- ----------------------------------------------------------------------------
alter table portfolios enable row level security;
-- No anon/authenticated policy: the public wallet is served BY THE API
-- (service role), which applies the visibility check in the service layer.
-- Direct anon/authenticated access stays denied even if a key leaks.
