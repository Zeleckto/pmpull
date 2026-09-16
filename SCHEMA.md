# PM Pull — data model: what you store today, and what I'd change

Written 2026-09-07. Two halves:

- **Part A — what exists now.** Every table, what writes it, what reads it, and how the
  main flows are actually recorded.
- **Part B — assessment and a recommended schema.** What the current model can and
  cannot answer, and the changes I'd make, in priority order.

Read Part A to check I've understood your process. Part B is where the decisions are.

---

# PART A — the schema as it stands

## The shape of it

Twelve tables in three groups:

| Group | Tables | Changes how often |
|---|---|---|
| **Master data** | `skus`, `conversion`, `pack_config`, `lines_map`, `line_materials` | Rarely — set up once, edited occasionally |
| **Transactions** | `ledger`, `requests`, `kasani_requests`, `consignments`, `dispatches` | Constantly — every movement |
| **Planning inputs** | `phasing`, `production` | Uploaded daily / weekly |

The core design decision, and it is a good one: **`ledger` never stores a balance.**
On-hand is recomputed by replaying every movement. That means no figure can silently
drift, and any number on screen can be traced back to the rows that produced it.

---

## A1. Master data

### `skus` — the SKU master
The spine. Everything else refers to `sku_code`.

| Column | Type | Meaning |
|---|---|---|
| `code` | text **PK** | SKU / CBU code, e.g. `BA2CBR0` |
| `description` | text | e.g. `RED LABEL LEAF A [C] 48x250g` |
| `weight` | int | grams per retail pack — **the join key into `conversion`** |
| `primary_type` | text | `carton` \| `laminate` |
| `outer_type` | text | `cld` \| `sac` |
| `primary_code` | text | material code of the primary packmat |
| `outer_code` | text | material code of the outer packmat |
| `divider` | bool | needs a divider |
| `sac_kg` | numeric | kg of FG per sac (fallback only) |
| `add_req` | text | free text, unused by the app |

**Written by:** PM Store → Settings (SKU import, Add/Edit SKU); Kasani opening-stock load
(gap-fill only).
**Read by:** everything.

> A SKU's components are *derived*, not stored: `compsOf()` reads `primary_type` and
> `outer_type` and returns `["carton","cld"]` etc. So a blank `outer_type` silently means
> "this SKU has no outer" — which is why blank codes caused so much trouble.

### `conversion` — packmat per tonne of FG, keyed by weight
| Column | Meaning |
|---|---|
| `weight` int **PK** | grams |
| `cartons_per_t`, `pouch_per_t`, `lam_per_t`, `cld_per_t`, `sac_per_t`, `inner_per_t` | base units per **tonne of finished goods** |

Every conversion in the app is one of two lines:
```
FG tonnes   = base_units / per_t      (fgEquiv)
base_units  = FG tonnes * per_t       (theo)
```

> ⚠️ **`supabase_setup.sql` is out of date.** It declares `sac_kg` and `lam_rate`; the live
> table has the six `*_per_t` columns above. The app is right, the setup file is stale.
> Worth correcting so a fresh environment matches production.

### `pack_config` — entry units *and* truck capacity
One row per packmat × variant. **PK = (packmat, variant).**

| Column | Meaning |
|---|---|
| `unit_label` | what the worker sees: `pcs`, `bundle (10)`, `roll (big)` |
| `base_unit` | what it converts into: `pcs` \| `kg` |
| `base_per_unit` | base units in one — 1 big roll = 450 kg |
| `truck_full_qty` | how many of *this* unit fill 100% of a truck |

Doing two jobs in one table is deliberate and works: a unit is only offered once
`base_per_unit` is set, so nobody can book "3 boxes" before anyone defines a box.

### `lines_map` — the machines
`line` **PK**, plus `group_name` (BOSCH), `label`, `weights` (`250,500`, blank = any),
`primary_type`, `outer_type`, `sort_order`, `active`, `note`.
Drives which SKUs PAT Line shows.

### `line_materials` — line → material code
`(line, packmat_code)` **PK**. Optional. When a line has rows here they **override** the
type/weight rules in `lines_map`.

---

## A2. Transactions

### `ledger` — every PM store movement
The most important table in the system.

| Column | Meaning |
|---|---|
| `id` bigint **PK** | identity |
| `ts` timestamptz | auto — **the shift is derived from this**, never stored |
| `sku_code`, `packmat` | what moved |
| `direction` | see table below |
| `qty_base` | always in base units (pcs / kg) |
| `line` | machine, on issues and returns |
| `shift` | typed at entry — *not* the same as the shift derived from `ts` |
| `note` | free text; currently carries the entered unit, e.g. `"5 bundles"` |

**`direction` is free text**, no constraint. Effects:

| direction | on-hand | blocked | meaning |
|---|---|---|---|
| `receive` | **+** | — | arrived from Kasani |
| `return` | **+** | — | line sent it back |
| `issue` | **−** | — | given to a line |
| `block` | **−** | **+** | quarantined |
| `unblock` | **+** | **−** | QA released it |
| `scrap` | no change | **−** | written off (it already left on-hand at `block`) |
| `adjust` | **= qty** | — | Sunday count — **absolute**, order-sensitive |

> `adjust` is the only order-dependent direction, which is why `computeOnHand` now sorts by
> `(ts, id)` before replaying. Everything else is commutative.

### `requests` — PAT Line calls the store
`id`, `ts`, `line`, `sku_code`, `packmat`, `qty_base` (**asked**), `shift`, `status`
(`open`/`done`), and since phase 11: `qty_issued` (**given**), `issued_at`, `issue_note`.

Keeping asked and given apart is what makes "the store was 20 pcs short on this call"
answerable.

### `kasani_requests` — the store asks Kasani
`sku_code`, `packmat`, `sku_desc`, `packmat_code`, `qty_base`, `unit`, `qty_entered`,
`shift`, `priority` (1=A, 2=B, 3=C), `source` (`phasing`/`manual`), `status`
(`open`/`sent`/`received`/`cancelled`), `dispatch_id`, `dispatched_at`, plus an audit trio
`demand_t` / `need_base` / `onhand_base` recording *why* the number was asked for.

That audit trio is a good instinct — it means a shortfall figure can be explained months later.

### `consignments` — Kasani stock, one row per invoice × packmat × location
This table is doing **three jobs at once**: goods-received document, stock lot, and
quality record.

| Group | Columns |
|---|---|
| Paperwork | `invoice`, `invoice_date`, `po_no`, `grn_no`, `grn_date`, `transferred_to`, `barcode_ref`, `supplier` |
| What/where | `sku_code`, `sku_desc`, `packmat`, `packmat_code`, `floor`, `location` |
| Quantity | `qty_base` (arrived, never changes), **`qty_remaining`** (drawn down by dispatch), `qty_entered`, `unit`, `unit_variant` |
| Quality | `status` (`pending`/`cleared`/`rejected`), `sample_sent`, `sample_sent_at`, `cleared_at`, `reject_reason` |
| Admin | `received_at`, `source` (`gr`/`csv`/`opening`), `sap_entered`, `sap_entered_at`, `note` |

`qty_base` − `qty_remaining` = consumed. FIFO picks the oldest row still holding stock —
that's how the "pick from" location advances by itself.

### `dispatches` — trucks
`plan_date`, `truck_no`, `challan`, **`lines` jsonb**, `fill_pct`, `shift`, `status`
(`planned`/`dispatched`), `ilt_done`, `dispatched_at`, `ilt_sent_at`, `ilt_by`, `vehicle_no`.

`lines` holds `[{request_id, sku_code, sku_desc, packmat, packmat_code, qty_base, shift, priority, short}]`.

---

## A3. Planning inputs

### `phasing` — all three demand plans, told apart by `horizon`

| `horizon` | Grain | `plan_date` means | Checked against |
|---|---|---|---|
| `day` | SKU × shift, one date | that date | **PM store only** |
| `week` | SKU, one week | week start | **PM store + Kasani** |
| `plan` | SKU × week, 19–20 weeks | Monday of that ISO week | Kasani, for expiry risk |

Columns: `plan_date`, `shift` (day only), `sku_code`, `tonnes`, `horizon`, `week_label`.
Re-uploading a date replaces **only that horizon**.

### `production` — the DPR
`plan_date`, `shift`, `sku_code`, `tonnes`, `line` (optional). With `line`, loss is
computed per line; without it, per SKU. Re-uploading a date+shift replaces it.

---

## A4. How the main flows are actually stored

**A line calls for packaging**
```
PAT Line  →  requests(line, sku, packmat, qty_base=asked, shift=derived, status='open')
PM Store  →  "Issue…" prefills the form
          →  ledger(direction='issue', qty_base=given, line, note='500 pcs')
          →  requests.qty_issued = given, status='done', issued_at=now
```

**Daily shortfall → Kasani**
```
Upload  →  phasing(horizon='day', plan_date, shift, sku, tonnes)
Compute →  demand vs fgCapable(PM store stock)  [in the browser, not stored]
Ask     →  kasani_requests(qty_base=short, priority, demand_t, need_base, onhand_base)
Kasani  →  dispatches(lines jsonb) → Send ILT → challan, consumeFifo() draws consignments down
Store   →  ledger(direction='receive')   ← recorded separately, NOT linked to the dispatch
```

**Packmat loss for a shift**
```
Upload DPR   →  production(plan_date, shift, sku, tonnes, line?)
should_use   =  theo(packmat, sku, tonnes, conversion)
actually_used=  Σ ledger issues − Σ ledger returns, same shift, same line
loss         =  fgEquiv(actually_used − should_use)     [computed live, never stored]
```

---

# PART B — assessment, and what I'd change

## B1. What the model does well

**On-hand is never stored.** Every quantity is replayed from events. This is the right
call and I would not change it.

**The `qty_base` / `qty_entered` + `unit` pattern.** Storing the canonical number *and*
what the human typed means "3 bundles" survives as evidence while the maths stays clean.
`consignments` and `kasani_requests` do this. **`ledger` does not** — see below.

**Snapshot columns.** `sku_desc` and `packmat_code` copied onto transactions means a
report from six months ago still reads correctly even if the master has changed since.

**The audit trio on `kasani_requests`.** Storing *why* a number was asked for, not just
the number, is the thing most systems forget.

---

## B2. What it cannot answer today

These are real questions your team will ask, that the current schema cannot answer:

| Question | Why it fails |
|---|---|
| "Invoice INV-A was bad — which lines got material from it?" | **No lot traceability.** Kasani knows stock came off INV-A, but the PM store `ledger` has no lot identity at all. The chain breaks at the factory gate. |
| "Which truck drew stock off INV-A?" | `consumeFifo()` **mutates `qty_remaining` in place** with no record of who consumed what. |
| "We dispatched 1,000 but only 980 arrived — where are the other 20?" | `dispatches` and the receiving `ledger` row are **not linked**. In-transit stock is invisible. |
| "How much carton went to the store in August?" | `dispatches.lines` is **jsonb** — not queryable or aggregatable in SQL. |
| "Who did this?" | **No actor on any table.** Not one `created_by`. |
| "Show me stock count #7 and who signed it" | Sunday counts are loose `adjust` rows identified only by a text note. **No count header.** |
| "Was this issue against a request or ad-hoc?" | `ledger` has **no `request_id`**. The link only exists in the other direction. |
| "Reproduce last month's shortfall report" | Shortfall is computed in the browser and **never stored**. Change the SKU master and history changes with it. |

---

## B3. Recommended changes

### P1 — do before go-live

**1. Actor on every transaction.** Nothing records who did anything. For a factory
system that's the first question after any dispute.

```sql
alter table ledger          add column if not exists created_by text;
alter table consignments    add column if not exists created_by text;
alter table dispatches      add column if not exists created_by text;
alter table requests        add column if not exists created_by text;
alter table kasani_requests add column if not exists created_by text;
```
Even the role string (`store` / `kasani` / `pat:K1A`) is worth far more than nothing. Real
Supabase Auth later gives you `auth.uid()` and this becomes free.

**2. Tighten RLS.** Every table is `using (true) with check (true)` — the publishable key
is in the browser, so **anyone with the URL can read and write everything, including
deleting your SKU master.** Fine for a pilot, not for live.

**3. Structured units on `ledger`**, matching what `consignments` already does. The
entered unit currently lives in `note` as prose, which no query can use.
```sql
alter table ledger add column if not exists qty_entered  numeric;
alter table ledger add column if not exists unit         text;
alter table ledger add column if not exists unit_variant text;
alter table ledger add column if not exists packmat_code text;   -- snapshot
```

**4. Link an issue back to its request.**
```sql
alter table ledger add column if not exists request_id bigint;
alter table ledger add column if not exists ref_type   text;   -- 'request' | 'dispatch' | 'count'
alter table ledger add column if not exists ref_id     bigint;
```

**5. Constrain `direction`.** It's free text; one typo (`Issue` vs `issue`) silently
corrupts every balance.
```sql
alter table ledger add constraint ledger_direction_ck check (
  direction in ('receive','return','issue','block','unblock','scrap','adjust'));
```

---

### P2 — makes the analytics genuinely stronger

**6. `dispatch_lines` — normalise the jsonb.** This single change unlocks most of the
supply-chain reporting you'll want.
```sql
create table if not exists dispatch_lines (
  id            bigint generated always as identity primary key,
  dispatch_id   bigint not null,
  request_id    bigint,
  sku_code      text,
  sku_desc      text,
  packmat       text,
  packmat_code  text,
  qty_base      numeric,
  shift         text,
  priority      int,
  short_at_plan numeric
);
create index on dispatch_lines (dispatch_id);
create index on dispatch_lines (sku_code, packmat);
```
Keep the jsonb as-is for now and write both; drop it once queries have moved over.

**7. `stock_consumption` — where dispatched stock actually came from.** This is the
missing half of traceability, and it is cheap.
```sql
create table if not exists stock_consumption (
  id             bigint generated always as identity primary key,
  ts             timestamptz default now(),
  consignment_id bigint not null,      -- the invoice lot it came off
  dispatch_id    bigint,
  sku_code       text,
  packmat        text,
  qty_base       numeric,
  created_by     text
);
```
`consumeFifo()` already knows all of this — it just throws it away. Writing one row per
draw-down gives you a full recall chain: **invoice → truck → store → line.**

**8. `stock_counts` — a header for the Sunday count.**
```sql
create table if not exists stock_counts (
  id         bigint generated always as identity primary key,
  ts         timestamptz default now(),
  count_date date,
  site       text,          -- 'pm_store' | 'kasani'
  counted_by text,
  note       text,
  lines      int
);
alter table ledger add column if not exists stock_count_id bigint;
```
Then a count is one auditable event, not scattered rows sharing a note.

**9. Close the dispatch → receipt loop.** Add to `dispatches`: `received_at`,
`received_by`, `qty_variance`. When the store books the incoming truck, write
`ledger.ref_type='dispatch'` + `ref_id`. That gives you **in-transit stock** (dispatched,
not yet received) and transit losses — neither of which is visible today.

**10. A shift view, so SQL sees what the app sees.** Shift is derived in JavaScript, so
you cannot query by shift in Supabase.
```sql
create or replace view ledger_shift as
select l.*,
  (case
     when extract(hour from l.ts at time zone 'Asia/Kolkata') between 6  and 13 then 'A'
     when extract(hour from l.ts at time zone 'Asia/Kolkata') between 14 and 21 then 'B'
     else 'C' end) as shift_derived,
  (case
     when extract(hour from l.ts at time zone 'Asia/Kolkata') < 6
       then (l.ts at time zone 'Asia/Kolkata')::date - 1
     else (l.ts at time zone 'Asia/Kolkata')::date end) as shift_date
from ledger l;
```
One view and every shift report becomes a plain SQL query.

---

### P3 — worth doing, not urgent

**11. Snapshot the shortfall.** A `shortfall_runs` table storing what was computed and
against what stock. Otherwise a report cannot be reproduced after the master changes.

**12. Per-material shelf life.** `SHELF_LIFE_DAYS = 180` is a single constant in code.
Laminate and cartons almost certainly differ.
```sql
alter table pack_config add column if not exists shelf_life_days int default 180;
```

**13. SKU master history.** A `skus_history` table (or a trigger) so a changed packmat
code doesn't silently rewrite the past.

**14. `phasing` period clarity.** `plan_date` means three different things depending on
`horizon`. It works, but `period_start` + `period_end` + `period_type` would remove a
whole class of future bug.

**15. FK constraints.** There isn't one in the schema. Adding them to `sku_code` columns
would have caught the blank-packmat-code problem the day it happened.

---

## B4. What I would *not* change

- **The event-sourced ledger.** Correct, and the foundation of everything.
- **`consignments` as both GR document and stock lot.** One row per invoice × packmat ×
  location is genuinely the right grain.
- **`pack_config` doing units and truck capacity together.** They're the same fact viewed
  two ways.
- **Deriving components from `primary_type` / `outer_type`.** Adding a `sku_packmats`
  child table would be more "correct" and would buy you nothing.
- **`phasing` holding all three horizons.** One table, one loader, easy to reason about.

---

## B5. If you only do three things

1. **`created_by` everywhere + tighten RLS.** Right now the system cannot say who did
   anything, and anyone with the URL can delete the SKU master.
2. **`stock_consumption`.** Turns FIFO from a number that moves into a recall chain you
   can follow: invoice → truck → store → line.
3. **`dispatch_lines`.** Unlocks nearly all the supply-chain analytics still on your list,
   and takes an afternoon.

Everything else can follow once the pilot has real data in it.
