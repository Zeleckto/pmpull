# Running PM Pull on an offline LAN

Written 2026-09-16. For the air-gapped deployment: one server PC, three laptops, no internet.

**Recommendation in one line: buy a cheap Wi-Fi router (WAN port left empty), install
PostgreSQL + Node on the server PC, and run one small Node process that serves both the
app and the data. No Docker, no internet, two installers.**

Reasoning below, with the self-hosted Supabase alternative fully specified as well.

---

## Part 1 — The network. Do this first, it is the cheapest part to get wrong.

### Don't use peer-to-peer cables

Your PC has **one** Ethernet port. Three laptops cannot plug into one port. Direct cables
would need three separate network adapters in the server and three separate subnets — a
mess to configure and impossible to extend.

### Two options

| | 5-port unmanaged switch | **Wi-Fi router, WAN port empty** ← recommended |
|---|---|---|
| Cost | ₹600–1,500 | ₹1,200–2,500 |
| Wiring | PC + 3 laptops all plug in | Same, plus Wi-Fi |
| IP addresses | **Manual static IP on every machine** | **DHCP — automatic** |
| Phones (PAT Line) | ❌ cannot connect | ✅ over Wi-Fi |
| Internet exposure | None | None — the WAN port stays unplugged |

**The router wins on one point that matters a lot: PAT Line is designed to be used on a
phone at the machine.** With a switch and cables only, operators cannot use it. A router
with the internet port left empty is just as isolated — it is a private LAN with no route
out — but line operators can reach the app from a handset.

Tell your security team exactly that: *a standalone router with no WAN connection,
DHCP only, no bridging to any corporate network.* That is a much easier conversation than
"a server on the corporate LAN".

### Setting it up

1. Plug the router in. **Leave the WAN/Internet port empty.**
2. Disable its internet-facing features in the admin page: WAN/DHCP client, UPnP, remote
   management. Set a strong Wi-Fi password.
3. Cable the server PC to a LAN port. Cable or Wi-Fi the laptops.
4. **Give the server PC a fixed address.** Either a DHCP reservation in the router
   (easiest), or a static IP on the PC:
   - Windows → Settings → Network → Ethernet → IP assignment → Edit → Manual → IPv4 on
   - IP `192.168.1.10`, mask `255.255.255.0`, gateway `192.168.1.1`
   - **Leave DNS blank** — there is no internet to resolve.
5. Open the firewall on the server PC for the app port. In an **Administrator** PowerShell:
   ```powershell
   New-NetFirewallRule -DisplayName "PM Pull" -Direction Inbound -LocalPort 3000 `
     -Protocol TCP -Action Allow -Profile Private
   ```
   Set the network profile to **Private**, not Public, or Windows blocks inbound anyway.
6. From a laptop, browse to `http://192.168.1.10:3000`. Bookmark it on all four machines.

> Use `192.168.1.x` or `10.0.0.x`. Avoid whatever range the corporate network uses, so
> there is no chance of a routing surprise if someone plugs the wrong cable in.

---

## Part 2 — Which backend

### The honest comparison

| | **PostgreSQL + small Node API** ← recommended | Self-hosted Supabase (Docker) |
|---|---|---|
| Install | 2 installers (~400 MB) | Docker + ~2–3 GB of images via USB |
| Processes | **1** | ~10 containers |
| RAM | ~300 MB | 4 GB minimum, 8 GB comfortable |
| Code changes | ~2 files (I write them) | **None** |
| SQL editor | pgAdmin (ships with Postgres) | Supabase Studio (familiar) |
| Server IP baked into build? | **No** — API is a relative path | Yes — rebuild if the IP changes |
| Docker Desktop licence | n/a | ⚠️ **See below** |
| Debugging with no internet | Simple, one log file | 10 containers, no Stack Overflow |

### The Docker Desktop problem

**Docker Desktop requires a paid subscription for companies over 250 employees or $10M
revenue.** Unilever is far past both. Using it without a licence is a compliance issue —
exactly the kind of thing you are trying to avoid.

Free alternatives exist (Rancher Desktop, Podman Desktop, or Docker Engine directly on
WSL2 — the *Engine* is Apache-2.0 and free, it is *Desktop* that is licensed), but each
adds setup friction on a machine with no internet to troubleshoot from.

### Why I recommend Postgres + Node

1. **No internet to debug with.** When ten containers misbehave you cannot search for the
   error. One Node process writing to one log file, you can read and fix.
2. **No licensing question.** PostgreSQL and Node are both permissively licensed.
3. **The API becomes a relative path.** One process serves the app *and* the data, so the
   browser calls `/api/...` — the server's IP is never baked into the build. Change the IP,
   nothing breaks, no rebuild.
4. **The app's use of Supabase is tiny.** Thirteen methods: `from, select, insert, update,
   upsert, delete, eq, neq, in, is, order, limit, single`. A shim implementing those is a
   few hundred lines, and then **`data.js` and `dataKasani.js` do not change at all.**
5. **You have no auth or RLS to lose.** Every policy is `using (true) with check (true)`.
   Supabase's auth and row-level security are its main advantages and you are not using them.

Pick self-hosted Supabase instead if: you want **zero** code changes, the server has 8 GB+
RAM, you can clear a Docker runtime with IT, and you value Studio's SQL editor enough to
carry ten containers for it.

---

## Part 3A — Steps: PostgreSQL + Node  (recommended)

### On a machine that *does* have internet (one time)

1. Download to a USB stick:
   - **PostgreSQL 16 Windows installer** (EDB, ~350 MB) — includes pgAdmin 4
   - **Node.js 20 LTS Windows MSI** (~30 MB)
2. On your current dev machine, build the app and gather dependencies:
   ```bash
   npm install            # make sure node_modules is complete
   npm run build          # produces dist/
   ```
3. Copy the **whole project folder** onto the USB — including `node_modules`, `dist`,
   `sql/`, and the server files. `node_modules` is the point: it means **no `npm install`
   is needed on the offline PC**, which is otherwise a blocker.

### On the offline server PC

4. Install PostgreSQL. Set a password for the `postgres` user and **write it down**.
   Accept port `5432`. Let it install pgAdmin too.
5. Install Node.js. Accept defaults.
6. Copy the project folder from USB to e.g. `C:\pmpull`.
7. Create the database — open **SQL Shell (psql)** from the Start menu:
   ```sql
   CREATE DATABASE pmpull;
   ```
8. Run your schema files **in order**, from a normal PowerShell:
   ```powershell
   cd C:\pmpull
   $env:PGPASSWORD="your-postgres-password"
   $files = @(
     "supabase_setup.sql","migration_v2.sql","kasani_requests.sql",
     "sql\phase2.sql","sql\phase3.sql","sql\phase4.sql","sql\phase5.sql",
     "sql\phase6.sql","sql\phase7.sql","sql\phase8.sql","sql\phase9.sql",
     "sql\phase10.sql","sql\phase11.sql","sql\phase12.sql"
   )
   foreach ($f in $files) {
     Write-Host "--- $f"
     & "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -d pmpull -f $f
   }
   ```
   **Expect some errors and ignore them:** the `alter table ... enable row level
   security`, `create policy`, and `notify pgrst, 'reload schema'` lines are
   Supabase/PostgREST-specific. RLS works on plain Postgres but the policies are
   meaningless without PostgREST's JWT handling, and `notify pgrst` is harmless.
   Anything about *tables* or *columns* failing is a real error — tell me and I will fix it.

9. Set the database connection. Create `C:\pmpull\.env.server`:
   ```
   PGHOST=localhost
   PGPORT=5432
   PGUSER=postgres
   PGPASSWORD=your-postgres-password
   PGDATABASE=pmpull
   PORT=3000
   ```
10. Start it:
    ```powershell
    cd C:\pmpull
    node server\index.js
    ```
    You should see `PM Pull serving on http://0.0.0.0:3000`.

11. **Make it start automatically.** Task Scheduler → Create Task:
    - *General*: "PM Pull server", **Run whether user is logged on or not**, Run with
      highest privileges
    - *Triggers*: At startup
    - *Actions*: Start a program → `C:\Program Files\nodejs\node.exe`
      → arguments `server\index.js` → start in `C:\pmpull`
    - *Settings*: restart if it fails, every 1 minute

12. Browse from a laptop to `http://192.168.1.10:3000`.

### Code changes required (I write these — two new files, one edited)

| File | Change |
|---|---|
| `server/index.js` | **New.** Express: serves `dist/` as static files, and `POST /api/query` which translates a query descriptor into parameterised SQL via `pg`. Table names whitelisted. |
| `src/localClient.js` | **New.** A shim exposing the same chainable surface as `supabase-js` — `.from().select().eq().order()` etc — that posts to `/api/query`. |
| `src/supabase.js` | **Edited.** Export the shim instead of the Supabase client. |
| `data.js`, `dataKasani.js`, every screen | **Unchanged.** |

Two extra dependencies, both tiny: `express` and `pg`.

---

## Part 3B — Steps: self-hosted Supabase (the zero-code-change route)

### On a machine with internet (one time)

1. Get the repo:
   ```bash
   git clone --depth 1 https://github.com/supabase/supabase
   cd supabase/docker
   cp .env.example .env
   ```
2. Pull and export the images:
   ```bash
   docker compose pull
   docker save -o supabase-images.tar $(docker compose config --images)
   ```
   That tar is roughly 2–3 GB. Copy it, the `docker/` folder, a Docker runtime installer,
   and your built `dist/` folder to a USB stick.

### On the offline server PC

3. Install a container runtime — **Rancher Desktop or Podman Desktop** rather than Docker
   Desktop, for the licensing reason above.
4. Load the images:
   ```powershell
   docker load -i supabase-images.tar
   ```
5. Edit `docker/.env`:
   - `POSTGRES_PASSWORD` — change it
   - `JWT_SECRET` — 40+ random characters
   - `ANON_KEY` / `SERVICE_ROLE_KEY` — **these must be JWTs signed with your `JWT_SECRET`.**
     The generator on supabase.com needs internet. The shipped `.env.example` defaults are
     a matched set and will work as-is on an isolated LAN — acceptable for a pilot,
     **not** acceptable if this network is ever bridged. I can give you an offline Node
     script to mint proper ones.
   - `API_EXTERNAL_URL` and `SUPABASE_PUBLIC_URL` → `http://192.168.1.10:8000`
6. Start it:
   ```powershell
   cd docker
   docker compose up -d
   docker compose ps          # confirm which host ports Kong and Studio landed on
   ```
   > Port numbers move between Supabase releases. Read them from `docker compose ps` and
   > `.env` (`KONG_HTTP_PORT`, `STUDIO_PORT`) rather than assuming 8000/3000.
7. Open Studio in a browser, go to the SQL editor, and paste your 14 SQL files in order —
   exactly the workflow you already know. **No errors expected**, since this is real
   Supabase.
8. Point the app at it. Edit `.env.local`:
   ```
   VITE_SUPABASE_URL=http://192.168.1.10:8000
   VITE_SUPABASE_PUBLISHABLE_KEY=<the ANON_KEY from docker/.env>
   ```
   then `npm run build`.
9. Serve `dist/` — the app has **no client-side routing**, so any static server works:
   ```powershell
   npx serve -s dist -l 3000        # or add an nginx container to the compose file
   ```

> ⚠️ **Vite bakes `VITE_*` values in at build time.** If the server's IP changes you must
> rebuild. On the Postgres+Node route this cannot happen, because the API path is relative.

---

## Part 4 — Backups. Not optional.

One PC, no internet, no cloud. If that disk fails you lose everything.

`C:\pmpull\backup.bat`:
```bat
@echo off
set PGPASSWORD=your-postgres-password
set STAMP=%date:~-4%%date:~3,2%%date:~0,2%_%time:~0,2%%time:~3,2%
set STAMP=%STAMP: =0%
"C:\Program Files\PostgreSQL\16\bin\pg_dump.exe" -U postgres -d pmpull -F c ^
  -f "D:\pmpull_backups\pmpull_%STAMP%.dump"
forfiles /p "D:\pmpull_backups" /m *.dump /d -30 /c "cmd /c del @path" 2>nul
```

Task Scheduler → daily at 05:00. Point it at a **different physical drive** or a USB stick,
not the same disk. Once a week, copy the newest dump onto a second USB and keep it
somewhere else in the building.

**Test the restore once**, before you need it:
```powershell
createdb -U postgres pmpull_test
pg_restore -U postgres -d pmpull_test "D:\pmpull_backups\pmpull_20260916_0500.dump"
```
A backup you have never restored is not a backup.

---

## Part 5 — Other things worth knowing

**Browsers will call it "Not secure".** Plain `http://` on a LAN IP. That is cosmetic —
nothing the app does needs a secure context. Ignore it. Do not fight with self-signed
certificates; they cause more problems than they solve here.

**The server PC must stay on.** Disable sleep and hibernation:
```powershell
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
```
Set Windows Update to not auto-restart. A UPS is worth the money — an unclean shutdown
mid-write is the most likely way to corrupt the database.

**Clock accuracy matters.** Shifts are derived from timestamps and the PC cannot reach an
internet time server. Check the clock monthly; drift silently mis-files movements into the
wrong shift.

**Getting data in and out.** Excel uploads work exactly as now — the file is read in the
browser, nothing external is contacted. Exports download normally. Moving data between
this island and the corporate network is a USB job, and worth agreeing a rule for with
security up front.

**If the server dies mid-shift**, the laptops show a connection error and no work is lost
that was already saved — but nothing can be recorded until it is back. Keep a paper
fallback for the store, and restore from the previous night's dump onto any spare PC with
Postgres installed.

---

## Part 6 — Alternatives, briefly

| Idea | Verdict |
|---|---|
| Everything on one laptop, others use Remote Desktop | Works, but one user at a time. No. |
| SQLite file on a shared folder | Multi-writer over SMB corrupts SQLite. **No.** |
| Postgres on the server, app installed on each laptop | Possible, but three copies to update every change. Central serving is better. |
| Raspberry Pi as the server | Genuinely good — low power, silent, cheap, runs Postgres + Node happily. Worth considering if the PC is needed elsewhere. |
| Keep using Netlify/Supabase over a phone hotspot | No. That is exactly the exposure the policy exists to prevent. |

---

## What I need from you to proceed

1. **Which route** — Postgres + Node, or self-hosted Supabase?
2. **Server PC specs** — RAM in particular. Under 8 GB rules out the Supabase route.
3. **Switch or router**, so I know whether phones are in scope for PAT Line.

On "Postgres + Node" I will write `server/index.js` and `src/localClient.js`, adjust
`src/supabase.js`, and give you a single tested folder to copy to the USB stick. Every
other file in the project stays exactly as it is.
