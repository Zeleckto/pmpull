// PM Pull offline server.
//
// One Node process does everything:
//   GET  /                -> the built React app from dist/
//   POST /api/query       -> runs one query descriptor against PostgreSQL
//   GET  /api/health      -> is the database reachable
//
// Because the app and the API share an origin, the browser calls "/api/query" —
// a RELATIVE path. The server's IP address is never baked into the build, so
// changing the IP breaks nothing and needs no rebuild.
//
// All settings live in server/config.json (copy config.example.json). Environment
// variables override the file, so nothing has to be edited to move between machines.
//
//   node server/index.js
import express from "express";
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

// ---------------------------------------------------------------- config
function loadConfig() {
  const file = path.join(HERE, "config.json");
  let cfg = {};
  if (fs.existsSync(file)) {
    try { cfg = JSON.parse(fs.readFileSync(file, "utf8")); }
    catch (e) { console.error(`\nconfig.json is not valid JSON:\n  ${e.message}\n`); process.exit(1); }
  } else {
    console.warn("! server/config.json not found — falling back to environment variables.");
  }
  const s = cfg.server || {}, d = cfg.database || {}, a = cfg.app || {};
  return {
    host: process.env.HOST || s.host || "0.0.0.0",
    port: Number(process.env.PORT || s.port || 3000),
    db: {
      host: process.env.PGHOST || d.host || "localhost",
      port: Number(process.env.PGPORT || d.port || 5432),
      user: process.env.PGUSER || d.user || "postgres",
      password: String(process.env.PGPASSWORD ?? d.password ?? ""),
      database: process.env.PGDATABASE || d.database || "pmpull",
      max: Number(d.pool || 10),
    },
    staticDir: path.resolve(ROOT, process.env.STATIC_DIR || a.staticDir || "dist"),
    logQueries: a.logQueries === true,
  };
}
const CFG = loadConfig();

// ---------------------------------------------------------------- safety
// Only these tables can be touched, and only these characters can appear in an
// identifier. Everything else is a parameter, so nothing user-supplied is ever
// concatenated into SQL.
const TABLES = new Set([
  "skus", "conversion", "pack_config", "lines_map", "line_materials",
  "ledger", "requests", "kasani_requests", "consignments", "dispatches",
  "phasing", "production",
]);
const IDENT = /^[a-z_][a-z0-9_]*$/;

const ident = (name, what) => {
  const n = String(name || "").trim().toLowerCase();
  if (!IDENT.test(n)) throw new Error(`bad ${what}: ${name}`);
  return n;
};
const table = (t) => {
  const n = ident(t, "table");
  if (!TABLES.has(n)) throw new Error(`unknown table: ${t}`);
  return n;
};
// "*" or "id" or "id,code,ts"
const columns = (c) => {
  const raw = String(c || "*").trim();
  if (raw === "*" || raw === "") return "*";
  return raw.split(",").map((x) => `"${ident(x, "column")}"`).join(", ");
};

const OPS = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=", like: "like", ilike: "ilike" };

// ---------------------------------------------------------------- SQL builder
// Exported so it can be unit-tested without a database.
// node-postgres turns a JS array into a POSTGRES ARRAY literal, which is wrong for a
// jsonb column (dispatches.lines). Objects it already stringifies. No column in this
// schema is a real Postgres array, so serialising both here is safe — and it is only
// applied to written values, never to the array an in() filter passes to ANY().
const jsonSafe = (v) => (v !== null && typeof v === "object" ? JSON.stringify(v) : v);

export function buildSql(q) {
  const t = table(q.table);
  const vals = [];
  const P = (v) => `$${vals.push(v)}`;
  const PV = (v) => P(jsonSafe(v === undefined ? null : v));   // for written values

  // WHERE, shared by select / update / delete
  const where = () => {
    const parts = [];
    for (const f of q.filters || []) {
      const col = `"${ident(f.col, "column")}"`;
      if (f.op === "is") {
        if (f.val !== null && f.val !== undefined) throw new Error("is() only supports null");
        parts.push(`${col} is null`);
      } else if (f.op === "in") {
        const arr = Array.isArray(f.val) ? f.val : [f.val];
        if (!arr.length) { parts.push("false"); continue; }   // in([]) matches nothing
        parts.push(`${col} = any(${P(arr)})`);
      } else if (OPS[f.op]) {
        if (f.val === null) parts.push(f.op === "neq" ? `${col} is not null` : `${col} is null`);
        else parts.push(`${col} ${OPS[f.op]} ${P(f.val)}`);
      } else throw new Error(`unknown filter: ${f.op}`);
    }
    return parts.length ? ` where ${parts.join(" and ")}` : "";
  };

  const returning = () => {
    const c = columns(q.returning || q.columns || "*");
    return ` returning ${c}`;
  };

  if (q.op === "select") {
    let sql = `select ${columns(q.columns)} from "${t}"${where()}`;
    const ord = (q.order || []).map((o) => {
      const col = `"${ident(o.col, "column")}"`;
      // nulls last on descending matches PostgREST's default, which the app was written against
      return `${col} ${o.asc === false ? "desc nulls last" : "asc nulls last"}`;
    });
    if (ord.length) sql += ` order by ${ord.join(", ")}`;
    if (q.limit != null) sql += ` limit ${Number(q.limit) | 0}`;
    return { sql, vals };
  }

  if (q.op === "insert" || q.op === "upsert") {
    const rows = (q.rows || []).filter(Boolean);
    if (!rows.length) return null;                       // nothing to do
    // union of keys across all rows, so ragged objects still line up
    const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))].map((k) => ident(k, "column"));
    if (!keys.length) throw new Error("insert with no columns");
    const colList = keys.map((k) => `"${k}"`).join(", ");
    const tuples = rows.map((r) => `(${keys.map((k) => PV(r[k])).join(", ")})`);
    let sql = `insert into "${t}" (${colList}) values ${tuples.join(", ")}`;
    if (q.op === "upsert") {
      const conflict = String(q.onConflict || "").split(",").map((c) => `"${ident(c, "column")}"`).join(", ");
      if (!conflict) throw new Error("upsert needs onConflict");
      const sets = keys.map((k) => `"${k}" = excluded."${k}"`).join(", ");
      sql += ` on conflict (${conflict}) do update set ${sets}`;
    }
    return { sql: sql + returning(), vals };
  }

  if (q.op === "update") {
    const v = q.values || {};
    const keys = Object.keys(v).map((k) => ident(k, "column"));
    if (!keys.length) throw new Error("update with no columns");
    const sets = keys.map((k) => `"${k}" = ${PV(v[k])}`).join(", ");
    return { sql: `update "${t}" set ${sets}${where()}${returning()}`, vals };
  }

  if (q.op === "delete") {
    return { sql: `delete from "${t}"${where()}${returning()}`, vals };
  }

  throw new Error(`unknown op: ${q.op}`);
}

// ---------------------------------------------------------------- app
const pool = new pg.Pool(CFG.db);
const app = express();
app.use(express.json({ limit: "64mb" }));   // bulk uploads can be large

app.get("/api/health", async (_req, res) => {
  try {
    const r = await pool.query("select now() as now, current_database() as db");
    res.json({ ok: true, db: r.rows[0].db, now: r.rows[0].now });
  } catch (e) {
    res.status(503).json({ ok: false, error: e.message });
  }
});

app.post("/api/query", async (req, res) => {
  let built;
  try {
    built = buildSql(req.body || {});
  } catch (e) {
    // a malformed request is our bug, not the database's — say so clearly
    return res.json({ data: null, error: { message: e.message } });
  }
  if (!built) return res.json({ data: [], error: null });

  try {
    if (CFG.logQueries) console.log(built.sql, built.vals);
    const r = await pool.query(built.sql, built.vals);
    const rows = r.rows || [];
    if (req.body.single) {
      if (rows.length !== 1) {
        return res.json({ data: null, error: { message: `expected exactly 1 row, got ${rows.length}` } });
      }
      return res.json({ data: rows[0], error: null });
    }
    res.json({ data: rows, error: null });
  } catch (e) {
    console.error("query failed:", e.message, "\n  ", built.sql);
    // mirror the { data, error } shape the app already handles
    res.json({ data: null, error: { message: e.message, code: e.code, detail: e.detail } });
  }
});

// Guard against the most likely deployment mistake: building while .env.local is still
// present bakes the Supabase cloud URL in, and the app then reaches for the internet
// instead of this server.
function warnIfCloudBuild() {
  try {
    const dir = path.join(CFG.staticDir, "assets");
    if (!fs.existsSync(dir)) return;
    const js = fs.readdirSync(dir).filter((f) => f.endsWith(".js"));
    const cloud = js.some((f) => fs.readFileSync(path.join(dir, f), "utf8").includes("supabase.co"));
    if (cloud) {
      console.warn("");
      console.warn("  !! THIS BUILD POINTS AT SUPABASE IN THE CLOUD, not at this server.");
      console.warn("     Rename .env.local out of the way, then run: npm run build");
      console.warn("");
    }
  } catch { /* advisory only */ }
}
// the built app. No client-side router, so plain static serving is enough.
if (fs.existsSync(CFG.staticDir)) {
  app.use(express.static(CFG.staticDir));
  // Fallback as middleware rather than app.get("*"): Express 5 removed the bare "*"
  // route pattern, and a trailing middleware works on both 4 and 5.
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(CFG.staticDir, "index.html"));
  });
} else {
  app.get("/", (_req, res) => res.status(503).send(
    `<h2>No build found</h2><p>Expected <code>${CFG.staticDir}</code>.</p><p>Run <code>npm run build</code>.</p>`));
}

// ---------------------------------------------------------------- start
const server = app.listen(CFG.port, CFG.host, async () => {
  console.log(`\nPM Pull`);
  console.log(`  app       http://${CFG.host === "0.0.0.0" ? "<this-pc-ip>" : CFG.host}:${CFG.port}`);
  console.log(`  database  ${CFG.db.user}@${CFG.db.host}:${CFG.db.port}/${CFG.db.database}`);
  console.log(`  serving   ${CFG.staticDir}`);
  warnIfCloudBuild();
  try {
    await pool.query("select 1");
    console.log(`  status    database OK\n`);
  } catch (e) {
    console.error(`\n  !! CANNOT REACH THE DATABASE: ${e.message}`);
    console.error(`     Check server/config.json, and that PostgreSQL is running.\n`);
  }
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    console.log("\nshutting down…");
    server.close(() => pool.end().then(() => process.exit(0)));
  });
}
