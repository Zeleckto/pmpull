-- ================================================================
-- PM Pull — Phase 7.  Machine lines for the BCE screen.
-- Paste into Supabase -> SQL Editor -> Run. Safe to re-run.
-- ================================================================

-- ----------------------------------------------------------------
-- 1) lines_map gains grouping + display info.
--    (line, weights, primary_type, outer_type already exist from phase 2.)
-- ----------------------------------------------------------------
alter table lines_map add column if not exists group_name text;    -- e.g. 'BOSCH'
alter table lines_map add column if not exists label      text;    -- what the worker reads
alter table lines_map add column if not exists sort_order int default 0;
alter table lines_map add column if not exists active     boolean default true;
alter table lines_map add column if not exists note       text;

-- ----------------------------------------------------------------
-- 2) The machines, exactly as described.
--    weights = comma list, BLANK means "any weight" (the line gets re-set often).
--    primary_type / outer_type are what that line physically runs.
-- ----------------------------------------------------------------
insert into lines_map (line, group_name, label, weights, primary_type, outer_type, sort_order, note) values
  -- BOSCH poly lines: laminate primary, sac outer
  ('K1A','BOSCH','K1A — Bosch poly', '', 'laminate','sac', 1,'poly line: laminate + sac'),
  ('K1B','BOSCH','K1B — Bosch poly', '', 'laminate','sac', 2,'poly line: laminate + sac'),
  ('K2A','BOSCH','K2A — Bosch poly', '', 'laminate','sac', 3,'poly line: laminate + sac'),
  ('K2B','BOSCH','K2B — Bosch poly', '', 'laminate','sac', 4,'poly line: laminate + sac'),
  ('K3A','BOSCH','K3A — Bosch poly', '', 'laminate','sac', 5,'poly line: laminate + sac'),
  ('K3B','BOSCH','K3B — Bosch poly', '', 'laminate','sac', 6,'poly line: laminate + sac'),
  ('K4A','BOSCH','K4A — Bosch poly', '', 'laminate','sac', 7,'poly line: laminate + sac'),
  ('K4B','BOSCH','K4B — Bosch poly', '', 'laminate','sac', 8,'poly line: laminate + sac'),

  -- big laminate line
  ('KL',  null,  'KL — big laminate','', 'laminate','sac', 9,'big laminate + sac'),

  -- laminate into CLD
  ('K6',  null,  'K6 — poly',        '', 'laminate','cld',10,'poly laminate + CLD'),

  -- sac / laminate
  ('K14', null,  'K14',              '', 'laminate','sac',11,'sac + laminate'),

  -- carton / CLD lines
  ('K9',  null,  'K9 — 250g',    '250', 'carton','cld',12,'250 g carton + CLD'),
  ('K11', null,  'K11 — 250g',   '250', 'carton','cld',13,'250 g carton + CLD'),
  ('K12', null,  'K12 — 250g',   '250', 'carton','cld',14,'250 g carton + CLD'),
  ('K10', null,  'K10 — 500g',   '500', 'carton','cld',15,'500 g carton + CLD'),
  ('M2',  null,  'M2 — 500g',    '500', 'carton','cld',16,'500 g carton + CLD'),
  ('M8',  null,  'M8 — 250/500g','250,500','carton','cld',17,'250 & 500 g carton + CLD'),

  -- seen in the code sheet but not yet described: left open (all SKUs) until you confirm
  ('K5',  null,  'K5',               '', null, null, 18,'capability not confirmed — shows all SKUs'),
  ('BAILING', null,'Bailing',        '', null, null, 19,'capability not confirmed — shows all SKUs'),

  -- other factories / warehouses: not mapped, but selectable because their SKUs
  -- are sometimes run here
  ('GSKR','EXTERNAL','GSKR (other site)','', null, null, 30,'other factory — all SKUs'),
  ('AMLI','EXTERNAL','AMLI (other site)','', null, null, 31,'other factory — all SKUs')
on conflict (line) do update set
  group_name = excluded.group_name,
  label      = excluded.label,
  weights    = excluded.weights,
  primary_type = excluded.primary_type,
  outer_type   = excluded.outer_type,
  sort_order   = excluded.sort_order,
  note         = excluded.note;

-- ----------------------------------------------------------------
-- 3) OPTIONAL, and the accurate way to do this:
--    the exact line -> material-code sheet. Upload it from
--    PM Store -> Settings -> "Import line / material map" rather than
--    typing 200 codes into SQL by hand.
--    When a line has rows here, BCE shows exactly those materials and the
--    type/weight rules above are only a fallback.
-- ----------------------------------------------------------------
create table if not exists line_materials (
  line         text not null,
  packmat_code text not null,
  sku_code     text,
  packmat      text,
  note         text,
  primary key (line, packmat_code)
);
create index if not exists line_materials_line_idx on line_materials (line);

alter table line_materials enable row level security;
drop policy if exists "pilot all" on line_materials;
create policy "pilot all" on line_materials for all using (true) with check (true);

notify pgrst, 'reload schema';

-- ----------------------------------------------------------------
-- Check:  select line, label, weights, primary_type, outer_type
--           from lines_map order by sort_order;
-- Expect 22 rows. Fix K5 / BAILING once you confirm what they run.
-- ----------------------------------------------------------------
