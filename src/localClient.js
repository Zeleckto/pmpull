// A drop-in stand-in for supabase-js, talking to our own /api/query instead.
//
// The app only ever uses thirteen methods:
//   from select insert update upsert delete eq neq in is order limit single
// so this implements exactly those, with the same chainable shape and the same
// { data, error } result. That means data.js, dataKasani.js and every screen
// work unchanged — nothing below src/supabase.js knows the backend swapped.
//
// A builder is "thenable": awaiting it runs the query. That is what lets the
// existing code write  await supabase.from("skus").select("*").order("code")
// with no await on the intermediate steps.

const WRITE_OPS = new Set(["insert", "update", "upsert", "delete"]);

class Query {
  constructor(endpoint, table) {
    this.endpoint = endpoint;
    this.q = { table, op: null, columns: "*", filters: [], order: [], single: false };
  }

  // ---- operations ----
  select(cols = "*") {
    // After a write, .select() names the RETURNING columns rather than
    // starting a new read — that is how .insert(row).select("id") behaves.
    if (WRITE_OPS.has(this.q.op)) this.q.returning = cols;
    else { this.q.op = "select"; this.q.columns = cols; }
    return this;
  }
  insert(rows) {
    this.q.op = "insert";
    this.q.rows = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  upsert(rows, opts = {}) {
    this.q.op = "upsert";
    this.q.rows = Array.isArray(rows) ? rows : [rows];
    this.q.onConflict = opts.onConflict || "id";
    return this;
  }
  update(values) { this.q.op = "update"; this.q.values = values; return this; }
  delete() { this.q.op = "delete"; return this; }

  // ---- filters (chainable, ANDed together) ----
  eq(col, val) { this.q.filters.push({ col, op: "eq", val }); return this; }
  neq(col, val) { this.q.filters.push({ col, op: "neq", val }); return this; }
  gt(col, val) { this.q.filters.push({ col, op: "gt", val }); return this; }
  gte(col, val) { this.q.filters.push({ col, op: "gte", val }); return this; }
  lt(col, val) { this.q.filters.push({ col, op: "lt", val }); return this; }
  lte(col, val) { this.q.filters.push({ col, op: "lte", val }); return this; }
  like(col, val) { this.q.filters.push({ col, op: "like", val }); return this; }
  ilike(col, val) { this.q.filters.push({ col, op: "ilike", val }); return this; }
  in(col, vals) { this.q.filters.push({ col, op: "in", val: vals }); return this; }
  is(col, val) { this.q.filters.push({ col, op: "is", val }); return this; }

  // ---- shaping ----
  order(col, opts = {}) { this.q.order.push({ col, asc: opts.ascending !== false }); return this; }
  limit(n) { this.q.limit = n; return this; }
  single() { this.q.single = true; return this; }
  maybeSingle() { this.q.single = true; return this; }

  // ---- run ----
  async run() {
    if (!this.q.op) this.q.op = "select";
    try {
      const res = await fetch(`${this.endpoint}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(this.q),
      });
      if (!res.ok) {
        return { data: null, error: { message: `server returned ${res.status} ${res.statusText}` } };
      }
      return await res.json();
    } catch (e) {
      // The server being down is the common case on a LAN — say so in plain words,
      // because this string ends up in front of a store operator.
      return {
        data: null,
        error: { message: `Cannot reach the PM Pull server. Check the cable or Wi-Fi, and that the server PC is on. (${e.message})` },
      };
    }
  }
  then(onOk, onErr) { return this.run().then(onOk, onErr); }
  catch(onErr) { return this.run().catch(onErr); }
  finally(fn) { return this.run().finally(fn); }
}

export function createLocalClient(endpoint = "/api") {
  return {
    from(table) { return new Query(endpoint, table); },
    // present so any stray reference does not crash; unused by this app
    auth: {
      getUser: async () => ({ data: { user: null }, error: null }),
      signOut: async () => ({ error: null }),
    },
  };
}

// Used by the header strip to show whether the server is reachable.
export async function pingServer(endpoint = "/api") {
  try {
    const r = await fetch(`${endpoint}/health`);
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
    return await r.json();
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
