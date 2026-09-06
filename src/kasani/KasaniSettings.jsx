// Truck & unit settings — the numbers dispatch planning depends on.
// One row per packmat/variant:
//   base per unit   = how many base units one of these is   (1 big roll = 450 kg)
//   truck full qty  = how many of these fill 100% of a truck
// Both live in pack_config so they survive redeploys and everyone sees the same figures.
import React, { useEffect, useState } from "react";
import { loadPackConfig, savePackConfig } from "../dataKasani";
import { LBL, C, btn, ghost, card, inp, th, td } from "../shared";

export default function KasaniSettings() {
  const [rows, setRows] = useState([]);
  const [edit, setEdit] = useState({});      // "packmat|variant" -> {base_per_unit, truck_full_qty}
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = async () => { setRows(await loadPackConfig()); setEdit({}); };
  useEffect(() => { refresh(); }, []);

  const key = (r) => `${r.packmat}|${r.variant}`;
  const val = (r, field) => {
    const e = edit[key(r)];
    if (e && e[field] !== undefined) return e[field];
    return r[field] == null ? "" : String(r[field]);
  };
  const set = (r, field, v) => setEdit({ ...edit, [key(r)]: { ...(edit[key(r)] || {}), [field]: v } });

  const changed = rows.filter((r) => {
    const e = edit[key(r)];
    if (!e) return false;
    return ["base_per_unit", "truck_full_qty"].some((f) => {
      if (e[f] === undefined) return false;
      const was = r[f] == null ? "" : String(r[f]);
      return e[f] !== was;
    });
  });

  const num = (v) => (v === "" || v == null ? null : Number(v));
  const save = async () => {
    if (!changed.length) return;
    setBusy(true);
    const { error } = await savePackConfig(changed.map((r) => ({
      packmat: r.packmat, variant: r.variant, unit_label: r.unit_label,
      base_unit: r.base_unit, sort_order: r.sort_order,
      base_per_unit: num(val(r, "base_per_unit")),
      truck_full_qty: num(val(r, "truck_full_qty")),
    })));
    setBusy(false);
    setMsg(error ? `Error: ${error.message || error}` : `Saved ${changed.length} row(s).`);
    if (!error) refresh();
  };

  const missing = rows.filter((r) => r.truck_full_qty == null).length;

  return (<div>
    <div style={card}>
      <b>Truck capacity &amp; entry units</b>
      <div style={{ fontSize: 13, color: C.muted, margin: "6px 0 4px" }}>
        <b>Base per unit</b> — how many base units one of these is. A big laminate roll might be 450 kg, so put 450.
        Leave it at 1 for units that are already the base unit.
      </div>
      <div style={{ fontSize: 13, color: C.muted, marginBottom: 12 }}>
        <b>Truck full qty</b> — how many of <i>this</i> unit fill one truck completely. Dispatch loads each truck to 90% of it.
        Leave blank for units you never load by.
      </div>
      {missing > 0 && <div style={{ fontSize: 13, color: C.amber, background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "8px 10px", marginBottom: 12 }}>
        ⚠ {missing} row(s) have no truck capacity yet. Dispatch can only plan trucks for packmats that have one.
      </div>}

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr>
          <th style={th}>Packmat</th><th style={th}>Unit shown to worker</th><th style={th}>Base unit</th>
          <th style={th}>Base per unit</th><th style={th}>Truck full qty (100%)</th>
        </tr></thead>
        <tbody>{rows.length === 0 ? <tr><td style={td} colSpan={5}>No config rows — run <code>sql/phase3.sql</code> in Supabase first.</td></tr> :
          rows.map((r) => {
            const dirty = changed.includes(r);
            return (<tr key={key(r)} style={{ background: dirty ? "#fffbeb" : "transparent" }}>
              <td style={{ ...td, fontWeight: 600 }}>{LBL[r.packmat] || r.packmat}</td>
              <td style={td}>{r.unit_label}</td>
              <td style={{ ...td, color: C.muted }}>{r.base_unit}</td>
              <td style={td}><input type="number" value={val(r, "base_per_unit")} onChange={(e) => set(r, "base_per_unit", e.target.value)}
                placeholder="not set" style={{ ...inp, width: 120, borderColor: val(r, "base_per_unit") === "" ? C.amber : C.line }} /></td>
              <td style={td}><input type="number" value={val(r, "truck_full_qty")} onChange={(e) => set(r, "truck_full_qty", e.target.value)}
                placeholder="not set" style={{ ...inp, width: 140, borderColor: val(r, "truck_full_qty") === "" ? C.amber : C.line }} /></td>
            </tr>);
          })}</tbody>
      </table>

      {msg && <div style={{ fontSize: 13, marginTop: 10, color: /error/i.test(msg) ? C.red : C.green }}>{msg}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <button onClick={refresh} style={{ ...ghost, flex: 1 }}>Discard changes</button>
        <button onClick={save} disabled={busy || !changed.length}
          style={{ ...btn(changed.length ? C.slate : "#94a3b8"), flex: 2, cursor: changed.length ? "pointer" : "not-allowed" }}>
          {busy ? "Saving…" : `Save ${changed.length} change(s)`}
        </button>
      </div>
    </div>
  </div>);
}
