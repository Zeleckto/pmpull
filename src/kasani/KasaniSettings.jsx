// Truck & unit settings — every number dispatch planning depends on, all editable.
// One row per packmat/variant:
//   unit shown     = what the worker picks in the Unit dropdown
//   base unit      = what qty_base is stored in (pcs / kg / whatever you use)
//   base per unit  = how many base units one of these is  (1 big roll = 450 kg)
//   truck full qty = how many of these fill 100% of a truck
// Stored in Supabase (pack_config) — set once, shared by everyone.
import React, { useEffect, useState } from "react";
import { loadPackConfig, savePackConfig, deletePackConfig } from "../dataKasani";
import { LBL, C, btn, ghost, card, inp, th, td } from "../shared";

const PACKMATS = ["carton", "cld", "sac", "laminate", "divider"];
const FIELDS = ["unit_label", "base_unit", "base_per_unit", "truck_full_qty"];

// what each packmat is actually counted in, and why
const HINT = {
  carton: "A box holds a variable number of cartons, so count pcs only.",
  cld: "pcs is 1. A bundle is 10.",
  sac: "Bags per bundle vary with zipper / non-zipper and size — add a variant for each one you use.",
  laminate: "kg is the base. Add a roll variant per roll size, with its weight in kg.",
  divider: "Counted in pcs.",
};

export default function KasaniSettings() {
  const [rows, setRows] = useState([]);
  const [edit, setEdit] = useState({});      // "packmat|variant" -> changed fields
  const [adding, setAdding] = useState(null); // new-variant draft
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = async () => { setRows(await loadPackConfig()); setEdit({}); };
  useEffect(() => { refresh(); }, []);

  const key = (r) => `${r.packmat}|${r.variant}`;
  const val = (r, f) => {
    const e = edit[key(r)];
    if (e && e[f] !== undefined) return e[f];
    return r[f] == null ? "" : String(r[f]);
  };
  const set = (r, f, v) => setEdit({ ...edit, [key(r)]: { ...(edit[key(r)] || {}), [f]: v } });

  const isDirty = (r) => {
    const e = edit[key(r)];
    if (!e) return false;
    return FIELDS.some((f) => e[f] !== undefined && e[f] !== (r[f] == null ? "" : String(r[f])));
  };
  const changed = rows.filter(isDirty);
  const num = (v) => (v === "" || v == null ? null : Number(v));

  const save = async () => {
    if (!changed.length) return;
    setBusy(true);
    const { error } = await savePackConfig(changed.map((r) => ({
      packmat: r.packmat, variant: r.variant, sort_order: r.sort_order,
      unit_label: val(r, "unit_label") || null,
      base_unit: val(r, "base_unit") || null,
      base_per_unit: num(val(r, "base_per_unit")),
      truck_full_qty: num(val(r, "truck_full_qty")),
    })));
    setBusy(false);
    setMsg(error ? `Error: ${error.message || error}` : `Saved ${changed.length} row(s).`);
    if (!error) refresh();
  };

  const addRow = async () => {
    const a = adding;
    const variant = String(a.variant || "").trim().toLowerCase().replace(/\s+/g, "_");
    if (!variant) { setMsg("Give the unit a short id, e.g. bundle_zip."); return; }
    if (rows.some((r) => r.packmat === a.packmat && r.variant === variant)) { setMsg("That unit already exists for this packmat."); return; }
    setBusy(true);
    const { error } = await savePackConfig([{
      packmat: a.packmat, variant,
      unit_label: a.unit_label || variant,
      base_unit: a.base_unit || (a.packmat === "laminate" ? "kg" : "pcs"),
      base_per_unit: num(a.base_per_unit), truck_full_qty: num(a.truck_full_qty),
      sort_order: 100 + rows.length,
    }]);
    setBusy(false);
    setMsg(error ? `Error: ${error.message || error}` : `Added ${a.unit_label || variant}.`);
    if (!error) { setAdding(null); refresh(); }
  };

  const removeRow = async (r) => {
    if (r.variant === "default") { setMsg("The base unit can't be removed — edit it instead."); return; }
    if (!confirm(`Remove "${r.unit_label || r.variant}" from ${LBL[r.packmat] || r.packmat}?`)) return;
    const { error } = await deletePackConfig(r.packmat, r.variant);
    setMsg(error ? `Error: ${error.message || error}` : `Removed ${r.unit_label || r.variant}.`);
    if (!error) refresh();
  };

  const missing = rows.filter((r) => r.truck_full_qty == null).length;
  const byPack = PACKMATS.filter((p) => rows.some((r) => r.packmat === p));

  return (<div>
    <div style={card}>
      <b>Truck capacity &amp; entry units</b>
      <div style={{ fontSize: 13, color: C.green, background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: "8px 10px", margin: "8px 0 12px" }}>
        ✓ Stored in Supabase (<code>pack_config</code>) — <b>set once</b>. Survives refreshes, redeploys and devices; nothing here is re-entered per visit.
      </div>
      <div style={{ fontSize: 13, color: C.muted, marginBottom: 12 }}>
        <b>Base per unit</b> — how many base units one of these is (leave 1 for the base unit itself).&nbsp;
        <b>Truck full qty</b> — how many of <i>that</i> unit fill one truck; loads go to 90% of it. Blank = never loaded by that unit.
      </div>
      {missing > 0 && <div style={{ fontSize: 13, color: C.amber, background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "8px 10px", marginBottom: 12 }}>
        ⚠ {missing} unit(s) have no truck capacity. Dispatch can only plan packmats that have at least one.
      </div>}

      {byPack.map((pm) => (
        <div key={pm} style={{ marginBottom: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <b style={{ fontSize: 15 }}>{LBL[pm] || pm}</b>
            <button onClick={() => setAdding({ packmat: pm, variant: "", unit_label: "", base_unit: pm === "laminate" ? "kg" : "pcs", base_per_unit: "", truck_full_qty: "" })}
              style={{ ...ghost, padding: "4px 10px", fontSize: 13 }}>+ Add a unit</button>
          </div>
          <div style={{ fontSize: 12, color: C.muted, margin: "2px 0 6px" }}>{HINT[pm]}</div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              <th style={th}>Unit shown to worker</th><th style={th}>Base unit</th>
              <th style={th}>Base per unit</th><th style={th}>Truck full qty (100%)</th><th style={th}></th>
            </tr></thead>
            <tbody>{rows.filter((r) => r.packmat === pm).map((r) => (
              <tr key={key(r)} style={{ background: isDirty(r) ? "#fffbeb" : "transparent" }}>
                <td style={td}><input value={val(r, "unit_label")} onChange={(e) => set(r, "unit_label", e.target.value)} style={{ ...inp, width: 150 }} /></td>
                <td style={td}><input value={val(r, "base_unit")} onChange={(e) => set(r, "base_unit", e.target.value)} placeholder="pcs / kg" style={{ ...inp, width: 90 }} /></td>
                <td style={td}><input type="number" value={val(r, "base_per_unit")} onChange={(e) => set(r, "base_per_unit", e.target.value)}
                  placeholder="not set" style={{ ...inp, width: 110, borderColor: val(r, "base_per_unit") === "" ? C.amber : C.line }} /></td>
                <td style={td}><input type="number" value={val(r, "truck_full_qty")} onChange={(e) => set(r, "truck_full_qty", e.target.value)}
                  placeholder="not set" style={{ ...inp, width: 130, borderColor: val(r, "truck_full_qty") === "" ? C.amber : C.line }} /></td>
                <td style={td}>{r.variant !== "default"
                  ? <button onClick={() => removeRow(r)} style={{ ...ghost, padding: "3px 9px", fontSize: 12, color: C.red }}>Remove</button>
                  : <span style={{ fontSize: 11, color: C.muted }}>base</span>}</td>
              </tr>))}</tbody>
          </table>
        </div>
      ))}

      {rows.length === 0 && <div style={{ color: C.muted, padding: 10 }}>No config rows — run <code>sql/phase3.sql</code> then <code>sql/phase5.sql</code> in Supabase.</div>}

      {msg && <div style={{ fontSize: 13, marginTop: 10, color: /error|already|can't|Give/i.test(msg) ? C.red : C.green }}>{msg}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <button onClick={refresh} style={{ ...ghost, flex: 1 }}>Discard changes</button>
        <button onClick={save} disabled={busy || !changed.length}
          style={{ ...btn(changed.length ? C.slate : "#94a3b8"), flex: 2, cursor: changed.length ? "pointer" : "not-allowed" }}>
          {busy ? "Saving…" : `Save ${changed.length} change(s)`}
        </button>
      </div>
    </div>

    {adding && <div onClick={() => setAdding(null)} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 50 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 12, padding: 18, width: "100%", maxWidth: 460 }}>
        <b>New unit for {LBL[adding.packmat] || adding.packmat}</b>
        <div style={{ fontSize: 12, color: C.muted, margin: "6px 0 12px" }}>{HINT[adding.packmat]}</div>
        {[
          ["Short id (no spaces)", "variant", "e.g. bundle_zip"],
          ["Label shown to the worker", "unit_label", "e.g. bundle — zipper (100)"],
          ["Base unit", "base_unit", "pcs / kg"],
          ["Base units in one", "base_per_unit", "e.g. 100"],
          ["How many fill a truck", "truck_full_qty", "optional"],
        ].map(([lab, f, ph]) => (
          <label key={f} style={{ fontSize: 12, color: C.muted, display: "block", marginBottom: 8 }}>{lab}<br />
            <input value={adding[f]} placeholder={ph} onChange={(e) => setAdding({ ...adding, [f]: e.target.value })}
              style={{ ...inp, width: "100%", padding: 9, boxSizing: "border-box" }} /></label>
        ))}
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button onClick={() => setAdding(null)} style={{ ...ghost, flex: 1 }}>Cancel</button>
          <button onClick={addRow} disabled={busy} style={{ ...btn(C.slate), flex: 1 }}>{busy ? "Adding…" : "Add unit"}</button>
        </div>
      </div>
    </div>}
  </div>);
}
