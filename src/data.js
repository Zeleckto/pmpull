// All Supabase reads/writes live here. App.jsx calls these; it never talks to the DB directly.
// Design: LEDGER stores one timestamped row per movement. On-hand is computed by summing rows.
import { supabase, hasSupabase } from "./supabase";

// ---------- SKUs ----------
export async function loadSkus() {
  if (!hasSupabase) return [];
  const { data, error } = await supabase.from("skus").select("*").order("code");
  if (error) { console.error("loadSkus", error); return []; }
  return data || [];
}
export async function upsertSkus(rows) {
  if (!hasSupabase) return { error: "no db" };
  const { error } = await supabase.from("skus").upsert(rows, { onConflict: "code" });
  if (error) console.error("upsertSkus", error);
  return { error };
}
export async function addSku(row) {
  if (!hasSupabase) return { error: "no db" };
  const { error } = await supabase.from("skus").upsert([row], { onConflict: "code" });
  if (error) console.error("addSku", error);
  return { error };
}
export async function updateSku(code, patch) {
  if (!hasSupabase) return;
  const { error } = await supabase.from("skus").update(patch).eq("code", code);
  if (error) console.error("updateSku", error);
}
export async function deleteAllSkus() {
  if (!hasSupabase) return;
  await supabase.from("skus").delete().neq("code", "");
}

// ---------- Conversion factors (optional; formulas used if absent) ----------
export async function loadConversion() {
  if (!hasSupabase) return {};
  const { data, error } = await supabase.from("conversion").select("*");
  if (error) { console.error("loadConversion", error); return {}; }
  const m = {}; (data || []).forEach((r) => (m[r.weight] = r)); return m;
}

// ---------- Ledger (movements) ----------
export async function addLedger(entry) {
  if (!hasSupabase) return { error: "no db" };
  // entry: {sku_code, packmat, direction, qty_base, line, shift, note}
  const { error } = await supabase.from("ledger").insert(entry);
  if (error) console.error("addLedger", error);
  return { error };
}
// bulk insert (used by the Sunday stock count, which writes one `adjust` row per counted line)
export async function addLedgerMany(rows) {
  if (!hasSupabase) return { error: "no db" };
  if (!rows.length) return { error: null };
  const { error } = await supabase.from("ledger").insert(rows);
  if (error) console.error("addLedgerMany", error);
  return { error };
}
export async function loadLedger() {
  if (!hasSupabase) return [];
  const { data, error } = await supabase.from("ledger").select("*").order("ts", { ascending: false });
  if (error) { console.error("loadLedger", error); return []; }
  return data || [];
}

// available on-hand: receive + return + unblock - issue - block ; adjust sets absolute.
// `scrap` does NOT move on-hand: the material left on-hand when it was blocked, scrapping
// only confirms it is never coming back (it clears out of the blocked figure instead).
export function computeOnHand(ledgerRows) {
  const m = {};
  for (const r of ledgerRows) {
    const k = `${r.sku_code}|${r.packmat}`; const q = Number(r.qty_base) || 0;
    const d = r.direction;
    if (d === "issue" || d === "block") m[k] = (m[k] || 0) - q;
    else if (d === "adjust") m[k] = q;              // stock count: absolute value
    else if (d === "scrap") m[k] = m[k] || 0;       // already out of on-hand
    else m[k] = (m[k] || 0) + q;                    // receive / return / unblock
  }
  return m;
}
// how much is still sitting blocked awaiting a decision (block - released - scrapped)
export function computeBlocked(ledgerRows) {
  const m = {};
  for (const r of ledgerRows) {
    const k = `${r.sku_code}|${r.packmat}`; const q = Number(r.qty_base) || 0;
    if (r.direction === "block") m[k] = (m[k] || 0) + q;
    else if (r.direction === "unblock" || r.direction === "scrap") m[k] = (m[k] || 0) - q;
  }
  return m;
}

// ---------- PM requests (from lines) ----------
export async function loadRequests() {
  if (!hasSupabase) return [];
  const { data, error } = await supabase.from("requests").select("*").eq("status", "open").order("ts", { ascending: false });
  if (error) { console.error("loadRequests", error); return []; }
  return data || [];
}
export async function addRequest(req) {
  if (!hasSupabase) return;
  const { error } = await supabase.from("requests").insert(req);
  if (error) console.error("addRequest", error);
}
export async function closeRequest(id) {
  if (!hasSupabase) return;
  const { error } = await supabase.from("requests").update({ status: "done" }).eq("id", id);
  if (error) console.error("closeRequest", error);
}

// ---------- Conversion upload (Settings) ----------
export async function upsertConversion(rows) {
  if (!hasSupabase) return { error: "no db" };
  const { error } = await supabase.from("conversion").upsert(rows, { onConflict: "weight" });
  if (error) console.error("upsertConversion", error);
  return { error };
}

// ---------- Kasani requests (what the PM store asks Kasani to dispatch) ----------
// Priority 1 = shift A (needed now), 2 = B, 3 = C. Kasani works the open list in that order.
export async function loadKasaniRequests() {
  if (!hasSupabase) return [];
  const { data, error } = await supabase.from("kasani_requests").select("*")
    .neq("status", "cancelled").neq("status", "received")
    .order("priority", { ascending: true }).order("ts", { ascending: true });
  if (error) { console.error("loadKasaniRequests", error); return []; }
  return data || [];
}
export async function addKasaniRequests(rows) {
  if (!hasSupabase) return { error: "no db" };
  const { error } = await supabase.from("kasani_requests").insert(rows);
  if (error) console.error("addKasaniRequests", error);
  return { error };
}
export async function setKasaniStatus(id, status) {
  if (!hasSupabase) return { error: "no db" };
  const { error } = await supabase.from("kasani_requests").update({ status }).eq("id", id);
  if (error) console.error("setKasaniStatus", error);
  return { error };
}
