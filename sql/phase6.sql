-- ================================================================
-- PM Pull — Phase 6.  Paste into Supabase -> SQL Editor -> Run.
-- Safe to re-run.
-- ================================================================

-- ----------------------------------------------------------------
-- 1) FIX: "Could not find the 'divider' column of 'skus' in the schema cache"
--
--    That message comes from PostgREST, not Postgres. It means one of two things:
--      (a) the column really is missing — the table was recreated at some point
--          without it (deleting ROWS never drops a column), or
--      (b) the column exists but PostgREST is still serving a stale schema cache
--          after a DDL change.
--    The block below covers both: add anything missing, then force the cache reload.
-- ----------------------------------------------------------------
alter table skus add column if not exists divider      boolean default false;
alter table skus add column if not exists sac_kg       numeric;
alter table skus add column if not exists add_req      text;
alter table skus add column if not exists description  text;
alter table skus add column if not exists weight       int;
alter table skus add column if not exists primary_type text;
alter table skus add column if not exists outer_type   text;
alter table skus add column if not exists primary_code text;
alter table skus add column if not exists outer_code   text;

-- any rows that predate the column
update skus set divider = false where divider is null;

-- (b): make PostgREST forget the cached schema and re-read it
notify pgrst, 'reload schema';

-- Confirm every column the SKU import writes is really there.
-- Expect 9 rows: code, description, weight, primary_type, outer_type,
--                primary_code, outer_code, divider, sac_kg (+ add_req).
--   select column_name, data_type
--     from information_schema.columns
--    where table_name = 'skus'
--    order by ordinal_position;
--
-- If the error persists after this, the schema cache did not reload:
-- Supabase Dashboard -> Settings -> API -> "Restart server", then retry the upload.

-- ----------------------------------------------------------------
-- 2) PM store: returns now record which line sent the material back,
--    so leadership can see return rate per line. `line` already exists
--    on ledger (migration_v2); this is just the index for the analytics.
-- ----------------------------------------------------------------
create index if not exists ledger_line_idx on ledger (line, direction, ts desc);
create index if not exists ledger_dir_ts_idx on ledger (direction, ts desc);

-- ----------------------------------------------------------------
-- Nothing else changes. No new tables in this phase.
-- ----------------------------------------------------------------
