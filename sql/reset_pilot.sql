-- ================================================================
-- PM Pull — RESET FOR GO-LIVE
--
-- Wipes every transaction so you can start on real stock.
-- KEEPS all master and configuration data.
--
-- *** THIS CANNOT BE UNDONE. Read section 1 before running section 3. ***
-- ================================================================

-- ----------------------------------------------------------------
-- KEPT  (master + config — nothing below touches these)
--   skus            SKU master, packmat codes, weights
--   conversion      per-tonne factors
--   pack_config     entry units + truck capacities
--   lines_map       the machine list for PAT Line
--   line_materials  line -> material code map
--
-- CLEARED (transactions — all the dummy data)
--   ledger          every PM store movement, so on-hand goes to zero
--   requests        line calls from PAT Line
--   kasani_requests shortfall asks to Kasani
--   consignments    Kasani goods received / stock / quality
--   dispatches      truck plans and challans
--   production      uploaded DPRs
--   phasing         uploaded daily / weekly plans
-- ----------------------------------------------------------------


-- ----------------------------------------------------------------
-- 1) LOOK FIRST. Run this on its own and check the numbers are what
--    you expect to lose. The two "KEEP" rows should be non-zero.
-- ----------------------------------------------------------------
select 'KEEP  skus'            as table_name, count(*) from skus
union all select 'KEEP  conversion',     count(*) from conversion
union all select 'KEEP  pack_config',    count(*) from pack_config
union all select 'KEEP  lines_map',      count(*) from lines_map
union all select 'KEEP  line_materials', count(*) from line_materials
union all select 'WIPE  ledger',         count(*) from ledger
union all select 'WIPE  requests',       count(*) from requests
union all select 'WIPE  kasani_requests',count(*) from kasani_requests
union all select 'WIPE  consignments',   count(*) from consignments
union all select 'WIPE  dispatches',     count(*) from dispatches
union all select 'WIPE  production',     count(*) from production
union all select 'WIPE  phasing',        count(*) from phasing
order by 1;


-- ----------------------------------------------------------------
-- 2) BACK UP FIRST (recommended, takes a minute)
--    Supabase -> Table Editor -> ledger -> Export as CSV.
--    Repeat for consignments. Once section 3 runs, that data is gone.
-- ----------------------------------------------------------------


-- ----------------------------------------------------------------
-- 3) THE RESET. Select these lines only, then Run.
--    `restart identity` resets the id counters too, so the first real
--    truck is #1 and the first receipt is id 1 — a clean start.
-- ----------------------------------------------------------------
truncate table
  ledger,
  requests,
  kasani_requests,
  consignments,
  dispatches,
  production,
  phasing
restart identity;


-- ----------------------------------------------------------------
-- 4) CONFIRM. Every WIPE row should now read 0; every KEEP row unchanged.
--    Re-run the query in section 1.
--
-- Then in the app:
--   PM Store  -> Inventory shows every SKU at 0. Use "Sunday stock count"
--                to key in the real opening stock, or receive it in through
--                "Incoming from Kasani".
--   Kasani    -> Stock Status -> load the real stock sheet, or enter it
--                through Goods Received.
--   Check     -> Kasani -> Truck & unit settings still has your numbers
--                (it is in pack_config, which was kept).
-- ----------------------------------------------------------------
