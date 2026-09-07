-- ================================================================
-- PM Pull — Phase 8.  Phasing plan + shift production, for real analytics.
-- Paste into Supabase -> SQL Editor -> Run. Safe to re-run.
-- ================================================================

-- ----------------------------------------------------------------
-- 1) phasing — the demand plan. One row per SKU per shift per day.
--
--    SIZE: a row is ~60 bytes of data; with row overhead and indexes call it
--    ~200 bytes. 200 SKUs x 3 shifts = 600 rows/day = ~120 KB/day = ~44 MB/year.
--    Supabase free tier is 500 MB, so a year of phasing is under 10% of it.
--    Keep it. If you ever want to trim, the purge job at the bottom of
--    sql/phase2.sql deletes anything older than N days.
-- ----------------------------------------------------------------
create table if not exists phasing (
  id        bigint generated always as identity primary key,
  ts        timestamptz default now(),
  plan_date date not null,
  shift     text,                    -- 'A' | 'B' | 'C', or null for a whole-day figure
  sku_code  text,
  tonnes    numeric,
  horizon   text default 'day'       -- 'day' | 'week'
);
create index if not exists phasing_date_idx  on phasing (plan_date, shift);
create index if not exists phasing_sku_idx   on phasing (sku_code, plan_date);

alter table phasing enable row level security;
drop policy if exists "pilot all" on phasing;
create policy "pilot all" on phasing for all using (true) with check (true);

-- ----------------------------------------------------------------
-- 2) production — FG actually made. `shift` already exists from phase 2;
--    these indexes make the per-shift loss report quick.
-- ----------------------------------------------------------------
alter table production add column if not exists shift text;
create index if not exists production_date_idx on production (plan_date, shift);
create index if not exists production_sku_idx  on production (sku_code, plan_date);

-- ----------------------------------------------------------------
-- 3) Shift boundaries are IST and fixed:
--      A = 06:00–14:00,  B = 14:00–22:00,  C = 22:00–06:00 (next day)
--    A movement at 01:00 belongs to the PREVIOUS day's C shift. The app does
--    this conversion when it reads `ledger.ts`, so nothing is stored twice.
--
--    These indexes are what make "issued this shift" fast.
-- ----------------------------------------------------------------
create index if not exists ledger_ts_idx on ledger (ts desc);

-- ----------------------------------------------------------------
-- Check:
--   select count(*) from phasing;
--   select pg_size_pretty(pg_database_size(current_database()));
-- ----------------------------------------------------------------
