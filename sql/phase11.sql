-- ================================================================
-- PM Pull — Phase 11.  Record what was actually issued against a request.
-- Paste into Supabase -> SQL Editor -> Run. Safe to re-run.
-- ================================================================

-- A line asks for 500 and the store issues 480 — that gap is real and worth keeping.
-- qty_base stays as ASKED; qty_issued is what physically went out.
alter table requests add column if not exists qty_issued numeric;
alter table requests add column if not exists issued_at  timestamptz;
alter table requests add column if not exists issue_note text;

create index if not exists requests_issued_idx on requests (issued_at desc);

notify pgrst, 'reload schema';

-- Asked vs given, once you have some history:
--   select line, sku_code, packmat, qty_base as asked, qty_issued as given,
--          qty_issued - qty_base as diff, issued_at
--     from requests where qty_issued is not null order by issued_at desc;
