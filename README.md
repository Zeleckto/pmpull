# PM Pull — PM Store Digital Ledger (POC)

A small, database-backed ledger for the day PM store: record issues/returns/receipts,
see live on-hand, upload FG-produced to compute packmat loss, and upload daily phasing
to compute shortfall (pink-slip quantities). Built with Vite + React + Supabase.

## Context for Claude Code
- This is the **persistent POC**. The full multi-role demo lives elsewhere (offline HTML).
- Live data (SKUs, conversion, ledger) is stored in **Supabase Postgres**.
  Phasing and FG-produced are **parsed in-browser on upload** (not stored).
- **All DB access is in `src/data.js`.** `App.jsx` never calls Supabase directly —
  when adding features, add a function in `data.js` and call it from `App.jsx`.
- On-hand is **computed from the ledger** (receives + returns − issues; `adjust` sets absolute).
  Never store a mutable "balance" — always append a ledger row.
- Base units everywhere: cartons / CLD cases / sac bags / laminate kg.

## Files
- `src/App.jsx`     — the UI (tabs: Record & On-hand, Loss, Shortfall, Settings)
- `src/data.js`     — Supabase read/write functions
- `src/supabase.js` — creates the client from env vars
- `supabase_setup.sql` — paste into Supabase SQL editor to create tables

## One-time setup

### 1. Supabase (browser)
1. supabase.com → New project (name `pmpull`, set a DB password, region Mumbai/Singapore).
2. SQL Editor → New query → paste **all of `supabase_setup.sql`** → Run.
3. Project Settings → API → copy the **Project URL** and the **anon/publishable key**.

### 2. Local (VS Code terminal)
```
npm install
copy .env.example .env.local        # (PowerShell: copy ; macOS/Linux: cp)
```
Open `.env.local` and paste your two values:
```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=eyJhbGciOi...
```
Run it:
```
npm run dev
```
Open http://localhost:5173 . Import your SKU master in **Settings**, record a test
issue, and confirm it appears in Supabase → Table Editor → `ledger`.

### 3. Deploy (GitHub + Netlify)
1. Create a **private GitHub repo**; upload these files (web upload or `git`).
   Do **not** upload `.env.local`.
2. Netlify → Add new site → import the repo → build `npm run build`, publish `dist`.
3. Netlify → Site config → Environment variables: add
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
4. Deploy. Open the URL on the store laptop(s).

> If you change env vars after deploying, trigger a redeploy (Deploys → Trigger deploy).

## Daily habit
- Backup: Supabase → Table Editor → `ledger` → Export CSV, once per shift.

## Upload formats
- **SKU master:** SKU Code, Description, Type (Outer), Type (Primary), Weight,
  Primary Code, Outer Code, Additional Requirement.
- **Daily phasing:** SKU/CBU Code, Qty (FG tonnes), Shift (A/B/C).
- **FG produced:** SKU Code, FG tonnes produced.

## Common change requests (for Claude Code)
- "Add a returns-only filter to Recent movements."
- "Add a per-shift on-hand view."
- "Store the daily loss result in a new `loss_daily` table so we can chart trends."
- "Add a conversion editor in Settings that upserts the `conversion` table."
