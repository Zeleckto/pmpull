-- ================================================================
-- Kasani requests  (PM Store  ->  Kasani warehouse dispatch)
-- Run ONCE in Supabase -> SQL Editor.  Safe to re-run.
-- Nothing here alters your existing tables (skus / ledger / conversion / requests).
-- ================================================================

create table if not exists kasani_requests (
  id           bigint generated always as identity primary key,
  ts           timestamptz default now(),

  plan_date    date,          -- the phasing day this ask belongs to
  sku_code     text,
  packmat      text,          -- carton | cld | sac | laminate | divider
  qty_base     numeric,       -- the ask, in BASE units (pcs / pcs / pcs / kg)
  unit         text,          -- unit the user actually typed ('pcs' | 'bundles' | 'kg')
  qty_entered  numeric,       -- what they typed, before conversion to base

  shift        text,          -- 'A' | 'B' | 'C'  -- when it is needed
  priority     int,           -- 1 = A (now), 2 = B, 3 = C   -- dispatch order
  source       text default 'manual',   -- 'phasing' | 'manual'

  -- audit of how the number was arrived at (null for manual asks)
  demand_t     numeric,       -- planned FG tonnes for that SKU/shift
  need_base    numeric,       -- theoretical base units that demand needs
  onhand_base  numeric,       -- PM-store on-hand available to that shift at ask time

  status       text default 'open',    -- open | sent | received | cancelled
  note         text
);

-- Kasani picks work off this: open asks, most urgent shift first, oldest first.
create index if not exists kasani_requests_open_idx
  on kasani_requests (status, priority, ts);

alter table kasani_requests enable row level security;
drop policy if exists "pilot all" on kasani_requests;
create policy "pilot all" on kasani_requests for all using (true) with check (true);
