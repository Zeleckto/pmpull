-- ================================================================
-- PM Pull — complete schema, one file.
--
-- Replaces supabase_setup.sql, migration_v2.sql, kasani_requests.sql and
-- sql/phase2..phase12.sql. Those stay in the repo as history; this is the file
-- to run on a fresh database.
--
-- Target: plain PostgreSQL 14+ (no Supabase, no PostgREST).
-- Row-level security and `notify pgrst` are deliberately absent — they mean
-- nothing without PostgREST, and the offline LAN has no untrusted clients.
--
--   createdb -U postgres pmpull
--   psql -U postgres -d pmpull -f sql/schema.sql
--
-- Safe to re-run: every object uses IF NOT EXISTS, and the seed data uses
-- ON CONFLICT DO NOTHING so your own numbers are never overwritten.
-- ================================================================


-- ================================================================
-- 1. MASTER DATA  — changes rarely
-- ================================================================

-- ---- SKU master. Everything else refers to skus.code ----
create table if not exists skus (
  code          text primary key,
  description   text,
  weight        int,                    -- grams per retail pack; joins to conversion.weight
  primary_type  text,                   -- 'carton' | 'laminate'
  outer_type    text,                   -- 'cld' | 'sac'
  primary_code  text,                   -- material code of the primary packmat
  outer_code    text,                   -- material code of the outer packmat
  divider       boolean default false,  -- needs a divider (forced on at >= 1000 g)
  sac_kg        numeric,                -- kg of FG per sac; fallback only
  add_req       text
);

-- ---- Packmat per tonne of finished goods, keyed by pack weight ----
-- FG tonnes  = base_units / per_t
-- base_units = FG tonnes * per_t
-- NULL means that packmat does not apply at that weight.
create table if not exists conversion (
  weight        int primary key,        -- grams
  cartons_per_t numeric,
  pouch_per_t   numeric,
  lam_per_t     numeric,
  cld_per_t     numeric,
  sac_per_t     numeric,
  inner_per_t   numeric
);

-- ---- Entry units AND truck capacity, in one table ----
-- base_per_unit  : base units in ONE of these (1 big roll = 450 kg)
-- truck_full_qty : how many of THIS unit fill 100% of a truck
-- A unit only appears in the app's dropdowns once base_per_unit is set, so
-- nobody can book "3 boxes" before anyone has defined what a box holds.
create table if not exists pack_config (
  packmat        text not null,                    -- carton | cld | sac | laminate | divider
  variant        text not null default 'default',
  unit_label     text,                             -- what the worker sees
  base_unit      text,                             -- 'pcs' | 'kg'
  base_per_unit  numeric,
  truck_full_qty numeric,
  sort_order     int default 0,
  primary key (packmat, variant)
);

-- ---- Machines. Drives which SKUs the PAT Line screen offers ----
create table if not exists lines_map (
  line         text primary key,
  group_name   text,                    -- e.g. 'BOSCH', 'EXTERNAL'
  label        text,                    -- what the operator reads
  weights      text,                    -- comma list '250,500'; blank = any weight
  primary_type text,                    -- carton | laminate; null = unrestricted
  outer_type   text,                    -- cld | sac;         null = unrestricted
  sort_order   int default 0,
  active       boolean default true,
  note         text
);

-- ---- Optional line -> material code map. When a line has rows here they
-- ---- OVERRIDE the type/weight rules above.
create table if not exists line_materials (
  line         text not null,
  packmat_code text not null,
  sku_code     text,
  packmat      text,
  note         text,
  primary key (line, packmat_code)
);
create index if not exists line_materials_line_idx on line_materials (line);


-- ================================================================
-- 2. TRANSACTIONS  — the working data
-- ================================================================

-- ---- Every PM store movement. On-hand is REPLAYED from this, never stored.
--
--   direction | on-hand | blocked | meaning
--   ----------+---------+---------+---------------------------------------
--   receive   |    +    |    -    | arrived from Kasani
--   return    |    +    |    -    | line sent it back
--   issue     |    -    |    -    | given to a line
--   block     |    -    |    +    | quarantined
--   unblock   |    +    |    -    | QA released it
--   scrap     |  none   |    -    | written off (already left on-hand at block)
--   adjust    | = qty   |    -    | stock count: ABSOLUTE, so order matters
--
-- `adjust` is the only order-dependent direction, which is why the app sorts
-- by (ts, id) before replaying.
create table if not exists ledger (
  id        bigint generated always as identity primary key,
  ts        timestamptz default now(),   -- shift is DERIVED from this, never stored
  sku_code  text,
  packmat   text,
  direction text,
  qty_base  numeric,                     -- always base units: pcs or kg
  line      text,                        -- machine, on issues and returns
  shift     text,
  note      text
);
create index if not exists ledger_ts_idx     on ledger (ts desc);
create index if not exists ledger_line_idx   on ledger (line, direction, ts desc);
create index if not exists ledger_dir_ts_idx on ledger (direction, ts desc);
create index if not exists ledger_sku_idx    on ledger (sku_code, packmat);

-- ---- PAT Line calls the store. qty_base = ASKED, qty_issued = GIVEN ----
create table if not exists requests (
  id         bigint generated always as identity primary key,
  ts         timestamptz default now(),
  line       text,
  sku_code   text,
  packmat    text,
  qty_base   numeric,                    -- what the line asked for
  shift      text,
  status     text default 'open',        -- open | done
  qty_issued numeric,                    -- what the store actually gave
  issued_at  timestamptz,
  issue_note text
);
create index if not exists requests_status_idx on requests (status, ts desc);
create index if not exists requests_issued_idx on requests (issued_at desc);

-- ---- The store asks Kasani for a shortfall ----
create table if not exists kasani_requests (
  id            bigint generated always as identity primary key,
  ts            timestamptz default now(),
  plan_date     date,
  sku_code      text,
  sku_desc      text,                    -- snapshot, so old reports still read right
  packmat       text,
  packmat_code  text,                    -- snapshot
  qty_base      numeric,                 -- the ask, in base units
  unit          text,                    -- what the user typed
  qty_entered   numeric,
  shift         text,                    -- when it is needed
  priority      int,                     -- 1 = A (now), 2 = B, 3 = C
  source        text default 'manual',   -- phasing | manual
  -- why the number was asked for; null on manual asks
  demand_t      numeric,
  need_base     numeric,
  onhand_base   numeric,
  status        text default 'open',     -- open | sent | received | cancelled
  note          text,
  dispatch_id   bigint,                  -- the truck that served it
  dispatched_at timestamptz
);
create index if not exists kasani_requests_open_idx     on kasani_requests (status, priority, ts);
create index if not exists kasani_requests_dispatch_idx on kasani_requests (dispatch_id);

-- ---- Kasani stock: ONE ROW PER INVOICE x PACKMAT x LOCATION.
-- ---- This is the goods-received document, the stock lot and the quality record.
-- ---- qty_base never changes; qty_remaining is drawn down FIFO by dispatch.
create table if not exists consignments (
  id             bigint generated always as identity primary key,
  ts             timestamptz default now(),
  received_at    timestamptz default now(),  -- business receipt time; FIFO ages from here

  -- paperwork
  invoice        text,
  invoice_date   date,
  po_no          text,
  grn_no         text,                       -- office fills this in later
  grn_date       date,
  transferred_to text,                       -- vehicle / bay, e.g. WB11C
  barcode_ref    text,
  supplier       text,

  -- what and where
  sku_code       text,
  sku_desc       text,
  packmat        text,
  packmat_code   text,
  floor          text,                       -- 'Ground' | 'First'
  location       text,                       -- 'Ground' or 'First A-12'

  -- quantity
  qty_base       numeric,                    -- what arrived; never changes
  qty_remaining  numeric,                    -- what is left on the shelf
  qty_entered    numeric,                    -- what was typed, before conversion
  unit           text,
  unit_variant   text,                       -- default | small | big | box | bundle

  -- quality
  status         text default 'pending',     -- pending | cleared | rejected
  sample_sent    boolean default false,
  sample_sent_at timestamptz,
  cleared_at     timestamptz,
  reject_reason  text,

  -- admin
  source         text default 'gr',          -- gr | csv | opening
  sap_entered    boolean default false,
  sap_entered_at timestamptz,
  note           text
);
create index if not exists consignments_stock_idx    on consignments (sku_code, packmat, status);
create index if not exists consignments_grn_idx      on consignments (grn_no);
create index if not exists consignments_received_idx on consignments (received_at desc);
create index if not exists consignments_fifo_idx     on consignments (sku_code, packmat, received_at)
  where qty_remaining is null or qty_remaining > 0;

-- ---- Trucks from Kasani to the PM store ----
create table if not exists dispatches (
  id            bigint generated always as identity primary key,
  ts            timestamptz default now(),
  plan_date     date,
  truck_no      int,
  challan       text,
  lines         jsonb,                   -- [{request_id, sku_code, sku_desc, packmat,
                                         --   packmat_code, qty_base, shift, priority, short}]
  fill_pct      numeric,
  shift         text,
  status        text default 'planned',  -- planned | dispatched
  ilt_done      boolean default false,
  dispatched_at timestamptz,
  ilt_sent_at   timestamptz,
  ilt_by        text,
  vehicle_no    text,
  note          text
);
create index if not exists dispatches_status_idx on dispatches (status, plan_date desc);


-- ================================================================
-- 3. PLANNING INPUTS  — uploaded spreadsheets
-- ================================================================

-- ---- All three demand plans, told apart by `horizon` ----
--   'day'   SKU x shift, one date          -> checked against PM STORE only
--   'week'  SKU, one week (plan_date = start) -> checked against STORE + KASANI
--   'plan'  SKU x week, the 19-week plan   -> expiry risk at Kasani
--           plan_date = Monday of that ISO week, week_label = the sheet's heading
create table if not exists phasing (
  id         bigint generated always as identity primary key,
  ts         timestamptz default now(),
  plan_date  date not null,
  shift      text,                       -- A|B|C for horizon='day'; null otherwise
  sku_code   text,
  tonnes     numeric,
  horizon    text default 'day',
  week_label text
);
create index if not exists phasing_date_idx    on phasing (plan_date, shift);
create index if not exists phasing_sku_idx     on phasing (sku_code, plan_date);
create index if not exists phasing_horizon_idx on phasing (horizon, plan_date);
create index if not exists phasing_plan_idx    on phasing (horizon, sku_code, plan_date);

-- ---- The DPR: finished goods actually produced. `line` optional; with it,
-- ---- packmat loss is worked out per line, without it per SKU.
create table if not exists production (
  id        bigint generated always as identity primary key,
  ts        timestamptz default now(),
  plan_date date,
  shift     text,
  sku_code  text,
  tonnes    numeric,
  line      text
);
create index if not exists production_date_idx  on production (plan_date, shift);
create index if not exists production_sku_idx   on production (sku_code, plan_date);
create index if not exists production_shift_idx on production (plan_date, shift, line);


-- ================================================================
-- 4. SEED DATA
-- ================================================================

-- ---- Entry units. NULL base_per_unit is deliberate: fill the real numbers in
-- ---- Kasani -> Truck & unit settings, and only then does the unit appear.
insert into pack_config (packmat, variant, unit_label, base_unit, base_per_unit, truck_full_qty, sort_order) values
  ('cld',      'default', 'pcs',          'pcs', 1,    null, 1),
  ('cld',      'bundle',  'bundle (10)',  'pcs', 10,   null, 2),
  ('carton',   'default', 'pcs',          'pcs', 1,    null, 3),
  ('carton',   'box',     'box',          'pcs', null, null, 4),
  ('laminate', 'default', 'kg',           'kg',  1,    null, 5),
  ('laminate', 'small',   'roll (small)', 'kg',  null, null, 6),
  ('laminate', 'big',     'roll (big)',   'kg',  null, null, 7),
  ('sac',      'default', 'pcs',          'pcs', 1,    null, 8),
  ('sac',      'bundle',  'bundle',       'pcs', null, null, 9),
  ('divider',  'default', 'pcs',          'pcs', 1,    null, 10)
on conflict (packmat, variant) do nothing;

-- ---- The machines ----
insert into lines_map (line, group_name, label, weights, primary_type, outer_type, sort_order, note) values
  ('K1A','BOSCH','K1A — Bosch poly', '', 'laminate','sac', 1,'poly line: laminate + sac'),
  ('K1B','BOSCH','K1B — Bosch poly', '', 'laminate','sac', 2,'poly line: laminate + sac'),
  ('K2A','BOSCH','K2A — Bosch poly', '', 'laminate','sac', 3,'poly line: laminate + sac'),
  ('K2B','BOSCH','K2B — Bosch poly', '', 'laminate','sac', 4,'poly line: laminate + sac'),
  ('K3A','BOSCH','K3A — Bosch poly', '', 'laminate','sac', 5,'poly line: laminate + sac'),
  ('K3B','BOSCH','K3B — Bosch poly', '', 'laminate','sac', 6,'poly line: laminate + sac'),
  ('K4A','BOSCH','K4A — Bosch poly', '', 'laminate','sac', 7,'poly line: laminate + sac'),
  ('K4B','BOSCH','K4B — Bosch poly', '', 'laminate','sac', 8,'poly line: laminate + sac'),
  ('KL',  null,  'KL — big laminate','', 'laminate','sac', 9,'big laminate + sac'),
  ('K6',  null,  'K6 — poly',        '', 'laminate','cld',10,'poly laminate + CLD'),
  ('K14', null,  'K14',              '', 'laminate','sac',11,'sac + laminate'),
  ('K9',  null,  'K9 — 250g',    '250', 'carton','cld',12,'250 g carton + CLD'),
  ('K11', null,  'K11 — 250g',   '250', 'carton','cld',13,'250 g carton + CLD'),
  ('K12', null,  'K12 — 250g',   '250', 'carton','cld',14,'250 g carton + CLD'),
  ('K10', null,  'K10 — 500g',   '500', 'carton','cld',15,'500 g carton + CLD'),
  ('M2',  null,  'M2 — 500g',    '500', 'carton','cld',16,'500 g carton + CLD'),
  ('M8',  null,  'M8 — 250/500g','250,500','carton','cld',17,'250 & 500 g carton + CLD'),
  ('K5',  null,  'K5',               '', null, null, 18,'capability not confirmed — shows all SKUs'),
  ('BAILING', null,'Bailing',        '', null, null, 19,'capability not confirmed — shows all SKUs'),
  ('GSKR','EXTERNAL','GSKR (other site)','', null, null, 30,'other factory — all SKUs'),
  ('AMLI','EXTERNAL','AMLI (other site)','', null, null, 31,'other factory — all SKUs')
on conflict (line) do nothing;


-- ================================================================
-- 5. CHECK IT WORKED
-- ================================================================
-- select table_name from information_schema.tables
--  where table_schema='public' order by 1;          -- expect 12 tables
-- select count(*) from pack_config;                 -- expect 10
-- select count(*) from lines_map;                   -- expect 21
