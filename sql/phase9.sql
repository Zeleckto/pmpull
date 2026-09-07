-- ================================================================
-- PM Pull — Phase 9.  Separates the two planning inputs and lets the
-- daily production report be booked per line.
-- Paste into Supabase -> SQL Editor -> Run. Safe to re-run.
-- ================================================================

-- ----------------------------------------------------------------
-- 1) production = the DPR (daily production report), one upload per shift.
--    `line` is optional: with it, packmat loss is worked out per line;
--    without it, loss is per SKU across the whole shift.
-- ----------------------------------------------------------------
alter table production add column if not exists line text;
create index if not exists production_shift_idx on production (plan_date, shift, line);

-- ----------------------------------------------------------------
-- 2) phasing holds BOTH plans, told apart by `horizon`:
--
--      horizon = 'day'   SKU + tonnes + shift (A/B/C), for ONE date.
--                        Checked against PM STORE inventory only.
--      horizon = 'week'  SKU + tonnes, no shift. plan_date = week start.
--                        Checked against PM STORE + KASANI inventory.
--
--    Uploading a date replaces only that horizon, so loading today's daily
--    plan never wipes the weekly one and vice versa.
-- ----------------------------------------------------------------
update phasing set horizon = 'day' where horizon is null;
create index if not exists phasing_horizon_idx on phasing (horizon, plan_date);

notify pgrst, 'reload schema';

-- ----------------------------------------------------------------
-- Check:
--   select horizon, plan_date, count(*) from phasing group by 1,2 order by 2 desc;
--   select plan_date, shift, line, count(*) from production group by 1,2,3 order by 1 desc;
-- ----------------------------------------------------------------
