-- ================================================================
-- PM Pull — Phase 4. Paste into Supabase -> SQL Editor -> Run.
-- Safe to re-run. Only ADDS; nothing dropped. Run after sql/phase3.sql.
-- ================================================================

-- ----------------------------------------------------------------
-- 1) FIFO depletion on consignments.
--
--    You do NOT need a separate packmat/invoice table: `consignments` is
--    already one row per invoice x packmat x location, so the same material
--    arriving on three invoices is three rows. What was missing is how much
--    of each row is LEFT — without that we can't tell when the oldest invoice
--    is finished and the next one's location should be shown instead.
--
--    qty_base      = what arrived on that invoice (never changes)
--    qty_remaining = what is still physically there (drawn down by dispatch)
-- ----------------------------------------------------------------
alter table consignments add column if not exists qty_remaining numeric;
update consignments set qty_remaining = qty_base where qty_remaining is null;

-- where the row came from, so a bulk stock load is distinguishable from a real GR
alter table consignments add column if not exists source   text default 'gr';   -- 'gr' | 'csv'
alter table consignments add column if not exists sku_desc text;                -- snapshot, for CSVs with no SKU master match

-- the FIFO lookup: oldest still-remaining invoice for a material
create index if not exists consignments_fifo_idx
  on consignments (sku_code, packmat, received_at)
  where qty_remaining is null or qty_remaining > 0;

-- ----------------------------------------------------------------
-- 2) Commercial / SAP entry: track who closed the GRN and when.
--    (grn_no / grn_date already exist from phase 3.)
-- ----------------------------------------------------------------
alter table consignments add column if not exists sap_entered    boolean default false;
alter table consignments add column if not exists sap_entered_at timestamptz;

-- ----------------------------------------------------------------
-- 3) ILT sign-off on a truck.
-- ----------------------------------------------------------------
alter table dispatches add column if not exists ilt_by      text;
alter table dispatches add column if not exists dispatched_at timestamptz;

-- ----------------------------------------------------------------
-- Check it worked:
--   select sku_code, packmat, invoice, received_at, qty_base, qty_remaining, location
--     from consignments order by sku_code, packmat, received_at;
-- Every existing row should now have qty_remaining = qty_base.
-- ----------------------------------------------------------------
