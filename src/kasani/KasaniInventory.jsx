// Kasani live inventory: goods-received entry (invoice, packmat code auto from SKU,
// SKU, qty, location grid) + searchable stock list + sample-sent/clear actions.
// Tables: consignments (writes), skus + conversion (reads).
import React, { useEffect, useState } from "react";
import { loadConsignments, addConsignment, setConsignmentStatus, loadSkusK, loadConversionK } from "../dataKasani";
import { LBL, UNIT, compsOf, codeFor, fgEquiv, KGRID_ROWS, C, btn, card, inp, th, td } from "../shared";

export default function KasaniInventory() {
  const [skus, setSkus] = useState([]); const [conv, setConv] = useState({});
  const [cons, setCons] = useState([]); const [q, setQ] = useState("");
  const [f, setF] = useState({ invoice: "", sku: "", packmat: "", qty: "", unit: "", floor: "Ground", row: "A", col: 1, supplier: "" });
  const refresh = async () => { setSkus(await loadSkusK()); setConv(await loadConversionK()); setCons(await loadConsignments()); };
  useEffect(() => { refresh(); }, []);
  const s = skus.find((x) => x.code === f.sku); const comps = s ? compsOf(s) : [];
  const location = f.floor === "Ground" ? "Ground" : `First ${f.row}-${f.col}`;

  const save = async () => {
    const qty = Number(f.qty); if (!f.sku || !f.packmat || !qty) return;
    await addConsignment({ invoice: f.invoice, sku_code: f.sku, packmat: f.packmat, packmat_code: codeFor(s, f.packmat),
      qty_base: qty, unit: f.unit || UNIT[f.packmat], floor: f.floor, location, status: "pending", sample_sent: false, supplier: f.supplier });
    setF({ ...f, invoice: "", qty: "" }); refresh();
  };
  const rows = cons.filter((c) => !q || `${c.invoice} ${c.sku_code} ${LBL[c.packmat]} ${c.packmat_code} ${c.location}`.toLowerCase().includes(q.toLowerCase()));

  return (<div style={{ maxWidth: 1040, margin: "0 auto", padding: 20, fontFamily: "system-ui,Arial", color: C.ink }}>
    <h2 style={{ color: C.slate }}>Kasani — Live Inventory</h2>
    <div style={card}>
      <b>Goods Received</b>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10, alignItems: "flex-end" }}>
        <label style={{ fontSize: 12 }}>Invoice<br /><input value={f.invoice} onChange={(e) => setF({ ...f, invoice: e.target.value })} style={{ ...inp, width: 130 }} /></label>
        <label style={{ fontSize: 12 }}>SKU<br /><select value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value, packmat: "" })} style={{ ...inp, width: 230 }}><option value="">select…</option>{skus.map((x) => <option key={x.code} value={x.code}>{x.code} — {(x.description || "").slice(0, 22)}</option>)}</select></label>
        <label style={{ fontSize: 12 }}>Packmat<br /><select value={f.packmat} onChange={(e) => setF({ ...f, packmat: e.target.value })} style={inp}><option value="">—</option>{comps.map((pm) => <option key={pm} value={pm}>{LBL[pm]}</option>)}</select></label>
        <div style={{ fontSize: 12, color: C.muted }}>Code<br /><span style={{ fontFamily: "monospace" }}>{s && f.packmat ? (codeFor(s, f.packmat) || "—") : "—"}</span></div>
        <label style={{ fontSize: 12 }}>Qty<br /><input type="number" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} style={{ ...inp, width: 90 }} /></label>
        <label style={{ fontSize: 12 }}>Supplier<br /><input value={f.supplier} onChange={(e) => setF({ ...f, supplier: e.target.value })} style={{ ...inp, width: 120 }} /></label>
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10, alignItems: "flex-end" }}>
        <label style={{ fontSize: 12 }}>Floor<br /><select value={f.floor} onChange={(e) => setF({ ...f, floor: e.target.value })} style={inp}><option>Ground</option><option>First</option></select></label>
        {f.floor === "First" && <>
          <label style={{ fontSize: 12 }}>Row<br /><select value={f.row} onChange={(e) => setF({ ...f, row: e.target.value })} style={inp}>{KGRID_ROWS.map((r) => <option key={r}>{r}</option>)}</select></label>
          <label style={{ fontSize: 12 }}>Col<br /><select value={f.col} onChange={(e) => setF({ ...f, col: Number(e.target.value) })} style={inp}>{Array.from({ length: 32 }, (_, i) => i + 1).map((n) => <option key={n}>{n}</option>)}</select></label>
        </>}
        <div style={{ fontSize: 12, color: C.muted }}>Location<br /><b>{location}</b></div>
        <button onClick={save} style={btn(C.green)}>Add to stock</button>
      </div>
    </div>
    <div style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <b>Stock ({rows.length})</b>
        <input placeholder="search invoice / SKU / code / location" value={q} onChange={(e) => setQ(e.target.value)} style={{ ...inp, width: 320 }} />
      </div>
      <div style={{ maxHeight: 460, overflowY: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th style={th}>Invoice</th><th style={th}>SKU</th><th style={th}>Packmat</th><th style={th}>Code</th><th style={th}>Qty</th><th style={th}>Location</th><th style={th}>Status</th><th style={th}></th></tr></thead>
          <tbody>{rows.length === 0 ? <tr><td style={td} colSpan={8}>No stock yet.</td></tr> :
            rows.map((c) => (<tr key={c.id}>
              <td style={td}>{c.invoice || "—"}</td><td style={{ ...td, fontWeight: 600 }}>{c.sku_code}</td><td style={td}>{LBL[c.packmat]}</td>
              <td style={{ ...td, fontFamily: "monospace", fontSize: 12, color: C.muted }}>{c.packmat_code || "—"}</td>
              <td style={td}>{Math.round(c.qty_base)} {c.unit}</td><td style={td}>{c.location}</td>
              <td style={{ ...td, color: c.status === "cleared" ? C.green : c.status === "rejected" ? C.red : C.amber, fontWeight: 600 }}>{c.status}{c.sample_sent && c.status === "pending" ? " · sample sent" : ""}</td>
              <td style={td}>{c.status === "pending" && <span style={{ display: "flex", gap: 4 }}>
                {!c.sample_sent && <button onClick={async () => { await setConsignmentStatus(c.id, { sample_sent: true }); refresh(); }} style={{ ...btn(C.slate), padding: "4px 8px" }}>Sample</button>}
                <button onClick={async () => { await setConsignmentStatus(c.id, { status: "cleared" }); refresh(); }} style={{ ...btn(C.green), padding: "4px 8px" }}>Clear</button>
              </span>}</td>
            </tr>))}</tbody>
        </table>
      </div>
    </div>
  </div>);
}
