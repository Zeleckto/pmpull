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
export async function loadLedger() {
  if (!hasSupabase) return [];
  const { data, error } = await supabase.from("ledger").select("*").order("ts", { ascending: false });
  if (error) { console.error("loadLedger", error); return []; }
  return data || [];
}

// available on-hand: receive+return-issue-block ; adjust sets absolute
export function computeOnHand(ledgerRows) {
  const m = {};
  for (const r of ledgerRows) {
    const k = `${r.sku_code}|${r.packmat}`; const q = Number(r.qty_base) || 0;
    if (r.direction === "issue" || r.direction === "block") m[k] = (m[k] || 0) - q;
    else if (r.direction === "adjust") m[k] = q;
    else m[k] = (m[k] || 0) + q; // receive / return
  }
  return m;
}
// total currently blocked (for display)
export function computeBlocked(ledgerRows) {
  const m = {};
  for (const r of ledgerRows) { if (r.direction === "block") { const k = `${r.sku_code}|${r.packmat}`; m[k] = (m[k] || 0) + (Number(r.qty_base) || 0); } }
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
