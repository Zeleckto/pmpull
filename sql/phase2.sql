-- ================================================================
-- PM Pull — Phase 2 tables. Paste into Supabase -> SQL Editor -> Run.
-- Safe to re-run (uses IF NOT EXISTS). Does not touch existing tables.
-- ================================================================

-- Daily finished-goods produced (the other half of the loss calc)
create table if not exists production (
  id        bigint generated always as identity primary key,
  ts        timestamptz default now(),
  plan_date date,
  sku_code  text,
  tonnes    numeric,
  shift     text
);

-- Kasani live inventory (goods received + location + quality status)
create table if not exists consignments (
  id            bigint generated always as identity primary key,
  ts            timestamptz default now(),
  invoice       text,
  sku_code      text,
  packmat       text,        -- carton | cld | sac | laminate | divider
  packmat_code  text,        -- snapshot of the material code
  qty_base      numeric,     -- base units
  unit          text,        -- what was typed
  floor         text,        -- 'Ground' | 'First'
  location      text,        -- e.g. 'Ground' or 'First A-12'
  status        text default 'pending',   -- pending | cleared | rejected
  sample_sent   boolean default false,
  supplier      text,
  note          text
);
create index if not exists consignments_stock_idx on consignments (sku_code, packmat, status);

-- Truck dispatches (phasing-sequenced load plan)
create table if not exists dispatches (
  id         bigint generated always as identity primary key,
  ts         timestamptz default now(),
  plan_date  date,
  truck_no   int,
  challan    text,
  lines      jsonb,          -- [{sku_code, packmat, qty_base, from_location, shift}]
  fill_pct   numeric,
  ilt_done   boolean default false,
  status     text default 'planned'   -- planned | dispatched
);

-- Line -> allowed weights/pack types (optional; lets BCE screen filter SKUs by line)
create table if not exists lines_map (
  line      text primary key,
  weights   text,            -- comma list e.g. '250,500'
  primary_type text,         -- carton | laminate
  outer_type   text          -- cld | sac
);

-- Row Level Security: pilot-open (tighten with real auth before wider rollout)
alter table production   enable row level security;
alter table consignments enable row level security;
alter table dispatches   enable row level security;
alter table lines_map    enable row level security;
drop policy if exists "pilot all" on production;
drop policy if exists "pilot all" on consignments;
drop policy if exists "pilot all" on dispatches;
drop policy if exists "pilot all" on lines_map;
create policy "pilot all" on production   for all using (true) with check (true);
create policy "pilot all" on consignments for all using (true) with check (true);
create policy "pilot all" on dispatches   for all using (true) with check (true);
create policy "pilot all" on lines_map    for all using (true) with check (true);

-- ---------------------------------------------------------------
-- OPTIONAL: auto-delete rows older than N days (keep DB small).
-- Leave commented for the pilot (you want history for the demo).
-- Needs the pg_cron extension (Dashboard -> Database -> Extensions -> enable pg_cron).
-- Then uncomment and run:
-- select cron.schedule('purge_old', '0 2 * * *', $$
--   delete from ledger      where ts < now() - interval '30 days';
--   delete from production   where ts < now() - interval '30 days';
--   delete from dispatches   where ts < now() - interval '30 days';
-- $$);
-- ---------------------------------------------------------------

-- OPTIONAL demo reset (keeps master data, clears transactions):
-- truncate ledger, requests, kasani_requests, production, consignments, dispatches restart identity;
