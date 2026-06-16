-- 0019 — Per-organisation white-label branding.
set search_path = intern, public;
alter table organizations
  add column if not exists brand_name    text,
  add column if not exists logo_url      text,
  add column if not exists primary_color text,
  add column if not exists support_email text,
  add column if not exists custom_domain text;
create unique index if not exists idx_org_custom_domain on organizations (lower(custom_domain)) where custom_domain is not null;
