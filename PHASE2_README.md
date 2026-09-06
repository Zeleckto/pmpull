# PM Pull — Phase 2 (Kasani, BCE, Leadership, Login) — modular add-on

These files add four role-screens WITHOUT changing your PM-store code.
Only ONE existing file changed: `src/main.jsx` (now renders `AppShell` instead of `App`).
Your `src/App.jsx` and `src/data.js` are untouched.

## New files
- `src/AppShell.jsx`   — router: shows Login, then Store / Kasani / BCE / Leadership by role.
- `src/Login.jsx`      — pilot PIN gate (store 1111, kasani 2222, leadership 3333, BCE none). CHANGE THESE.
- `src/shared.js`      — shared helpers (conversion via `conversion` table, styles, xlsx read/export).
- `src/dataKasani.js`  — all Phase-2 DB calls (consignments, production, dispatches, lines_map, requests).
- `src/kasani/KasaniInventory.jsx` — GR entry (invoice, auto packmat code, location grid Ground / First A–E×1–32) + stock list + sample/clear.
- `src/kasani/KasaniDispatch.jsx`  — upload phasing → auto truck sequence (A→B→C, ≤90%, split). Uses TRUCK_CAP (verify numbers).
- `src/bce/BCECall.jsx`            — mobile call screen; writes to `requests`.
- `src/Leadership.jsx`            — loss (production vs issued), GR/ILT KPIs, Export today to Excel.
- `sql/phase2.sql`               — creates production, consignments, dispatches, lines_map (+ optional purge job).

## Tables (run sql/phase2.sql in Supabase)
- production(plan_date, sku_code, tonnes, shift) — daily FG output → loss.
- consignments(invoice, sku_code, packmat, packmat_code, qty_base, floor, location, status, sample_sent, …) — Kasani inventory.
- dispatches(truck_no, lines[], fill_pct, ilt_done, …) — truck plans.
- lines_map(line, weights, primary_type, outer_type) — optional; lets BCE filter SKUs by line.

## Wire-up (already done, but if applying by hand)
1. `src/main.jsx` must render `<AppShell/>`.
2. Run `sql/phase2.sql` in Supabase.
3. `npm run dev` → Login → pick a role.

## Things to VERIFY / customise (marked in code)
- Login PINs in `src/Login.jsx`.
- `TRUCK_CAP` in `KasaniDispatch.jsx` (base-unit capacity per truck) — put real numbers.
- Unit factors if you add bundle/roll entry (not included yet in phase-2 screens).
- `lines_map` rows (optional) for BCE SKU filtering; empty = BCE sees all SKUs + a default line list.

## Notes for Claude Code
- Phase-2 conversion uses the `conversion` table via `perT()` in shared.js (base units per tonne).
- All new DB access is in `dataKasani.js`; keep that separation.
- Screens are independent — deploy whichever are ready; a broken one doesn't block others.
