-- ============================================================================
-- GUM Internships — 0005_auth_users.sql (module 2.2 deltas)
--
-- 1. Signup flow: accounts start as 'pending_verification' and activate on
--    the first successful email/phone OTP verification.
-- 2. Student profile: education-vs-employed track + resume URL (the actual
--    upload presign lives in the media module; this is just the stored path).
-- 3. OTP throttling: plain (destination, created_at) index so the
--    3-per-hour-per-identifier rule can count consumed AND unconsumed codes
--    (the partial index from 0002 only covers unconsumed lookups).
-- ============================================================================

alter type user_status add value if not exists 'pending_verification';

create type user_track as enum ('education', 'employed');

alter table users
  add column track      user_track,
  add column resume_url text;

create index idx_otp_codes_destination_created
  on otp_codes (destination, created_at desc);
