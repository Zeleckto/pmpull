-- ================================================================
-- PM Pull — PM Store Ledger : paste this whole file into
-- Supabase  ->  SQL Editor  ->  New query  ->  Run
-- ================================================================

create table if not exists skus (
  code          text primary key,
  description   text,
  weight        int,
  primary_type  text,          -- carton | laminate
  outer_type    text,          -- cld | sac
  primary_code  text,
  outer_code    text,
  divider       boolean default false
);

create table if not exists conversion (
  weight        int primary key,
  cartons_per_t numeric,       -- cartons per tonne of FG
  cld_per_t     numeric,       -- CLD cases per tonne
  sac_kg        numeric,       -- kg of FG per sac (bags/t = 1000/sac_kg)
  lam_rate      numeric        -- laminate kg per tonne
);

create table if not exists ledger (
  id         bigint generated always as identity primary key,
  ts         timestamptz default now(),
  sku_code   text,
  packmat    text,             -- carton | cld | sac | laminate
  direction  text,             -- issue | return | receive | adjust
  qty_base   numeric,          -- base units: cartons / cld cases / sac bags / laminate kg
  shift      text,             -- A | B | C
  note       text
);

-- Pilot access: allow the app's public key to read/write.
-- (Fine for a closed factory pilot; tighten with real auth before wider use.)
alter table skus       enable row level security;
alter table conversion enable row level security;
alter table ledger     enable row level security;

drop policy if exists "pilot all" on skus;
drop policy if exists "pilot all" on conversion;
drop policy if exists "pilot all" on ledger;
create policy "pilot all" on skus       for all using (true) with check (true);
create policy "pilot all" on conversion for all using (true) with check (true);
create policy "pilot all" on ledger     for all using (true) with check (true);
