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
// Kasani on-hand (cleared) by sku|packmat. Uses what is LEFT on each invoice, not what
// originally arrived, so dispatching draws the figure down. May go negative during the
// pilot — that is intentional while truck sequencing is being tested.
export function kasaniOnHand(rows) {
  const m = {};
  for (const c of rows) {
    if (c.status !== "cleared") continue;
    const k = `${c.sku_code}|${c.packmat}`;
    m[k] = (m[k] || 0) + (c.qty_remaining == null ? Number(c.qty_base) || 0 : Number(c.qty_remaining) || 0);
  }
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

// ---- editing a goods-received entry (warehouse fixes its own typos) ----
export async function updateConsignment(id, patch) {
  if (!hasSupabase) return { error: "no db" };
  const { error } = await supabase.from("consignments").update(patch).eq("id", id);
  if (error) console.error("updateConsignment", error);
  return { error };
}
// bulk stock load from a CSV
export async function addConsignments(rows) {
  if (!hasSupabase) return { error: "no db" };
  if (!rows.length) return { error: null };
  const { error } = await supabase.from("consignments").insert(rows);
  if (error) console.error("addConsignments", error);
  return { error };
}

// ---- FIFO ----
// remaining qty on a consignment row; rows loaded before phase4 have no column value,
// in which case the full quantity is still there.
export const remainingOf = (c) => (c.qty_remaining == null ? Number(c.qty_base) || 0 : Number(c.qty_remaining) || 0);

// Stock grouped by material, oldest-invoice-first.
// `location` / `invoice` are the OLDEST invoice that still has stock on it — once that
// invoice is used up it drops out and the next oldest one's location shows instead.
export function stockByMaterial(rows, { clearedOnly = true } = {}) {
  const m = {};
  const usable = rows
    .filter((c) => (clearedOnly ? c.status === "cleared" : c.status !== "rejected"))
    .filter((c) => remainingOf(c) > 0)
    .sort((a, b) => String(a.received_at || a.ts).localeCompare(String(b.received_at || b.ts)));
  for (const c of usable) {
    const k = `${c.sku_code}|${c.packmat}`;
    if (!m[k]) m[k] = { sku_code: c.sku_code, packmat: c.packmat, packmat_code: c.packmat_code, sku_desc: c.sku_desc, qty: 0, invoices: [] };
    m[k].qty += remainingOf(c);
    m[k].invoices.push({ id: c.id, invoice: c.invoice, location: c.location, qty: remainingOf(c), received_at: c.received_at || c.ts });
    if (!m[k].packmat_code && c.packmat_code) m[k].packmat_code = c.packmat_code;
    if (!m[k].sku_desc && c.sku_desc) m[k].sku_desc = c.sku_desc;
  }
  // invoices[] is already oldest-first, so [0] is the one to pick from
  return Object.values(m).map((g) => ({ ...g, oldest: g.invoices[0] || null, next: g.invoices[1] || null }));
}

// Draw `qty` base units off a material, oldest invoice first. Kasani is allowed to go
// negative for now (pilot): the last row absorbs whatever is left over.
export async function consumeFifo(sku_code, packmat, qty) {
  if (!hasSupabase || !qty) return { error: null, taken: [] };
  const { data, error } = await supabase.from("consignments").select("*")
    .eq("sku_code", sku_code).eq("packmat", packmat).eq("status", "cleared")
    .order("received_at", { ascending: true });
  if (error) { console.error("consumeFifo", error); return { error, taken: [] }; }
  let left = Number(qty) || 0;
  const taken = [];
  const rows = data || [];
  for (let i = 0; i < rows.length && left > 0; i++) {
    const c = rows[i];
    const have = remainingOf(c);
    if (have <= 0) continue;
    const isLast = i === rows.length - 1;
    const take = isLast ? left : Math.min(have, left);   // last row may go negative
    const { error: e2 } = await supabase.from("consignments")
      .update({ qty_remaining: have - take }).eq("id", c.id);
    if (e2) { console.error("consumeFifo update", e2); return { error: e2, taken }; }
    taken.push({ id: c.id, invoice: c.invoice, location: c.location, qty: take });
    left -= take;
  }
  return { error: null, taken, unallocated: left };
}

// ---- pack_config row management (add / remove your own units) ----
export async function deletePackConfig(packmat, variant) {
  if (!hasSupabase) return { error: "no db" };
  const { error } = await supabase.from("pack_config").delete().eq("packmat", packmat).eq("variant", variant);
  if (error) console.error("deletePackConfig", error);
  return { error };
}

// ---- ILT: send one truck, with a challan ----
// Stock is drawn down HERE, not when the plan is saved — a plan is only a reservation,
// the material physically leaves when the challan is raised.
export async function sendIlt(dispatch, challan) {
  if (!hasSupabase) return { error: "no db" };
  const stamp = new Date().toISOString();
  const { error } = await supabase.from("dispatches")
    .update({ challan, dispatched_at: stamp, status: "dispatched" })
    .eq("id", dispatch.id);
  if (error) { console.error("sendIlt", error); return { error }; }
  for (const l of dispatch.lines || []) await consumeFifo(l.sku_code, l.packmat, l.qty_base);
  const ids = [...new Set((dispatch.lines || []).map((l) => l.request_id).filter(Boolean))];
  if (ids.length) await markRequestsDispatched(ids, dispatch.id);
  return { error: null, challan, dispatched_at: stamp };
}

// every request regardless of status — analytics needs the closed ones too
export async function loadKasaniRequestsAll() {
  if (!hasSupabase) return [];
  const { data, error } = await supabase.from("kasani_requests").select("*").order("ts", { ascending: false });
  if (error) { console.error("loadKasaniRequestsAll", error); return []; }
  return data || [];
}

// ---- line -> material code map (optional; uploaded from PM Store settings) ----
export async function loadLineMaterials() {
  if (!hasSupabase) return [];
  const { data, error } = await supabase.from("line_materials").select("*");
  if (error) { console.error("loadLineMaterials", error); return []; }
  return data || [];
}
export async function upsertLineMaterials(rows) {
  if (!hasSupabase) return { error: "no db" };
  const m = new Map();
  for (const r of rows) m.set(`${r.line}|${r.packmat_code}`, r);   // no duplicate keys in one upsert
  const { error } = await supabase.from("line_materials").upsert([...m.values()], { onConflict: "line,packmat_code" });
  if (error) console.error("upsertLineMaterials", error);
  return { error };
}
export async function clearLineMaterials() {
  if (!hasSupabase) return { error: "no db" };
  const { error } = await supabase.from("line_materials").delete().neq("line", "");
  if (error) console.error("clearLineMaterials", error);
  return { error };
}
// recent calls from one machine, so the operator can see what they already asked for
export async function loadRequestsForLine(line) {
  if (!hasSupabase) return [];
  const { data, error } = await supabase.from("requests").select("*")
    .eq("line", line).order("ts", { ascending: false }).limit(10);
  if (error) { console.error("loadRequestsForLine", error); return []; }
  return data || [];
}

// ---- phasing (demand plan) ----
export async function loadPhasing() {
  if (!hasSupabase) return [];
  const { data, error } = await supabase.from("phasing").select("*").order("plan_date", { ascending: false });
  if (error) { console.error("loadPhasing", error); return []; }
  return data || [];
}
// Re-uploading a date replaces only that horizon, so loading the daily plan never
// wipes the weekly one (and vice versa).
export async function replacePhasing(planDates, rows, horizon = "day") {
  if (!hasSupabase) return { error: "no db" };
  for (const d of [...new Set(planDates)]) {
    const { error } = await supabase.from("phasing").delete().eq("plan_date", d).eq("horizon", horizon);
    if (error) { console.error("replacePhasing delete", error); return { error }; }
  }
  if (!rows.length) return { error: null };
  const { error } = await supabase.from("phasing").insert(rows);
  if (error) console.error("replacePhasing insert", error);
  return { error };
}
// same idea for FG produced: one upload per date+shift replaces that slot
export async function replaceProduction(planDate, shift, rows) {
  if (!hasSupabase) return { error: "no db" };
  let q = supabase.from("production").delete().eq("plan_date", planDate);
  q = shift ? q.eq("shift", shift) : q.is("shift", null);
  const { error: e1 } = await q;
  if (e1) { console.error("replaceProduction delete", e1); return { error: e1 }; }
  if (!rows.length) return { error: null };
  const { error } = await supabase.from("production").insert(rows);
  if (error) console.error("replaceProduction insert", error);
  return { error };
}

// ---- opening stock (the one-off "what is on the floor today" load) ----
// Marked source='opening' so it can be reloaded without touching real receipts.
export async function clearOpeningStock() {
  if (!hasSupabase) return { error: "no db" };
  const { error } = await supabase.from("consignments").delete().eq("source", "opening");
  if (error) console.error("clearOpeningStock", error);
  return { error };
}
// Fill BLANK fields on the SKU master from a stock sheet. Never overwrites a value that
// is already there — the master stays the authority, the sheet only plugs gaps.
export async function fillSkuGaps(rows) {
  if (!hasSupabase) return { error: "no db" };
  if (!rows.length) return { error: null };
  const { error } = await supabase.from("skus").upsert(rows, { onConflict: "code" });
  if (error) console.error("fillSkuGaps", error);
  return { error };
}
