-- ================================================================
-- PM Pull — Phase 12.  The 19-week production plan, for expiry risk.
-- Paste into Supabase -> SQL Editor -> Run. Safe to re-run.
-- ================================================================

-- No new table. The long-range plan lives in `phasing` alongside the daily and
-- weekly ones, told apart by horizon:
--     horizon = 'day'   one date, split A/B/C   -> PM store shortfall
--     horizon = 'week'  one week                -> site shortfall
--     horizon = 'plan'  ONE ROW PER SKU PER WEEK of the 19-week plan
--                       plan_date = Monday of that ISO week
--
-- week_label keeps the sheet's own heading ("37.2026") so what you see in the app
-- matches what the planners sent.
alter table phasing add column if not exists week_label text;
create index if not exists phasing_plan_idx on phasing (horizon, sku_code, plan_date);

notify pgrst, 'reload schema';

-- Size: 200 SKUs x 19 weeks = 3,800 rows per plan revision, about 700 KB. Nothing.
--
-- Check:  select horizon, count(*), min(plan_date), max(plan_date)
--           from phasing group by horizon;
