-- ================================================================
-- PM Pull — Phase 5. Paste into Supabase -> SQL Editor -> Run.
-- Safe to re-run. Mostly tidies pack_config to match how Kasani actually counts.
-- Run after sql/phase4.sql.
-- ================================================================

-- ----------------------------------------------------------------
-- 1) Units, corrected.
--    carton   — a box holds a variable number of cartons, so there is no useful
--               "box" unit. Count pcs and nothing else.
--    cld      — pcs (1) or bundle (10). "case" was a confusing name for the same thing.
--    laminate — kg, or rolls (roll weight varies by size, so it is a variant).
--    sac      — pcs, plus whatever bundle sizes you actually use. 100 vs 300 per bundle
--               depends on zipper / non-zipper / size, so these are variants YOU add and
--               name in Kasani -> Truck & unit settings rather than anything hard-coded.
-- ----------------------------------------------------------------
update pack_config set unit_label = 'pcs'  where packmat = 'cld'      and variant = 'default';
update pack_config set unit_label = 'kg'   where packmat = 'laminate' and variant = 'default';
update pack_config set unit_label = 'pcs'  where packmat = 'carton'   and variant = 'default';
update pack_config set unit_label = 'pcs'  where packmat = 'sac'      and variant = 'default';

-- a box has a variable carton count — drop it rather than pretend it is a fixed unit
delete from pack_config where packmat = 'carton' and variant = 'box';

-- the seeded sac bundle sizes are guesses; name them yourself in settings instead
delete from pack_config
 where packmat = 'sac' and variant in ('small', 'big')
   and base_per_unit is null and truck_full_qty is null;

-- ----------------------------------------------------------------
-- 2) Dispatch challan. `challan` already exists from phase 2; make sure the
--    ILT timestamp and vehicle are there too (phase 3/4 added most of these).
-- ----------------------------------------------------------------
alter table dispatches add column if not exists challan       text;
alter table dispatches add column if not exists dispatched_at timestamptz;
create index if not exists dispatches_status_idx on dispatches (status, plan_date desc);

-- ----------------------------------------------------------------
-- Check it worked:
--   select packmat, variant, unit_label, base_unit, base_per_unit, truck_full_qty
--     from pack_config order by sort_order;
-- carton/cld/sac should read 'pcs', laminate 'kg', plus cld 'bundle (10)'
-- and the laminate roll variants. Add your own sac bundles in the settings screen.
-- ----------------------------------------------------------------
