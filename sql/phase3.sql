-- ================================================================
-- PM Pull — Phase 3. Paste into Supabase -> SQL Editor -> Run.
-- Safe to re-run. Only ADDS columns/tables; nothing is dropped or rewritten.
-- Run this AFTER sql/phase2.sql and kasani_requests.sql.
-- ================================================================

-- ----------------------------------------------------------------
-- 1) consignments: the goods-received paperwork the warehouse actually fills
--    (`ts` already stamps the insert; `received_at` is the business receipt time,
--     which is what the GR screen shows and what leadership reports on)
-- ----------------------------------------------------------------
alter table consignments add column if not exists received_at    timestamptz default now();
alter table consignments add column if not exists po_no          text;   -- Purchase Order No.
alter table consignments add column if not exists grn_no         text;   -- filled later by leadership
alter table consignments add column if not exists grn_date       date;   -- filled later by leadership
alter table consignments add column if not exists invoice_date   date;
alter table consignments add column if not exists transferred_to text;   -- vehicle / bay, e.g. WB11C
alter table consignments add column if not exists barcode_ref    text;   -- e.g. SJ-81
alter table consignments add column if not exists qty_entered    numeric;-- what was typed, before unit conversion
alter table consignments add column if not exists unit_variant   text;   -- 'default' | 'small' | 'big' | 'box' | 'bundle'
alter table consignments add column if not exists sample_sent_at timestamptz;
alter table consignments add column if not exists cleared_at     timestamptz;
alter table consignments add column if not exists reject_reason  text;

-- backfill the new receipt time from the existing insert timestamp
update consignments set received_at = ts where received_at is null;

create index if not exists consignments_grn_idx      on consignments (grn_no);
create index if not exists consignments_received_idx on consignments (received_at desc);

-- status stays: 'pending' | 'cleared' | 'rejected', with the sample_sent flag on top.
-- The Stock Status screen shows:
--   pending + sample_sent = false  ->  RED    "Quality pending"
--   pending + sample_sent = true   ->  ORANGE "Sample sent"
--   cleared                        ->  GREEN  "Cleared"
--   rejected                       ->  RED    "Blocked / rejected"

-- ----------------------------------------------------------------
-- 2) pack_config — ONE table doing two jobs:
--    a) how many BASE units are in one entry unit  (base_per_unit)
--       e.g. 1 big laminate roll = 450 kg
--    b) how many of that unit fill 100% of a truck (truck_full_qty)
--       e.g. 3 big rolls fill a truck
--    Edit both in Kasani -> Truck & unit settings. NULL = "not set yet".
-- ----------------------------------------------------------------
create table if not exists pack_config (
  packmat        text not null,              -- carton | cld | sac | laminate
  variant        text not null default 'default',
  unit_label     text,                       -- what the worker sees in the Unit dropdown
  base_unit      text,                       -- the base unit this converts into (pcs | kg)
  base_per_unit  numeric,                    -- base units in ONE of these (1 for the base unit itself)
  truck_full_qty numeric,                    -- how many of these = 100% of a truck
  sort_order     int default 0,
  primary key (packmat, variant)
);

insert into pack_config (packmat, variant, unit_label, base_unit, base_per_unit, truck_full_qty, sort_order) values
  ('cld',      'default', 'case',         'pcs', 1,    null, 1),
  ('cld',      'bundle',  'bundle (10)',  'pcs', 10,   null, 2),
  ('carton',   'default', 'pcs',          'pcs', 1,    null, 3),
  ('carton',   'box',     'box',          'pcs', null, null, 4),
  ('laminate', 'default', 'kg',           'kg',  1,    null, 5),
  ('laminate', 'small',   'roll (small)', 'kg',  null, null, 6),
  ('laminate', 'big',     'roll (big)',   'kg',  null, null, 7),
  ('sac',      'default', 'pcs',          'pcs', 1,    null, 8),
  ('sac',      'small',   'bag (small)',  'pcs', null, null, 9),
  ('sac',      'big',     'bag (big)',    'pcs', null, null, 10),
  ('divider',  'default', 'pcs',          'pcs', 1,    null, 11)
on conflict (packmat, variant) do nothing;

-- ----------------------------------------------------------------
-- 3) dispatches: ILT hand-off + which shift the truck serves
-- ----------------------------------------------------------------
alter table dispatches add column if not exists shift        text;   -- 'A' | 'B' | 'C' | 'A/B' ...
alter table dispatches add column if not exists ilt_sent_at  timestamptz;
alter table dispatches add column if not exists note         text;
alter table dispatches add column if not exists vehicle_no   text;

-- ----------------------------------------------------------------
-- 4) kasani_requests: link a PM-store ask to the truck that served it
--    status gains 'dispatched' (still plain text, no constraint to change)
-- ----------------------------------------------------------------
alter table kasani_requests add column if not exists dispatch_id   bigint;
alter table kasani_requests add column if not exists dispatched_at timestamptz;
create index if not exists kasani_requests_dispatch_idx on kasani_requests (dispatch_id);

-- ----------------------------------------------------------------
-- 5) RLS for the new table (pilot-open, same as the rest)
-- ----------------------------------------------------------------
alter table pack_config enable row level security;
drop policy if exists "pilot all" on pack_config;
create policy "pilot all" on pack_config for all using (true) with check (true);

-- ----------------------------------------------------------------
-- Check it worked:
--   select packmat, variant, unit_label, base_per_unit, truck_full_qty
--     from pack_config order by sort_order;
-- Expect 11 rows, with NULLs where you still have to type the real numbers.
-- ----------------------------------------------------------------
