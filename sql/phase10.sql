-- ================================================================
-- PM Pull — Phase 10.  Restores the entry units the shop floor actually counts in.
-- Paste into Supabase -> SQL Editor -> Run. Safe to re-run.
-- ================================================================

-- ----------------------------------------------------------------
-- Phase 5 removed the carton "box" and sac bundle units, on the basis that a box
-- holds a variable number of cartons. They are wanted back as OPTIONS — BCE and the
-- stock count ask in boxes / rolls / bundles, not in pcs and kg.
--
-- They come back with base_per_unit NULL on purpose: a unit only appears in the
-- dropdowns once you put a real number against it in
--   Kasani -> Truck & unit settings.
-- That way nobody can book "3 boxes" before anyone has said what a box holds.
--
-- `on conflict do nothing` means any figure you have already entered is kept.
-- ----------------------------------------------------------------
insert into pack_config (packmat, variant, unit_label, base_unit, base_per_unit, truck_full_qty, sort_order) values
  ('carton',   'box',      'box',            'pcs', null, null, 20),
  ('cld',      'bundle',   'bundle (10)',    'pcs', 10,   null, 21),
  ('sac',      'bundle',   'bundle',         'pcs', null, null, 22),
  ('laminate', 'small',    'roll (small)',   'kg',  null, null, 23),
  ('laminate', 'big',      'roll (big)',     'kg',  null, null, 24)
on conflict (packmat, variant) do nothing;

notify pgrst, 'reload schema';

-- ----------------------------------------------------------------
-- Fill in the blanks, then the units appear everywhere:
--   update pack_config set base_per_unit = 24  where packmat='carton'   and variant='box';
--   update pack_config set base_per_unit = 100 where packmat='sac'      and variant='bundle';
--   update pack_config set base_per_unit = 45  where packmat='laminate' and variant='small';
--   update pack_config set base_per_unit = 450 where packmat='laminate' and variant='big';
--
-- Check:  select packmat, variant, unit_label, base_per_unit, truck_full_qty
--           from pack_config order by packmat, sort_order;
-- ----------------------------------------------------------------
