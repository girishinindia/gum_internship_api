-- 0017 — Record when an account was erased (DPDP right to erasure). Anonymisation
-- sets status='deleted' and nulls PII; deleted_at marks the time for audit.
set search_path = intern, public;
alter table users add column if not exists deleted_at timestamptz;
