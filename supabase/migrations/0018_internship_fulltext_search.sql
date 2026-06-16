-- 0018 — Full-text search for the catalog. Weighted tsvector (title > short
-- description > description) maintained automatically as a generated column,
-- with a GIN index. Replaces the previous ILIKE catalog search.
set search_path = intern, public;

alter table internships add column if not exists search_tsv tsvector
  generated always as (
    setweight(to_tsvector('english'::regconfig, coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english'::regconfig, coalesce(short_description, '')), 'B') ||
    setweight(to_tsvector('english'::regconfig, coalesce(description, '')), 'C')
  ) stored;

create index if not exists idx_internships_search on internships using gin (search_tsv);
