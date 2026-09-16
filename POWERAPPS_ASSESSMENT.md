# Porting PM Pull to Power Platform — feasibility assessment

Written 2026-09-07, for the decision on moving off React + Supabase onto Unilever's
approved Power Platform stack.

**Short answer: yes, it is feasible, and three specific things will be genuinely hard.
Budget 3–4 months with an experienced maker, not 3–4 weeks. Some parts of the system get
materially *better* on Power Platform.**

---

## 1. Ask this before you commit

The requirement as passed to you is "convert it to Power Apps". That may not be the
actual constraint. Worth establishing with whoever raised the approval issue:

| Question | Why it changes the answer |
|---|---|
| Is the objection **the platform**, or **where the data lives**? | Supabase is a third-party, non-Unilever-hosted Postgres holding factory operational data. That is a legitimate governance objection — and it is fixable *without* a rewrite by moving to Azure SQL or an approved internal API. |
| Would **Power Apps + an approved data source** satisfy it? | If so, the UI rewrite is the only work; the data model survives almost unchanged. |
| Would a **Power BI report over an approved database** satisfy the analytics half? | Most of the Commercial screen is reporting. Power BI is the sanctioned tool and does it better than my hand-rolled tables. |
| Is there a **Power Platform CoE** at Unilever? | There will be. They own environments, DLP policies and connector approvals. Nothing ships without them. Engage them in week 1, not month 3. |
| What **licences** do the shop-floor users have? | PAT Line is used by line operators. If each needs a Power Apps licence, that is a per-head cost on a large population. Per-app plans are cheaper than per-user. This is often the thing that kills factory apps. |

If the answer to the second question is yes, stop reading at section 4 — the job is much
smaller than a full port.

---

## 2. What maps across cleanly

| Today | Power Platform | Difficulty |
|---|---|---|
| React screens (4 roles) | **Canvas apps** — one per role, or one with role-based navigation | Straightforward, tedious |
| PAT Line on a phone | **Canvas app, phone layout**, in the Power Apps mobile shell | Easy — and gains offline capability |
| Supabase Postgres (12 tables) | **Dataverse tables** | Direct mapping, see §5 |
| `data.js` / `dataKasani.js` | Power Fx + Dataverse queries | Straightforward |
| Role PINs in `Login.jsx` | **Entra ID SSO + Dataverse security roles** | Much better — see §4 |
| Netlify hosting | Power Apps runtime | Not applicable, disappears |
| Analytics screens | **Power BI** | Better, but a rebuild not a port |
| Excel exports | Power BI export / Office connectors | Easy |

---

## 3. The three genuinely hard parts

### 3.1 On-hand is computed by replaying the whole ledger — this will not survive

This is the single biggest issue and it needs deciding up front.

Today `computeOnHand()` pulls **every** `ledger` row into the browser and folds it in time
order. That is what makes the system trustworthy: no stored balance can drift.

**Canvas apps cannot do this.** Power Fx has a *delegation limit* — by default it retrieves
500 rows from a data source, configurable to a maximum of 2,000. Beyond that it silently
truncates. A factory ledger will pass 2,000 rows in weeks, and you would get **wrong stock
figures with no error message**. That is the worst possible failure mode.

Three ways out, in order of preference:

**(a) Materialised balance, ledger kept for audit.** Add a `stock_balance` table
(sku × packmat × site → qty). Every movement writes the ledger row *and* updates the
balance in the same transaction, via a **Dataverse plugin** (C#, runs server-side) or a
Power Automate flow. Screens read the balance table — tiny, always delegable.
- Cost: gives up "no stored balance". Mitigate with a nightly recompute-and-reconcile
  flow that flags any drift.
- The `adjust` direction (Sunday count) sets an absolute value, so the plugin must handle
  it explicitly — and the ordering bug we just fixed becomes a server-side concern.

**(b) Dataverse rollup columns.** Server-side aggregation, no code. But they recalculate
**on a schedule (hourly by default)**, not in real time. A store issuing packmat cannot
wait an hour to see stock move. Not suitable for on-hand; fine for slow-moving KPIs.

**(c) Push the calculation to Power BI.** Correct for reporting, useless for the
operational screens that need a live figure at the moment of issue.

**Recommendation: (a).** It is more work but it is the only option that gives a correct,
immediate number.

### 3.2 The algorithms don't fit Power Fx

Three pieces of real logic are sequential loops with accumulating state:

- **Truck packing** (`KasaniDispatch.jsx`) — fill to 90%, split large asks across trucks,
  open a new truck when full. A `while` loop mutating a running total.
- **FIFO consumption** (`consumeFifo`) — walk consignments oldest-first, draw down each
  until the quantity is satisfied, allow the last to go negative.
- **Ledger replay** (`computeOnHand`) — fold in time order, where `adjust` overwrites.

Power Fx has `ForAll`, but it is a **functional map, not a sequential loop** — iteration
order is not guaranteed and accumulating a running total across iterations is unreliable.
Trying to force these into Power Fx is a well-known way to produce something that works
in demo and fails in production.

**Put them where loops actually exist:**

| Logic | Home | Why |
|---|---|---|
| Truck packing | **Power Automate flow** | Has `Do Until`, variables, proper sequencing. User taps "Plan trucks", flow returns the plan. |
| FIFO consumption | **Dataverse plugin (C#)** | Must be atomic and server-side — two dispatches drawing the same stock at once would corrupt it otherwise. |
| Ledger replay / balance | **Dataverse plugin** | Same reason. |
| Unit and tonne conversions (`theo`, `fgEquiv`) | **Power Fx** | Pure arithmetic, no loops. Ports directly. |
| Shift derivation from timestamp | **Power Fx** or a Dataverse calculated column | Simple date maths. |

A plugin means **C# and a developer**, not a citizen maker. Worth knowing before you scope
this as a low-code project.

### 3.3 Spreadsheet upload with flexible headers

The app currently parses six different sheet formats in the browser, matching headings
loosely (`/qty|tonne|demand/`) and showing an instant preview before anything is written.

Canvas apps cannot read an uploaded Excel file's contents. The standard pattern is:

```
User drops file in SharePoint/OneDrive
   → Power Automate trigger
   → parse (Excel connector, or Office Script for anything awkward)
   → validate
   → write to Dataverse
   → notify the user
```

That works, but it is **a different experience**: not instant, no in-app preview-then-confirm,
and errors arrive by email or a status list rather than on screen.

The 19-week plan sheet is the hard one — **columns are dynamic** (`37.2026`, `38.2026`, …).
The Excel connector wants a fixed table shape. This needs an **Office Script** (TypeScript,
runs in Excel Online) to unpivot wide → tall before the flow picks it up. Doable, but it
is real work and a technology most Power Platform makers have not used.

**Cheaper alternative worth considering:** make the planners submit a *tall* sheet
(SKU, week, tonnes) instead of wide. One conversation with the planning team may remove a
week of engineering.

---

## 4. What gets genuinely better

Being fair to the platform — several of the weaknesses I flagged in `SCHEMA.md` are solved
for free:

| Problem today | On Power Platform |
|---|---|
| **No actor on any row.** Nothing records who did what. | Dataverse stamps `createdby` / `modifiedby` on every row automatically. Solved without writing anything. |
| **RLS is wide open** — anyone with the URL can delete the SKU master. | Entra ID SSO plus Dataverse security roles. Table- and row-level, centrally governed. |
| **No audit history.** | Dataverse auditing is a per-table toggle: full before/after change history. |
| **Cannot send email.** Static frontend, so the expiry alert to planners is a `mailto:` draft. | Power Automate: a scheduled flow, a real email, an approval, or a Teams message. Trivial. Genuinely better than what exists. |
| **PIN-based roles.** | Real identity, real groups, joiners/leavers handled by IT. |
| **No offline.** A tablet losing wifi in the warehouse loses the form. | Power Apps mobile has offline collections and sync. |
| **Analytics hand-built.** | Power BI: proper slicers, drill-through, scheduled refresh, row-level security, and it is the tool your leadership already reads. |

The email alert alone is worth something — that was the one thing I could not build for you.

---

## 5. Dataverse table mapping

The schema ports almost unchanged. Notes on the exceptions:

| Supabase table | Dataverse table | Notes |
|---|---|---|
| `skus` | `pm_sku` | `code` as the primary/alternate key. Straight port. |
| `conversion` | `pm_conversion` | Keyed on weight. Straight port. |
| `pack_config` | `pm_packconfig` | Composite key (packmat, variant) → use an alternate key. |
| `lines_map`, `line_materials` | `pm_line`, `pm_linematerial` | `line_materials` becomes a proper relationship. |
| `ledger` | `pm_ledger` | **Plus a new `pm_stockbalance`** (§3.1). Add the `created_by` you get free. |
| `requests` | `pm_request` | Straight port. `qty_base` / `qty_issued` both kept. |
| `kasani_requests` | `pm_kasanirequest` | Straight port. |
| `consignments` | `pm_consignment` | Straight port. `qty_remaining` mutated by the FIFO plugin. |
| `dispatches` | `pm_dispatch` **+ `pm_dispatchline`** | **The jsonb `lines` column must be normalised** — Dataverse has no usable JSON column type and Power BI cannot read one. This is the P2 change from `SCHEMA.md`, now mandatory rather than optional. |
| `production` | `pm_production` | Straight port. |
| `phasing` | `pm_phasing` | Straight port; `horizon` becomes a choice column. |

**Two schema changes become non-negotiable on this platform:** the balance table (§3.1) and
normalising `dispatches.lines`. Both were already on my recommended list.

**Choice (option-set) columns** should replace the free-text status fields — `direction`,
`status`, `packmat`, `horizon`, `shift`. That removes a whole class of typo bug and gives
Power BI clean labels.

**Data volume:** Dataverse handles this comfortably. **Do not use SharePoint Lists** as the
backend — the 5,000-item view threshold and weak relational support will break the ledger
within months. If cost pressure pushes you toward SharePoint, that is a signal to reduce
scope, not to change the backend.

---

## 6. Realistic effort

For one experienced Power Platform developer with Dataverse and Power Automate experience,
plus access to a C# developer for the plugins:

| Workstream | Effort |
|---|---|
| Environment, DLP, licensing, CoE sign-off | 1–3 weeks (mostly waiting) |
| Dataverse schema + security roles + choice columns | 1–2 weeks |
| Plugins: balance maintenance, FIFO consumption | 2–3 weeks |
| Canvas app — PAT Line (phone) | 1–2 weeks |
| Canvas app — PM Store | 3–4 weeks |
| Canvas app — Kasani (GR, stock, dispatch, settings) | 4–5 weeks |
| Power Automate — uploads, truck planning, alerts | 3–4 weeks |
| Power BI — the Commercial analytics | 2–3 weeks |
| Data migration from Supabase | 1 week |
| UAT, shop-floor testing, fixes | 3–4 weeks |
| **Total** | **~3–4 months elapsed** |

A small team could compress to 6–8 weeks. A single citizen developer without C# support
will struggle with §3.1 and §3.2 and should not be asked to do it alone.

---

## 7. How I can help

**What I cannot do:** build it. I have no access to your Unilever tenant, and Power Apps
is not a code-first tool — canvas apps are authored in a visual designer, and the
underlying `.msapp` is not something to hand-edit.

**What I can do, and where the value is:**

1. **A build-ready functional specification.** Every screen, every field, every rule,
   every validation, written so a Power Platform developer can build without re-deriving
   your business logic. This is the highest-value thing I can produce and it is what a
   contractor or the CoE will ask for first. The React app becomes the reference
   implementation they can run and click through.

2. **The Dataverse schema as a build sheet.** Tables, columns, types, choice sets,
   relationships, alternate keys, security roles — in a form that can be typed straight
   into the maker portal or scripted.

3. **Power Fx formulas** for the parts that port directly: `theo`, `fgEquiv`, `fgCapable`,
   shift derivation, the unit conversions, validation rules. I can write these as actual
   Power Fx.

4. **Pseudocode and flow designs** for the three hard pieces — truck packing, FIFO,
   balance maintenance — expressed as Power Automate steps and C# plugin logic, so the
   developer implements a solved problem rather than inventing one.

5. **Migration scripts.** Export each Supabase table to Dataverse-import-ready CSV, with
   the column renames and choice-value mappings applied.

6. **Keep the React app alive as the pilot.** Do not delete it. It is your requirements
   document, your training tool, and your proof the model works. Real pilot data will
   surface things the spec would miss, and every one of those is cheaper to find now than
   after the Power Apps build.

---

## 8. What I would recommend

1. **Establish the real constraint first** (§1). If it is data residency rather than the
   platform, the cheapest fix is moving the database, not rewriting the app.
2. **Keep running the pilot** while the decision is made. Live data makes the spec better
   and proves the value that justifies the Power Platform investment.
3. **Engage the Power Platform CoE now**, before design. Environments, DLP policy and
   licensing will constrain the design, and finding that out late is expensive.
4. **Get the licensing answer for shop-floor users early.** If PAT Line needs a licence per
   operator, that cost may reshape the whole approach — for instance a shared kiosk device
   per line instead of per-person access.
5. **Decide §3.1 (balance vs replay) before any building starts.** It is the load-bearing
   architectural decision and it is expensive to change later.
6. **Ask the planners for a tall plan sheet.** One conversation may remove the hardest
   piece of the upload work.

The honest summary: this is a real project, not a conversion. The business logic is sound
and proven, which removes most of the risk — but it is a rebuild on a different
architecture, and it should be resourced as one.
