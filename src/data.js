// All database reads/writes live here. App.jsx never talks to Supabase directly.
// Design: the LEDGER stores one row per movement (issue/return/receive/adjust).
// On-hand for a SKU+packmat = receives + returns - issues (+/- adjust).
import { supabase, hasSupabase } from "./supabase";

// ---------- SKUs ----------
export async function loadSkus() {
  if (!hasSupabase) return [];
  const { data, error } = await supabase.from("skus").select("*").order("code");
  if (error) { console.error(error); return []; }
  return data || [];
}
export async function upsertSkus(rows) {
  if (!hasSupabase) return;
  // rows: [{code, description, weight, primary_type, outer_type, primary_code, outer_code, divider}]
  const { error } = await supabase.from("skus").upsert(rows, { onConflict: "code" });
  if (error) console.error(error);
}
export async function deleteAllSkus() {
  if (!hasSupabase) return;
  await supabase.from("skus").delete().neq("code", "");
}

// ---------- Conversion factors ----------
export async function loadConversion() {
  if (!hasSupabase) return [];
  const { data, error } = await supabase.from("conversion").select("*");
  if (error) { console.error(error); return []; }
  return data || [];
}
export async function upsertConversion(rows) {
  if (!hasSupabase) return;
  const { error } = await supabase.from("conversion").upsert(rows, { onConflict: "weight" });
  if (error) console.error(error);
}

// ---------- Ledger (movements) ----------
export async function addLedger(entry) {
  if (!hasSupabase) return;
  // entry: {sku_code, packmat, direction, qty_base, shift, note}
  const { error } = await supabase.from("ledger").insert(entry);
  if (error) console.error(error);
}
export async function loadLedger() {
  if (!hasSupabase) return [];
  const { data, error } = await supabase.from("ledger").select("*").order("ts", { ascending: false });
  if (error) { console.error(error); return []; }
  return data || [];
}

// ---------- On-hand computed from the ledger ----------
// returns { "SKU|packmat": baseQty }
export function computeOnHand(ledgerRows) {
  const m = {};
  for (const r of ledgerRows) {
    const k = `${r.sku_code}|${r.packmat}`;
    const q = Number(r.qty_base) || 0;
    if (r.direction === "issue") m[k] = (m[k] || 0) - q;
    else if (r.direction === "adjust") m[k] = q;            // adjust sets absolute
    else m[k] = (m[k] || 0) + q;                            // receive / return add
  }
  return m;
}
