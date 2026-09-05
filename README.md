# PM Pull — PM Store Digital Ledger (POC)

Database-backed ledger for the day PM store. Three sections:
**PM Requests · Inventory & Store Actions · Request Shortfall from Kasani**, plus Settings.
Every issue / incoming / return / block writes a **timestamped ledger row** (with machine line
on issues), so on-hand and losses are computed from history. Vite + React + Supabase.

## IMPORTANT for anyone (or Claude Code) editing this
- **All DB access is in `src/data.js`.** `App.jsx` never calls Supabase directly.
  To add a feature that touches data: add a function in `data.js`, then call it from `App.jsx`.
- **On-hand is computed from the ledger** (`computeOnHand`): receive + return − issue − block;
  `adjust` sets an absolute value. NEVER store a mutable balance — always append a ledger row.
- **Base units:** cartons / CLD cases / sac bags / laminate kg.
- The `skus` table columns are: code, description, weight, primary_type (carton|laminate),
  outer_type (cld|sac), primary_code, outer_code, divider, sac_kg (optional).
- Conversion falls back to formulas if the `conversion` table is empty:
  cartons = 1e6/weight, CLD = 1000/12kg, sac = 1000/sac_kg (default 24), laminate = 20/t.

## First-time DB setup (Supabase → SQL Editor → Run)
1. `supabase_setup.sql`  (creates skus, conversion, ledger)
2. `migration_v2.sql`    (adds `line` to ledger + `requests` table + optional `sac_kg`)

## Run locally
```
npm install
copy .env.example .env.local      # PowerShell: copy   (mac/linux: cp)
# put your Supabase URL + publishable/anon key in .env.local, then:
npm run dev
```
Open http://localhost:5173 . Settings → import SKU master. Inventory → Issue → check the
row in Supabase → Table Editor → ledger.

## Deploy (GitHub → Netlify)
Push to a private GitHub repo (don't commit `.env.local`). In Netlify: import the repo,
build `npm run build`, publish `dist`, and add env vars `VITE_SUPABASE_URL` and
`VITE_SUPABASE_PUBLISHABLE_KEY`. Redeploy after changing env vars.

## Daily
Backup: Supabase → Table Editor → ledger → Export CSV, once per shift.

## Good next tasks (for Claude Code)
- "Add a machine-line dropdown sourced from a lines list instead of free text."
- "Add a per-shift on-hand summary."
- "Store daily loss results in a new `loss_daily` table for trend charts."
- "Add a conversion editor in Settings that upserts the `conversion` table."
- "Build the Kasani screens (GR, stock status, dispatch) as a new tab/role — separate data model."
