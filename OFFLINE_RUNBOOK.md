# PM Pull offline — build it on your laptop, then move it to the server PC

Written 2026-09-16. Follow Part 1 on your laptop today. Part 3 moves it to the PC.

**Nothing was removed.** The cloud path still works: if `VITE_SUPABASE_URL` is set the app
talks to Supabase exactly as before, and if it isn't, it talks to the local server. Same
code, both modes. All the work is on branch `offline`; `main` is untouched.

---

## What changed, in full

| File | |
|---|---|
| `sql/schema.sql` | **New.** All 14 SQL files consolidated into one. The old files stay as history. |
| `server/index.js` | **New.** Serves the app *and* the API from one Node process. |
| `server/config.example.json` | **New.** Copy to `config.json` and fill in. Git-ignored — it holds the password. |
| `src/localClient.js` | **New.** Stands in for supabase-js against our own API. |
| `src/supabase.js` | **Edited.** Picks cloud or local. Three lines of logic. |
| `vite.config.js` | **Edited.** Dev proxy so `npm run dev` reaches the API. |
| `package.json` | **Edited.** Added `express`, `pg`, and two scripts. |
| Everything else | **Untouched.** `data.js`, `dataKasani.js`, every screen — not one line. |

The last row is the point. The app only used thirteen supabase-js methods, so the shim
implements those and nothing above it noticed.

---

## Part 1 — Your laptop (you have internet, so do this first)

### 1. Install PostgreSQL

Download **PostgreSQL 16** for Windows (EDB installer). During setup:
- Set a password for user `postgres` — **write it down**
- Port `5432`
- Leave pgAdmin 4 ticked (it is your SQL editor, replacing Supabase Studio)

### 2. Create the database and load the schema

Open **SQL Shell (psql)** from the Start menu, press Enter through the prompts, enter your
password, then:
```sql
CREATE DATABASE pmpull;
\q
```

Then in PowerShell, from the project folder:
```powershell
cd "C:\Users\jagan\Desktop\HUL\KPF PM Pull Website\pmpull"
$env:PGPASSWORD="your-postgres-password"
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -d pmpull -f sql\schema.sql
```

**Expect no errors.** `schema.sql` is written for plain PostgreSQL — the RLS and
`notify pgrst` lines that Supabase needed are gone. If anything fails, send me the message.

Check it:
```powershell
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -d pmpull -c "\dt"
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -d pmpull -c "select count(*) from lines_map"
```
Expect **12 tables** and **21 machines**.

### 3. Switch the build to offline mode

**This is the easiest thing to get wrong.** Vite reads `.env.local` at build time. While
it contains `VITE_SUPABASE_URL`, the app is built to talk to **Supabase in the cloud** —
which on the offline PC means it reaches for the internet and hangs.

```powershell
ren .env.local .env.cloud.bak
```

Keep the file — renaming it is how you switch back later. The server prints a loud warning
at startup if it spots a cloud build, so you cannot ship one by accident.

### 4. Configure the server

```powershell
copy server\config.example.json server\config.json
notepad server\config.json
```
Set `database.password` to your postgres password. Leave everything else.

### 5. Run it

```powershell
npm install        # picks up express + pg
npm run build
npm run server
```

You should see:
```
PM Pull
  app       http://<this-pc-ip>:3000
  database  postgres@localhost:5432/pmpull
  serving   ...\dist
  status    database OK
```

Open **http://localhost:3000**. The app should load with everything empty — that is correct
on a fresh database.

> If it says `password authentication failed`, the password in `config.json` is wrong.
> If it says `ECONNREFUSED`, PostgreSQL is not running — check Services.

### 6. Load your data

1. **PM Store → Settings → Import SKU master** — your SKU sheet
2. **PM Store → Settings → Import conversion factors** — the per-tonne sheet
3. **Kasani → ⚙ Truck & unit settings** — fill in box / roll / bundle sizes and truck capacities
4. **Kasani → Stock Status → Load opening stock** — the qty-in-hand sheet
5. **PM Store → Sunday stock count** — key in the store's own opening stock

### 7. Working on the code from here

Two terminals:
```powershell
npm run server     # terminal 1 — API on :3000
npm run dev        # terminal 2 — Vite on :5173, hot reload
```
Use **http://localhost:5173** while developing. Vite forwards `/api` to :3000, so the
relative path works the same as in the built app.

When done: `npm run build`, then check http://localhost:3000.

---

## Part 2 — The network (once the laptop works)

Covered in detail in `OFFLINE_SETUP.md`. The short version:

1. Cheap Wi-Fi router, **WAN/internet port left empty**. Disable UPnP and remote admin.
2. Server PC gets a fixed address — DHCP reservation in the router is easiest, or static
   `192.168.1.10 / 255.255.255.0 / gateway 192.168.1.1`, **DNS blank**.
3. Open the firewall on the server PC, in an **Administrator** PowerShell:
   ```powershell
   Set-NetConnectionProfile -NetworkCategory Private
   New-NetFirewallRule -DisplayName "PM Pull" -Direction Inbound -LocalPort 3000 `
     -Protocol TCP -Action Allow -Profile Private
   ```
4. From a laptop: `http://192.168.1.10:3000`. Bookmark it everywhere, phones included.

---

## Part 3 — Moving it to the server PC

The PC has no internet, so you cannot `git clone` from GitHub and you cannot `npm install`.
Both are solved by what you carry on the USB stick.

### On your laptop — prepare the stick

```powershell
cd "C:\Users\jagan\Desktop\HUL\KPF PM Pull Website\pmpull"

# 1. commit your work
git add -A
git commit -m "offline: postgres + node server"

# 2. pack the ENTIRE repo — all branches, all history — into one file
git bundle create D:\pmpull.bundle --all
```

`git bundle` exists for exactly this: a whole git repository as a single file you can carry
across an air gap and clone from as if it were a remote.

Also copy onto the stick:
- `D:\pmpull.bundle`
- **the `node_modules` folder** — zip it. Without this the PC cannot install dependencies.
- the PostgreSQL installer
- the Node.js installer (unless the PC already has it — you said it does)

### On the server PC

```powershell
# 1. clone from the bundle, exactly like cloning a remote
cd C:\
git clone D:\pmpull.bundle pmpull
cd C:\pmpull
git checkout offline

# 2. restore dependencies — unzip the node_modules folder into C:\pmpull\node_modules
#    (no npm install, no internet needed)

# 3. database
createdb -U postgres pmpull
psql -U postgres -d pmpull -f sql\schema.sql

# 4. config
copy server\config.example.json server\config.json
notepad server\config.json          # set the password

# 5. build and run
npm run build
npm run server
```

Browse from a laptop to `http://192.168.1.10:3000`.

### Later updates from the laptop

Same trick, and the PC keeps its git history:
```powershell
# laptop
git bundle create D:\pmpull-update.bundle --all

# server PC
cd C:\pmpull
git pull D:\pmpull-update.bundle offline
npm run build
# restart the server
```

If you changed dependencies, re-copy `node_modules` too.

---

## Part 4 — Make it survive a reboot

**Task Scheduler** → Create Task:
- *General* — name "PM Pull", **Run whether user is logged on or not**, Run with highest privileges
- *Triggers* — At startup
- *Actions* — Start a program:
  - Program: `C:\Program Files\nodejs\node.exe`
  - Arguments: `server\index.js`
  - Start in: `C:\pmpull`
- *Settings* — tick *If the task fails, restart every 1 minute*, up to 3 times

**Stop the PC sleeping:**
```powershell
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
```

**Backups** — `C:\pmpull\backup.bat`, scheduled daily at 05:00, writing to a **different
drive**:
```bat
@echo off
set PGPASSWORD=your-postgres-password
set STAMP=%date:~-4%%date:~3,2%%date:~0,2%_%time:~0,2%%time:~3,2%
set STAMP=%STAMP: =0%
"C:\Program Files\PostgreSQL\16\bin\pg_dump.exe" -U postgres -d pmpull -F c -f "D:\pmpull_backups\pmpull_%STAMP%.dump"
forfiles /p "D:\pmpull_backups" /m *.dump /d -30 /c "cmd /c del @path" 2>nul
```

**Test the restore once**, before you need it:
```powershell
createdb -U postgres pmpull_test
pg_restore -U postgres -d pmpull_test "D:\pmpull_backups\pmpull_20260916_0500.dump"
```

---

## Part 5 — Checklist before you trust it

| | Check |
|---|---|
| ☐ | `http://<server-ip>:3000` opens from **each** laptop |
| ☐ | Opens on a **phone** over Wi-Fi (PAT Line) |
| ☐ | PAT Line: raise a request → it appears in PM Store |
| ☐ | PM Store: **Issue…** with a changed quantity → ledger row written, request closed with both figures |
| ☐ | Sunday stock count → inventory moves to the counted figure |
| ☐ | Kasani: Goods Received → appears in Stock Status |
| ☐ | Kasani: Dispatch → plan → Send ILT → stock drops, request closes |
| ☐ | Commercial: all six cards open |
| ☐ | An Excel upload works (parsing is in the browser, so it should) |
| ☐ | Reboot the server PC — the app comes back on its own |
| ☐ | Unplug the network cable — the app says it cannot reach the server, in plain words |
| ☐ | `backup.bat` runs and produces a `.dump` |
| ☐ | A restore from that dump works |
| ☐ | Server PC clock is correct — **shifts are derived from it** |

---

## Notes

**Browsers will say "Not secure".** Plain `http://` on a LAN IP. Cosmetic. Nothing the app
does needs a secure context. Do not bother with self-signed certificates.

**The server's IP is never baked into the build.** The app calls `/api/...`, a relative
path. Change the IP, or move the whole thing to a different PC — no rebuild.

**To go back to Supabase**, put `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`
back into `.env.local` and rebuild. The cloud path was never removed.

**Check the clock monthly.** The PC cannot reach a time server. Drift silently files
movements into the wrong shift.

**A UPS is worth the money.** An unclean shutdown mid-write is the most likely way to
corrupt the database.
