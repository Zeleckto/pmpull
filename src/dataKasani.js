// Phase-2 DB helpers (Kasani, production, dispatches, lines). Separate from data.js.
// All new-table access lives here so existing data.js stays untouched.
import { supabase, hasSupabase } from "./supabase";

// ---- consignments (Kasani inventory) ----
export async function loadConsignments() {
  if (!hasSupabase) return [];
  const { data, error } = await supabase.from("consignments").select("*").order("ts", { ascending: false });
  if (error) { console.error("loadConsignments", error); return []; }
  return data || [];
}
export async function addConsignment(row) {
  if (!hasSupabase) return { error: "no db" };
  const { error } = await supabase.from("consignments").insert(row);
  if (error) console.error("addConsignment", error);
  return { error };
}
export async function setConsignmentStatus(id, patch) {
  if (!hasSupabase) return;
  const { error } = await supabase.from("consignments").update(patch).eq("id", id);
  if (error) console.error("setConsignmentStatus", error);
}
// Kasani on-hand (cleared) = sum of qty_base by sku|packmat where status='cleared'
export function kasaniOnHand(rows) {
  const m = {};
  for (const c of rows) if (c.status === "cleared") { const k = `${c.sku_code}|${c.packmat}`; m[k] = (m[k] || 0) + (Number(c.qty_base) || 0); }
  return m;
}

// ---- production (for loss) ----
export async function loadProduction() {
  if (!hasSupabase) return [];
  const { data, error } = await supabase.from("production").select("*").order("ts", { ascending: false });
  if (error) { console.error("loadProduction", error); return []; }
  return data || [];
}
export async function addProduction(rows) {
  if (!hasSupabase) return;
  const { error } = await supabase.from("production").insert(rows);
  if (error) console.error("addProduction", error);
}

// ---- dispatches (truck plans) ----
export async function loadDispatches() {
  if (!hasSupabase) return [];
  const { data, error } = await supabase.from("dispatches").select("*").order("ts", { ascending: false });
  if (error) { console.error("loadDispatches", error); return []; }
  return data || [];
}
export async function addDispatch(row) {
  if (!hasSupabase) return;
  const { error } = await supabase.from("dispatches").insert(row);
  if (error) console.error("addDispatch", error);
}
export async function setDispatch(id, patch) {
  if (!hasSupabase) return;
  const { error } = await supabase.from("dispatches").update(patch).eq("id", id);
  if (error) console.error("setDispatch", error);
}

// ---- lines map (optional; BCE filtering) ----
export async function loadLinesMap() {
  if (!hasSupabase) return [];
  const { data, error } = await supabase.from("lines_map").select("*").order("line");
  if (error) { console.error("loadLinesMap", error); return []; }
  return data || [];
}

// ---- requests (BCE writes; PM store already reads via data.js) ----
export async function addRequestRow(row) {
  if (!hasSupabase) return { error: "no db" };
  const { error } = await supabase.from("requests").insert(row);
  if (error) console.error("addRequestRow", error);
  return { error };
}

// ---- shared SKU + conversion loaders (read-only; don't collide with data.js) ----
export async function loadSkusK() {
  if (!hasSupabase) return [];
  const { data } = await supabase.from("skus").select("*").order("code");
  return data || [];
}
export async function loadConversionK() {
  if (!hasSupabase) return {};
  const { data } = await supabase.from("conversion").select("*");
  const m = {}; (data || []).forEach((r) => (m[r.weight] = r)); return m;
}

// ---- pack_config (entry-unit factors + truck capacity; edited in Kasani settings) ----
export async function loadPackConfig() {
  if (!hasSupabase) return [];
  const { data, error } = await supabase.from("pack_config").select("*").order("sort_order");
  if (error) { console.error("loadPackConfig", error); return []; }
  return data || [];
}
export async function savePackConfig(rows) {
  if (!hasSupabase) return { error: "no db" };
  const { error } = await supabase.from("pack_config").upsert(rows, { onConflict: "packmat,variant" });
  if (error) console.error("savePackConfig", error);
  return { error };
}

// ---- kasani_requests: the PM store's shortfall asks, which drive Dispatch ----
export async function loadKasaniRequestsOpen() {
  if (!hasSupabase) return [];
  const { data, error } = await supabase.from("kasani_requests").select("*")
    .in("status", ["open", "sent"])
    .order("priority", { ascending: true }).order("ts", { ascending: true });
  if (error) { console.error("loadKasaniRequestsOpen", error); return []; }
  return data || [];
}
export async function markRequestsDispatched(ids, dispatchId) {
  if (!hasSupabase || !ids.length) return { error: null };
  const { error } = await supabase.from("kasani_requests")
    .update({ status: "sent", dispatch_id: dispatchId, dispatched_at: new Date().toISOString() })
    .in("id", ids);
  if (error) console.error("markRequestsDispatched", error);
  return { error };
}
// insert one dispatch and get its id back, so the requests can point at it
export async function addDispatchReturning(row) {
  if (!hasSupabase) return { data: null, error: "no db" };
  const { data, error } = await supabase.from("dispatches").insert(row).select("id").single();
  if (error) console.error("addDispatchReturning", error);
  return { data, error };
}
