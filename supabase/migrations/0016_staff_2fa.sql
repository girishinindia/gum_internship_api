-- 0016 — Staff two-factor auth (TOTP). Additive, nullable/defaulted: existing
-- logins are unaffected until a staff member enrols.
set search_path = intern, public;

alter table users
  add column if not exists totp_secret       text,                              -- encrypted base32 secret
  add column if not exists totp_enabled       boolean not null default false,
  add column if not exists totp_backup_codes  text[]  not null default '{}';     -- sha256 hashes of one-time codes
