// Look straight at the database, bypassing the app entirely.
//
//   npm run db:check           one snapshot
//   npm run db:watch           refreshes every 2s — click in the app and watch it move
//
// Reads server/config.json, so it always points at the same database the server does.
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cfgFile = path.join(ROOT, "server", "config.json");
if (!fs.existsSync(cfgFile)) {
  console.error("\nserver/config.json not found. Copy server/config.example.json and fill it in.\n");
  process.exit(1);
}
const d = JSON.parse(fs.readFileSync(cfgFile, "utf8")).database || {};
const pool = new pg.Pool({
  host: d.host || "localhost", port: Number(d.port || 5432),
  user: d.user || "postgres", password: String(d.password ?? ""),
  database: d.database || "pmpull",
});

const TABLES = [
  "skus", "conversion", "pack_config", "lines_map", "line_materials",
  "ledger", "requests", "kasani_requests", "consignments", "dispatches",
  "phasing", "production",
];

const pad = (s, n) => String(s).padEnd(n);
const num = (n) => Number(n).toLocaleString().padStart(7);

async function snapshot() {
  const counts = await pool.query(
    TABLES.map((t) => `select '${t}' as t, count(*)::int as n from "${t}"`).join(" union all "));
  const by = Object.fromEntries(counts.rows.map((r) => [r.t, r.n]));

  // On-hand, worked out INDEPENDENTLY of the app's JavaScript: replay in (ts, id) order,
  // and `adjust` sets an absolute value, so everything before the last adjust is discarded.
  // Two CTEs because Postgres will not nest window functions.
  const onHand = await pool.query(`
    with ordered as (
      select sku_code, packmat, direction, qty_base,
             row_number() over (partition by sku_code, packmat order by ts, id) as rn
        from ledger
    ),
    marked as (
      select o.*,
             max(case when direction = 'adjust' then rn end)
               over (partition by sku_code, packmat) as last_adjust
        from ordered o
    ),
    totals as (
      select sku_code, packmat,
             sum(case
                   when last_adjust is not null and rn <  last_adjust then 0
                   when last_adjust is not null and rn =  last_adjust then qty_base
                   when direction in ('issue','block') then -qty_base
                   when direction = 'scrap'            then 0
                   else qty_base
                 end) as on_hand
        from marked group by sku_code, packmat
    )
    select * from totals where on_hand <> 0 order by sku_code, packmat limit 15`);

  const recent = await pool.query(
    `select id, ts, sku_code, packmat, direction, qty_base, line, note
       from ledger order by ts desc, id desc limit 8`);

  const lines = [];
  lines.push(`\x1b[1mPM Pull — ${d.user}@${d.host}:${d.port}/${d.database}\x1b[0m   ${new Date().toLocaleTimeString()}`);
  lines.push("");
  lines.push("\x1b[2m  MASTER                    TRANSACTIONS                 PLANNING\x1b[0m");
  const col = (t) => `${pad(t, 16)}${num(by[t])}`;
  lines.push(`  ${col("skus")}   ${col("ledger")}   ${col("phasing")}`);
  lines.push(`  ${col("conversion")}   ${col("requests")}   ${col("production")}`);
  lines.push(`  ${col("pack_config")}   ${col("kasani_requests")}`);
  lines.push(`  ${col("lines_map")}   ${col("consignments")}`);
  lines.push(`  ${col("line_materials")}   ${col("dispatches")}`);

  lines.push("");
  lines.push(`\x1b[1m  PM store on-hand\x1b[0m \x1b[2m(replayed from the ledger)\x1b[0m`);
  if (!onHand.rows.length) lines.push("    \x1b[2mnothing on hand\x1b[0m");
  else onHand.rows.forEach((r) =>
    lines.push(`    ${pad(r.sku_code, 22)} ${pad(r.packmat, 10)} ${num(Math.round(r.on_hand))}`));

  lines.push("");
  lines.push(`\x1b[1m  Last 8 movements\x1b[0m`);
  if (!recent.rows.length) lines.push("    \x1b[2mno movements yet\x1b[0m");
  else recent.rows.forEach((r) => {
    const t = new Date(r.ts).toLocaleTimeString();
    const col2 = { issue: 31, receive: 32, return: 32, adjust: 35, block: 31, unblock: 32, scrap: 31 }[r.direction] || 37;
    lines.push(`    \x1b[2m${t}\x1b[0m  #${pad(r.id, 5)} ${pad(r.sku_code || "-", 20)} ${pad(r.packmat || "-", 9)} ` +
      `\x1b[${col2}m${pad(r.direction, 8)}\x1b[0m ${num(r.qty_base)}  ${r.line ? "line " + r.line : ""} \x1b[2m${r.note || ""}\x1b[0m`);
  });
  return lines.join("\n");
}

const watch = process.argv.includes("--watch");
async function once() {
  try {
    const out = await snapshot();
    if (watch) process.stdout.write("\x1b[2J\x1b[H");
    console.log(out);
    if (watch) console.log("\n\x1b[2m  refreshing every 2s — Ctrl+C to stop\x1b[0m");
  } catch (e) {
    console.error("\n  database error:", e.message, "\n  check server/config.json (port and password)\n");
    if (!watch) process.exit(1);
  }
}
await once();
if (watch) setInterval(once, 2000);
else await pool.end();
