-- ================================================================
-- Run this ONCE in Supabase -> SQL Editor (adds machine line + requests).
-- Safe to run even if some already exist.
-- ================================================================

-- 1) add machine line to ledger (issues record which line)
alter table ledger add column if not exists line text;

-- 2) requests table (line calls the store fulfils). Empty until an HMI/manual feed adds rows.
create table if not exists requests (
  id        bigint generated always as identity primary key,
  ts        timestamptz default now(),
  line      text,
  sku_code  text,
  packmat   text,
  qty_base  numeric,
  shift     text,
  status    text default 'open'   -- open | done
);
alter table requests enable row level security;
drop policy if exists "pilot all" on requests;
create policy "pilot all" on requests for all using (true) with check (true);

-- 3) (optional) if you want sac FG-conversion accurate, add a sac weight per SKU:
alter table skus add column if not exists sac_kg numeric;
-- then set it where known, e.g.:  update skus set sac_kg = 24 where outer_type = 'sac';
