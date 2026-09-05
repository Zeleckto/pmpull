# PM Pull — Full context & task brief for Claude Code

Read this file first, then read `src/App.jsx`, `src/data.js`, `src/supabase.js`.
It describes the app, the LIVE Supabase schema (which you cannot introspect — it was
created/altered via SQL in the Supabase dashboard, so trust THIS file for column names),
and the pending tasks. Work modularly: make only what each task asks, show diffs, don't
refactor unrelated code.

## 1. What this app is
A persistent PM-store (packaging-material) digital ledger for a tea packing factory.
Stack: Vite + React (single `src/App.jsx`) + Supabase (Postgres). Deployed on Netlify.
Sections in the UI: **PM Requests · Inventory & Store Actions · Request Shortfall from
Kasani · Settings**. Every stock movement writes a timestamped row to the `ledger` table;
on-hand is COMPUTED from the ledger (never stored as a balance).

## 2. Architecture rules (do not break)
- ALL database access goes through `src/data.js`. `App.jsx` calls those functions only.
- On-hand (`computeOnHand` in data.js): receive+return − issue − block; `adjust` sets absolute.
- Base units in the ledger: carton=cartons(pcs), cld=cases, sac=bags, laminate=kg.
- `.env.local` holds Supabase keys; never commit it. Env vars: VITE_SUPABASE_URL,
  VITE_SUPABASE_PUBLISHABLE_KEY (also set in Netlify → Environment variables).
- You (Claude Code) CANNOT run SQL on Supabase. When a task needs a schema change, OUTPUT the
  SQL for the user to paste into Supabase → SQL Editor. Then wire the code to it.

## 3. LIVE Supabase schema (source of truth — reflect these exact names in code)

### table `skus`
code (text, PK), description (text), weight (int, grams),
primary_type (text: 'carton' | 'laminate'), outer_type (text: 'cld' | 'sac'),
primary_code (text), outer_code (text), divider (bool), sac_kg (numeric, nullable),
add_req (text, nullable).
NOTE: type text has been normalized to lowercase canonical ('carton'/'laminate'/'cld'/'sac').
Still read it case-insensitively to be safe.

### table `ledger`
id (bigint PK, identity), ts (timestamptz default now()), sku_code (text), packmat (text:
'carton'|'cld'|'sac'|'laminate'|'divider'), direction (text, see below), qty_base (numeric),
line (text, machine/line for issues), shift (text 'A'|'B'|'C'), note (text).
`direction` is FREE TEXT — new values need no SQL. Effect on the computed figures:
| direction | on-hand      | blocked |
|-----------|--------------|---------|
| receive   | + qty        | -       |
| return    | + qty        | -       |
| issue     | - qty        | -       |
| block     | - qty        | + qty   |
| unblock   | + qty        | - qty   |  (QA released it back to usable stock)
| scrap     | no change    | - qty   |  (already left on-hand at block; written off for good)
| adjust    | = qty (absolute) | -   |  (Sunday stock count force-set)

### table `conversion`   <-- IMPORTANT: this now holds the real per-tonne factors
weight (int PK, grams), cartons_per_t (numeric), pouch_per_t (numeric), lam_per_t (numeric),
cld_per_t (numeric), sac_per_t (numeric), inner_per_t (numeric).
All values are "base units PER TONNE of finished goods". "-" cells were loaded as NULL,
meaning that packmat does not apply at that weight. 18 rows loaded (13g … 2000g).
Conversion math:  FG_tonnes = base_units / per_t     ;     base_units = tonnes * per_t.

### table `requests`
id (bigint PK), ts, line (text), sku_code (text), packmat (text), qty_base (numeric),
shift (text), status (text default 'open').  (Empty until a line-HMI/manual feed adds rows.)

## 3b. Units (confirmed by user — do not change without asking)
Ledger `qty_base` is ALWAYS in base units. Entry units live in `UNITS` in App.jsx:
- carton   -> `pcs` only  (cartons are variable, so everything is counted in pieces)
- cld      -> `pcs` | `bundles`   (**1 bundle = 10 CLD**) — the only real conversion
- sac      -> `pcs` only
- laminate -> `kg` only
- divider  -> `pcs` only
The unit actually typed is written into ledger `note` (e.g. "3 bundles").

### table `kasani_requests`  (run `kasani_requests.sql`)
What the PM store asks Kasani warehouse to dispatch. Columns:
id, ts, plan_date (date), sku_code, packmat, qty_base (base units), unit, qty_entered,
shift ('A'|'B'|'C'), priority (int 1=A, 2=B, 3=C), source ('phasing'|'manual'),
demand_t, need_base, onhand_base, status ('open'|'sent'|'received'|'cancelled'), note.
`loadKasaniRequests()` returns open+sent rows ordered by priority then ts.

## 4. TASKS — all A–F DONE (2026-09-05)
- **A** conversions read the `conversion` table via `perT()`; formula fallback kept. DONE.
- **B** `compsOf` lowercased, matches "wov" as sac. DONE.
- **C** `sortSkusByStock()` puts in-stock SKUs first in every SKU dropdown. DONE.
- **D** unit dropdown per packmat (see 3b). DONE.
- **E** phasing upload -> preview -> OK -> shortfall, shift A/B/C priority. DONE.
- **F** conversion CSV upsert in Settings (`upsertConversion`). DONE.
- **H** Sunday stock count (bulk `adjust` sheet), blocked-material Release/Scrap,
  shortfall results as a popup, inventory sorted stock-first, Kasani "Received" opens the
  Incoming form prefilled and books the ledger row + closes the ask together. DONE.
- **G** Kasani requests: shortfall rows -> `kasani_requests`, manual ad-hoc ask,
  open-request list with Sent/Received/Cancel. DONE.

### Shortfall priority rule (important)
On-hand is ALLOCATED shift A first, then B, then C. Each row's "on-hand" column is what is
still free for that shift after earlier shifts took theirs — so the same stock is never
counted twice, and priority 1 (shift A) rows are the genuine "need it now" pulls.

## 5. Workflow
- One task at a time. Show the diff, let me accept, I test in the browser (npm run dev running).
- After a task works: `git add . && git commit -m "task X" && git push` (Netlify auto-deploys).
- If a task needs SQL, print it for me to run in Supabase before/after the code change.
