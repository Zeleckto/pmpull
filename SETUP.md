# PM Pull — setting up the server PC, line by line

Written 2026-09-16. Follow top to bottom. Each block is copy-paste.

Two parts: **Part A** gets it running on the PC itself. **Part B** puts it on the network
for the other machines. Do A completely and confirm it works before starting B.

---

## Before you start — you need the dongle for Part A only

With temporary internet on the PC, `git clone` and `npm install` both work and this is
straightforward. **Do not unplug the dongle until the end of Part A**, where there is an
explicit check. After that the system never needs the internet again.

Downloads to get first (or have them on a USB stick as backup):

| | Where | Size |
|---|---|---|
| **Git for Windows** | git-scm.com/download/win | ~60 MB |
| **Node.js 20 LTS** (MSI) | nodejs.org | ~30 MB |
| **PostgreSQL 16 or 17** (EDB installer) | enterprisedb.com/downloads/postgres-postgresql-downloads | ~350 MB |

> Install **one** PostgreSQL version only. On my laptop two versions are installed and the
> second silently took port **5433**, which produces a `password authentication failed`
> error that looks like a wrong password. One version = port 5432 = no confusion.

---

# PART A — get it running on the PC

## A1. Install the three tools

Run each installer with default options, except:

**PostgreSQL** — you will be asked for:
- a password for user `postgres` → **write it down**, you need it twice below
- port → leave **5432**
- locale → default
- Stack Builder at the end → **skip it**

Then close and reopen PowerShell so the new tools are on the path, and check:
```powershell
git --version
node --version
npm --version
psql --version
```
All four must print a version. If `psql` does not, add it to the path for this session:
```powershell
$env:Path += ";C:\Program Files\PostgreSQL\16\bin"
```
(adjust `16` to the version you installed).

## A2. Get the code

```powershell
cd C:\
git clone https://github.com/Zeleckto/pmpull
cd C:\pmpull
git checkout offline
```

**The `git checkout offline` line matters.** A clone lands on `main`, which is the Netlify
version that talks to Supabase over the internet. `offline` is the one that runs locally.

Confirm:
```powershell
git branch
```
must show `* offline`.

## A3. Install the dependencies

```powershell
npm install
```
Takes a minute or two. Needs the dongle.

## A4. Create the database

```powershell
$env:PGPASSWORD="the-password-you-wrote-down"
psql -U postgres -h localhost -p 5432 -d postgres -c "CREATE DATABASE pmpull;"
```
Expect `CREATE DATABASE`.

## A5. Create the tables

```powershell
psql -U postgres -h localhost -p 5432 -d pmpull -v ON_ERROR_STOP=1 -f sql\schema.sql
```

Expect a long list of `CREATE TABLE` / `CREATE INDEX`, ending with `INSERT 0 10` and
`INSERT 0 21`. **No errors.** If anything fails, stop and send me the message.

Check it:
```powershell
psql -U postgres -h localhost -p 5432 -d pmpull -c "\dt"
psql -U postgres -h localhost -p 5432 -d pmpull -c "select (select count(*) from pack_config) units, (select count(*) from lines_map) machines;"
```
Expect **12 tables**, **10 units**, **21 machines**.

## A6. Tell the server how to reach the database

```powershell
copy server\config.example.json server\config.json
notepad server\config.json
```

Change two things and save:
```json
"port": 5432,
"password": "the-password-you-wrote-down"
```

> `config.json` is deliberately **not in git** — it holds the password. That is why you
> create it by hand, and why it survives every `git pull`.

## A7. Build and start

```powershell
npm run build
npm run server
```

You should see:
```
PM Pull
  app       http://<this-pc-ip>:3000
  database  postgres@localhost:5432/pmpull
  serving   C:\pmpull\dist
  status    database OK
```

**`status database OK` is the line that matters.**

Open **http://localhost:3000** on the PC. The app loads, everything empty. That is correct.

Leave this terminal running. `Ctrl+C` stops the server.

## A8. Confirm the database is really being written

In a **second** PowerShell window:
```powershell
cd C:\pmpull
npm run db:watch
```

It refreshes every 2 seconds. Now in the browser: **Inventory → Incoming from Kasani**,
add any quantity, save. The `ledger` count goes up and the movement appears at the bottom,
within two seconds. That is the database, read directly, with the app not involved.

`Ctrl+C` to stop watching.

## A9. Load your real data, in this order

1. **PM Store → Settings → Import SKU master**
2. **PM Store → Settings → Import conversion factors**
3. **Kasani → ⚙ Truck & unit settings** — box / roll / bundle sizes, truck capacities
4. **Kasani → Stock Status → Load opening stock**
5. **PM Store → Sunday stock count** — the store's own opening stock

## A10. ✅ Checkpoint — now you may unplug the dongle

Confirm all of these before disconnecting:

- [ ] `npm run server` starts and says `status database OK`
- [ ] `http://localhost:3000` loads and your SKUs are there
- [ ] `npm run db:watch` shows counts
- [ ] `npm run build` completes without error

Once those pass, **the internet is no longer needed for anything.**

---

# PART B — put it on the network

## B1. Give the PC a fixed IP

Whatever the other machines connect to must not change. Open an **Administrator**
PowerShell.

Find the adapter name:
```powershell
Get-NetAdapter | Where-Object Status -eq 'Up' | Select-Object Name, InterfaceDescription, LinkSpeed
```
Usually `Ethernet`. Use that name below.

```powershell
New-NetIPAddress -InterfaceAlias "Ethernet" -IPAddress 192.168.10.1 -PrefixLength 24
```

**No default gateway and no DNS on purpose** — there is no internet, and leaving them out
stops Windows waiting on a route that does not exist.

> If it says the address already exists, clear it first:
> ```powershell
> Remove-NetIPAddress -InterfaceAlias "Ethernet" -Confirm:$false
> Remove-NetRoute -InterfaceAlias "Ethernet" -Confirm:$false -ErrorAction SilentlyContinue
> ```

Verify:
```powershell
ipconfig | findstr IPv4
```
Expect `192.168.10.1`.

I use `192.168.10.x` rather than `192.168.1.x` so it cannot collide with a corporate range
if a wrong cable is ever plugged in.

## B2. Open the firewall

```powershell
Set-NetConnectionProfile -InterfaceAlias "Ethernet" -NetworkCategory Private
New-NetFirewallRule -DisplayName "PM Pull" -Direction Inbound -LocalPort 3000 `
  -Protocol TCP -Action Allow -Profile Private
```

**Both lines are needed.** Windows blocks inbound traffic on a "Public" network no matter
what rules exist, and an unidentified network defaults to Public.

Check:
```powershell
Get-NetFirewallRule -DisplayName "PM Pull" | Select-Object DisplayName, Enabled, Direction
Get-NetConnectionProfile | Select-Object InterfaceAlias, NetworkCategory
```

## B3. Address the other machines

Every device needs an address in the same range. Pick from this list and keep it written
down somewhere physical:

| Device | IP |
|---|---|
| **Server PC** | `192.168.10.1` |
| PM Store laptop | `192.168.10.11` |
| Kasani laptop | `192.168.10.12` |
| Commercial laptop | `192.168.10.13` |
| Wi-Fi AP for phones | `192.168.10.20` |

On each laptop: **Settings → Network & internet → Ethernet → IP assignment → Edit →
Manual → IPv4 On**
- IP: from the table
- Subnet mask: `255.255.255.0`
- Gateway: **blank**
- DNS: **blank**

## B4. Test from a laptop

```powershell
ping 192.168.10.1
```
Then browse to **http://192.168.10.1:3000**.

If ping works but the browser does not, it is the firewall — redo B2.
If ping fails, it is cabling or the IP — recheck B1 and B3.

## B5. Start automatically on boot

**Task Scheduler** → Create Task:
- **General** — name `PM Pull`; select **Run whether user is logged on or not**; tick
  **Run with highest privileges**
- **Triggers** — New → *At startup*
- **Actions** — New → Start a program
  - Program: `C:\Program Files\nodejs\node.exe`
  - Arguments: `server\index.js`
  - Start in: `C:\pmpull`
- **Conditions** — untick *Start the task only if the computer is on AC power*
- **Settings** — tick *If the task fails, restart every* → 1 minute, up to 3 times

Stop the PC sleeping:
```powershell
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /change monitor-timeout-ac 20
```

**Reboot the PC and confirm the app comes back on its own** before you rely on it.

## B6. Backups

Create `C:\pmpull\backup.bat`:
```bat
@echo off
set PGPASSWORD=the-password-you-wrote-down
set STAMP=%date:~-4%%date:~3,2%%date:~0,2%_%time:~0,2%%time:~3,2%
set STAMP=%STAMP: =0%
"C:\Program Files\PostgreSQL\16\bin\pg_dump.exe" -U postgres -d pmpull -F c -f "D:\pmpull_backups\pmpull_%STAMP%.dump"
forfiles /p "D:\pmpull_backups" /m *.dump /d -30 /c "cmd /c del @path" 2>nul
```

Make the folder, run it once by hand, confirm a `.dump` appears. Then Task Scheduler →
daily at 05:00. **Point it at a different physical drive**, not `C:`.

**Test a restore once**, now, not when you need it:
```powershell
createdb -U postgres pmpull_test
pg_restore -U postgres -d pmpull_test "D:\pmpull_backups\pmpull_20260916_0500.dump"
psql -U postgres -d pmpull_test -c "select count(*) from skus;"
dropdb -U postgres pmpull_test
```

## B7. Updating the code later

On the PC, with a dongle for a minute:
```powershell
cd C:\pmpull
git pull
npm install        # only if dependencies changed
npm run build
```
then restart the task. `server/config.json` and your database are untouched by `git pull`.

Without a dongle, use a bundle from your laptop:
```powershell
# laptop
git bundle create D:\pmpull.bundle --all
# PC
cd C:\pmpull
git pull D:\pmpull.bundle offline
npm run build
```

---

# PART C — the wiring, and why cable rather than Wi-Fi

**Your instinct is right: Wi-Fi is the wrong primary choice here.** A consumer router
covers 30–50 m indoors, and a factory is the worst case for it — metal structures,
machinery, and electrical noise from drives and motors. Three machines far apart will not
be reliably covered by one router, and repeaters halve the throughput at every hop while
still fighting the same interference.

**Ethernet runs to 100 metres per cable**, is immune to that interference, and costs less
than the Wi-Fi kit you would otherwise buy. Use cable for the fixed machines, and Wi-Fi
only where phones actually need it.

## The topology

```
                  ┌──── Cat6 (≤100 m) ────>  PM Store laptop     192.168.10.11
 Server PC        │
 192.168.10.1 ────┤──── Cat6 (≤100 m) ────>  Kasani laptop       192.168.10.12
       │          │
   [ 8-port ]─────┤──── Cat6 (≤100 m) ────>  Commercial laptop   192.168.10.13
   [ switch ]     │
                  └──── Cat6 ────> Wi-Fi AP ))) phones for PAT Line
                                   192.168.10.20
```

**If a machine is further than 100 m:** put another switch at the midpoint. A switch
regenerates the signal, so each hop gets a fresh 100 m budget. It needs a power socket
there, which is usually the real constraint.

**The data volume is tiny** — a few kilobytes per action. Even 100 Mbps is far more than
this will ever use. Buy for reliability and distance, not speed.

## Shopping list

Prices are **approximate Indian retail, September 2026, ex-GST**. Check current prices.

### Networking — essential

| Item | Spec | Qty | Each | Total |
|---|---|---|---|---|
| Gigabit switch | 8-port unmanaged, metal body (TP-Link TL-SG108 / D-Link DGS-1008A) | 1 | ₹1,300 | ₹1,300 |
| Cat6 cable | Solid copper, 305 m box — **insist on copper, not CCA** | 1 | ₹6,500 | ₹6,500 |
| RJ45 connectors | Cat6, pack of 100 | 1 | ₹400 | ₹400 |
| Crimping tool + cable tester | Basic kit | 1 | ₹900 | ₹900 |
| Casing / conduit | PVC trunking, per 100 m of run | — | ₹2,500 | ₹2,500 |
| | | | **Subtotal** | **≈ ₹11,600** |

> Alternative if you would rather not crimp: buy **pre-made Cat6 patch cables**. A 30 m
> cable is ₹500–800. Four of those is ~₹2,600 and skips the connectors, tool and most of
> the labour — cheaper *if* the runs are short. Beyond ~30 m per run, the box works out
> better.

### Wi-Fi, only if PAT Line runs on phones

| Item | Spec | Qty | Each | Total |
|---|---|---|---|---|
| Wi-Fi router as an access point | TP-Link Archer C6 or similar, **WAN port left empty** | 1 | ₹2,200 | ₹2,200 |
| *(or)* Ceiling access point | TP-Link EAP225, better coverage in an open plant | 1 | ₹4,500 | ₹4,500 |

Place it **near the packing lines**, cabled back to the switch. Its range only has to cover
the operators, not the whole site.

### Server PC protection — do not skip

| Item | Spec | Qty | Each | Total |
|---|---|---|---|---|
| UPS | 600–1000 VA line-interactive | 1 | ₹4,000 | ₹4,000 |
| Backup drive | 1 TB external HDD, for `pg_dump` | 1 | ₹4,500 | ₹4,500 |
| USB sticks | 32 GB, for off-site copies | 2 | ₹400 | ₹800 |
| | | | **Subtotal** | **≈ ₹9,300** |

The UPS is the one I would argue for hardest. An unclean shutdown during a write is the
most likely way to corrupt the database, and a factory has power events.

### Laptops (you said you need ~2)

These only run a browser, so almost anything works. Options:

| Option | Spec | Each |
|---|---|---|
| Refurbished business laptop | ThinkPad / Latitude, i5, 8 GB, SSD | ₹16,000–25,000 |
| New entry-level | i3 / Ryzen 3, 8 GB, SSD | ₹32,000–42,000 |
| Mini PC + monitor | For a fixed desk — cheaper and more durable than a laptop | ₹18,000–28,000 |

**For the shop floor, refurbished business-grade beats new consumer.** They are built
better, cheaper to replace when one dies, and dust and vibration will kill a consumer
laptop faster than you expect. Two at ₹20,000 ≈ **₹40,000**.

### Totals

| | |
|---|---|
| Networking | ₹11,600 |
| Wi-Fi (if phones are in scope) | ₹2,200–4,500 |
| Server protection | ₹9,300 |
| 2 laptops | ₹32,000–50,000 |
| **Total** | **≈ ₹55,000 – 75,000** |

Without laptops: **≈ ₹21,000–25,000**.

## Before you buy — measure

Walk the actual cable routes and write down the metres. That number decides the cable
budget and whether you need a second switch. Cable runs are not straight lines — allow
roughly **1.5×** the map distance for going up walls, along trays and around obstacles.

Also check there is a **power socket** wherever a switch or access point has to sit. That
is more often the blocker than distance.

---

## Quick reference

| | |
|---|---|
| App, on the server PC | `http://localhost:3000` |
| App, from any other machine | `http://192.168.10.1:3000` |
| Start the server | `npm run server` |
| Watch the database live | `npm run db:watch` |
| One-off database snapshot | `npm run db:check` |
| Rebuild after a code change | `npm run build` |
| Database settings | `server/config.json` (not in git) |
| Everything the schema creates | `sql/schema.sql` |
