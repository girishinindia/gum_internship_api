-- ============================================================================
-- GUM Internships — 0014 (R6: corporate/B2B, CPD hours, bundles)
-- ============================================================================
-- Runs in the `intern` schema.
--   organizations    — a company buying seats
--   org_members      — people in the org (admin | member)
--   org_seats        — a consumed seat = a member enrolled in an internship
--   org_seat_orders  — B2B seat purchase with GST breakdown + invoice no
--   cpd_entries      — certified-hours ledger (1 per completed enrollment)
--   bundles          — career-track bundles (set of internships at a price)
-- ============================================================================

create table organizations (
  id             bigint generated always as identity primary key,
  owner_user_id  bigint not null references users (id) on delete cascade,
  name           text not null check (char_length(name) between 2 and 200),
  gstin          varchar(20),
  billing_email  text,
  billing_state  text,
  seats_total    integer not null default 0 check (seats_total >= 0),
  about          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index idx_organizations_owner on organizations (owner_user_id);

create table org_members (
  id         bigint generated always as identity primary key,
  org_id     bigint not null references organizations (id) on delete cascade,
  user_id    bigint not null references users (id) on delete cascade,
  role       text not null default 'member',   -- admin | member
  status     text not null default 'active',    -- active | removed
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, user_id),
  check (role in ('admin', 'member')),
  check (status in ('active', 'removed'))
);
create index idx_org_members_org on org_members (org_id);

create table org_seats (
  id             bigint generated always as identity primary key,
  org_id         bigint not null references organizations (id) on delete cascade,
  member_user_id bigint not null references users (id) on delete cascade,
  internship_id  bigint not null references internships (id) on delete cascade,
  enrollment_id  bigint references enrollments (id) on delete set null,
  assigned_by    bigint references users (id),
  created_at     timestamptz not null default now(),
  unique (org_id, member_user_id, internship_id)
);
create index idx_org_seats_org on org_seats (org_id);

-- B2B seat purchase with GST breakdown (reverse-charge handled at billing time)
create table org_seat_orders (
  id             bigint generated always as identity primary key,
  org_id         bigint not null references organizations (id) on delete cascade,
  seats          integer not null check (seats > 0),
  unit_price     numeric(12,2) not null check (unit_price >= 0),
  subtotal       numeric(12,2) not null,
  taxable_amount numeric(12,2) not null,
  gst_rate       numeric(5,2) not null,
  gst_amount     numeric(12,2) not null,
  cgst_amount    numeric(12,2) not null default 0,
  sgst_amount    numeric(12,2) not null default 0,
  igst_amount    numeric(12,2) not null default 0,
  total_amount   numeric(12,2) not null,
  invoice_no     text not null,
  created_by     bigint references users (id),
  created_at     timestamptz not null default now()
);
create index idx_org_seat_orders_org on org_seat_orders (org_id, created_at desc);

create table cpd_entries (
  id            bigint generated always as identity primary key,
  user_id       bigint not null references users (id) on delete cascade,
  enrollment_id bigint not null unique references enrollments (id) on delete cascade,
  internship_id bigint not null references internships (id) on delete cascade,
  hours         numeric(6,2) not null check (hours >= 0),
  note          text,
  created_at    timestamptz not null default now()
);
create index idx_cpd_entries_user on cpd_entries (user_id, created_at desc);

create table bundles (
  id             bigint generated always as identity primary key,
  slug           text not null unique check (slug = lower(slug)),
  name           text not null,
  description    text,
  internship_ids bigint[] not null default '{}',
  price          numeric(12,2) not null default 0 check (price >= 0),
  currency       char(3) not null default 'INR',
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create trigger trg_organizations_updated_at before update on organizations
  for each row execute function set_updated_at();
create trigger trg_org_members_updated_at before update on org_members
  for each row execute function set_updated_at();
create trigger trg_bundles_updated_at before update on bundles
  for each row execute function set_updated_at();

alter table organizations   enable row level security;
alter table org_members     enable row level security;
alter table org_seats       enable row level security;
alter table org_seat_orders enable row level security;
alter table cpd_entries     enable row level security;
alter table bundles         enable row level security;
