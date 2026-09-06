// Goods Received. One tall form, big fields, plain labels — a warehouse hand fills this in.
// Received date/time is stamped automatically (consignments.received_at).
// Material code and SKU fill each other in, so they only ever type one of them.
// GRN No. / GRN Date are optional here: leadership adds them later.
import React, { useEffect, useState } from "react";
import { addConsignment, loadConsignments, loadSkusK, loadPackConfig } from "../dataKasani";
import {
  LBL, compsOf, codeFor, BASE_UNIT, unitsFor, baseFactor, findByCode,
  KGRID_ROWS, C, btn, ghost, card, inp, th, td, todayStr,
} from "../shared";

const lbl = { fontSize: 12, fontWeight: 600, color: C.muted, display: "block", marginBottom: 4 };
const field = { ...inp, width: "100%", padding: 10, fontSize: 15, boxSizing: "border-box" };
const Row = ({ children }) => <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>{children}</div>;
const Col = ({ children, w }) => <div style={{ flex: w || 1, minWidth: 190 }}>{children}</div>;

const BLANK = {
  invoice: "", invoice_date: "", po_no: "", grn_no: "", grn_date: "",
  transferred_to: "", barcode_ref: "", code: "", sku: "", packmat: "",
  qty: "", variant: "default", supplier: "", floor: "Ground", row: "A", col: 1, note: "",
};

export default function KasaniGR() {
  const [skus, setSkus] = useState([]);
  const [cfg, setCfg] = useState([]);
  const [recent, setRecent] = useState([]);
  const [f, setF] = useState(BLANK);
  const [pick, setPick] = useState(null);     // code matched >1 SKU -> ask which
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setSkus(await loadSkusK());
    setCfg(await loadPackConfig());
    setRecent((await loadConsignments()).slice(0, 15));
  };
  useEffect(() => { refresh(); }, []);

  const s = skus.find((x) => x.code === f.sku);
  const comps = s ? compsOf(s) : [];
  const autoCode = s && f.packmat ? codeFor(s, f.packmat) : "";
  const location = f.floor === "Ground" ? "Ground" : `First ${f.row}-${f.col}`;

  // typing a material code fills SKU + packmat; if the code is shared, ask which SKU
  const onCode = (code) => {
    setF((p) => ({ ...p, code }));
    const hits = findByCode(skus, code);
    if (hits.length === 1) setF((p) => ({ ...p, code, sku: hits[0].sku.code, packmat: hits[0].packmat, variant: "default" }));
    else if (hits.length > 1) setPick(hits);
  };
  const choose = (h) => { setF((p) => ({ ...p, sku: h.sku.code, packmat: h.packmat, variant: "default" })); setPick(null); };

  const units = unitsFor(cfg, f.packmat || "carton");
  const factor = baseFactor(cfg, f.packmat, f.variant);
  const qtyBase = factor == null ? null : (Number(f.qty) || 0) * factor;
  const unitLabel = (units.find((u) => u.variant === f.variant) || units[0] || {}).unit_label || BASE_UNIT[f.packmat] || "pcs";

  const save = async () => {
    if (!f.sku || !f.packmat || !Number(f.qty)) { setMsg("SKU, packmat and quantity are needed."); return; }
    if (qtyBase == null) { setMsg(`No conversion set for "${unitLabel}" — fill it in Truck & unit settings, or enter the quantity in ${BASE_UNIT[f.packmat]}.`); return; }
    setBusy(true);
    const { error } = await addConsignment({
      received_at: new Date().toISOString(),
      invoice: f.invoice, invoice_date: f.invoice_date || null,
      po_no: f.po_no, grn_no: f.grn_no || null, grn_date: f.grn_date || null,
      transferred_to: f.transferred_to, barcode_ref: f.barcode_ref,
      sku_code: f.sku, packmat: f.packmat, packmat_code: autoCode,
      qty_base: qtyBase, qty_entered: Number(f.qty), unit: unitLabel, unit_variant: f.variant,
      floor: f.floor, location, status: "pending", sample_sent: false,
      supplier: f.supplier, note: f.note,
    });
    setBusy(false);
    if (error) { setMsg(`Error: ${error.message || error}`); return; }
    setMsg(`Saved — ${Math.round(qtyBase)} ${BASE_UNIT[f.packmat]} of ${LBL[f.packmat]} for ${f.sku} at ${location}.`);
    setF({ ...BLANK, supplier: f.supplier, po_no: f.po_no, transferred_to: f.transferred_to, floor: f.floor, row: f.row, col: f.col });
    refresh();
  };

  return (<div>
    <div style={{ ...card, padding: 20 }}>
      <Row>
        <Col><label style={lbl}>Invoice #</label>
          <input value={f.invoice} onChange={(e) => setF({ ...f, invoice: e.target.value })} placeholder="e.g. SKOL-01347" style={field} /></Col>
        <Col><label style={lbl}>Invoice date</label>
          <input type="date" value={f.invoice_date} onChange={(e) => setF({ ...f, invoice_date: e.target.value })} style={field} /></Col>
      </Row>

      <Row>
        <Col><label style={lbl}>Purchase Order No.</label>
          <input value={f.po_no} onChange={(e) => setF({ ...f, po_no: e.target.value })} placeholder="e.g. 6002928243" style={field} /></Col>
        <Col><label style={lbl}>GRN No. <span style={{ fontWeight: 400 }}>(optional — office fills this)</span></label>
          <input value={f.grn_no} onChange={(e) => setF({ ...f, grn_no: e.target.value })} placeholder="leave blank" style={{ ...field, background: "#f8fafc" }} /></Col>
        <Col><label style={lbl}>GRN date <span style={{ fontWeight: 400 }}>(optional)</span></label>
          <input type="date" value={f.grn_date} onChange={(e) => setF({ ...f, grn_date: e.target.value })} style={{ ...field, background: "#f8fafc" }} /></Col>
      </Row>

      <Row>
        <Col><label style={lbl}>Transferred to</label>
          <input value={f.transferred_to} onChange={(e) => setF({ ...f, transferred_to: e.target.value })} placeholder="e.g. WB11C" style={field} /></Col>
        <Col><label style={lbl}>Bar-code reference</label>
          <input value={f.barcode_ref} onChange={(e) => setF({ ...f, barcode_ref: e.target.value })} placeholder="e.g. SJ-81" style={field} /></Col>
      </Row>

      <div style={{ borderTop: `1px solid ${C.line}`, margin: "6px 0 14px" }} />

      <Row>
        <Col><label style={lbl}>Material code <span style={{ fontWeight: 400 }}>(type this and the item fills itself)</span></label>
          <input value={f.code} onChange={(e) => onCode(e.target.value)} placeholder="code printed on the box" style={{ ...field, fontFamily: "monospace" }} /></Col>
        <Col w={2}><label style={lbl}>Item / SKU</label>
          <select value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value, packmat: "", variant: "default" })} style={field}>
            <option value="">select…</option>
            {skus.map((x) => <option key={x.code} value={x.code}>{x.code} — {(x.description || "").slice(0, 30)}</option>)}
          </select></Col>
      </Row>

      <Row>
        <Col><label style={lbl}>Packmat</label>
          <select value={f.packmat} onChange={(e) => setF({ ...f, packmat: e.target.value, variant: "default" })} style={field}>
            <option value="">—</option>{comps.map((pm) => <option key={pm} value={pm}>{LBL[pm]}</option>)}
          </select></Col>
        <Col><label style={lbl}>Code (auto)</label>
          <div style={{ ...field, background: "#f8fafc", fontFamily: "monospace", color: autoCode ? C.ink : C.muted }}>{autoCode || "—"}</div></Col>
        <Col><label style={lbl}>Received qty</label>
          <input type="number" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} style={field} /></Col>
        <Col><label style={lbl}>Unit</label>
          <select value={f.variant} onChange={(e) => setF({ ...f, variant: e.target.value })} style={field}>
            {units.map((u) => <option key={u.variant} value={u.variant}>{u.unit_label}</option>)}
          </select></Col>
        <Col><label style={lbl}>Received date/time</label>
          <div style={{ ...field, background: "#f8fafc", color: C.muted }}>{todayStr()} · auto</div></Col>
      </Row>

      {f.packmat && Number(f.qty) > 0 && (
        factor == null
          ? <div style={{ fontSize: 13, color: C.red, marginBottom: 12 }}>
              ⚠ No conversion set for <b>{unitLabel}</b> → {BASE_UNIT[f.packmat]}. Set it in <b>Truck &amp; unit settings</b> before using this unit.
            </div>
          : factor !== 1 && <div style={{ fontSize: 13, color: C.slate, marginBottom: 12 }}>
              {f.qty} × {factor} = <b>{qtyBase} {BASE_UNIT[f.packmat]}</b> will be stored.
            </div>
      )}

      <Row>
        <Col w={2}><label style={lbl}>Supplier name</label>
          <input value={f.supplier} onChange={(e) => setF({ ...f, supplier: e.target.value })} placeholder="e.g. Supplier A" style={field} /></Col>
        <Col w={2}><label style={lbl}>Note <span style={{ fontWeight: 400 }}>(optional)</span></label>
          <input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} style={field} /></Col>
      </Row>

      <label style={lbl}>📍 Store at</label>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
        <select value={f.floor} onChange={(e) => setF({ ...f, floor: e.target.value })} style={{ ...field, width: 130 }}>
          <option>Ground</option><option>First</option>
        </select>
        <select value={f.row} disabled={f.floor === "Ground"} onChange={(e) => setF({ ...f, row: e.target.value })} style={{ ...field, width: 90, background: f.floor === "Ground" ? "#f1f5f9" : "#fff" }}>
          {KGRID_ROWS.map((r) => <option key={r}>{r}</option>)}
        </select>
        <select value={f.col} disabled={f.floor === "Ground"} onChange={(e) => setF({ ...f, col: Number(e.target.value) })} style={{ ...field, width: 90, background: f.floor === "Ground" ? "#f1f5f9" : "#fff" }}>
          {Array.from({ length: 32 }, (_, i) => i + 1).map((n) => <option key={n}>{n}</option>)}
        </select>
        <div style={{ color: C.muted, fontSize: 14 }}>{location}</div>
      </div>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 14 }}>Ground = A–E only. First = A–E × 1–32.</div>

      {msg && <div style={{ fontSize: 14, marginBottom: 12, padding: "8px 10px", borderRadius: 8, background: /error|⚠|needed|No conversion/i.test(msg) ? "#fef2f2" : "#f0fdf4", color: /error|⚠|needed|No conversion/i.test(msg) ? C.red : C.green }}>{msg}</div>}

      <div style={{ display: "flex", gap: 10 }}>
        <button onClick={() => { setF(BLANK); setMsg(""); }} style={{ ...ghost, flex: 1, padding: 14, fontSize: 16 }}>Clear form</button>
        <button onClick={save} disabled={busy} style={{ ...btn(C.green), flex: 2, padding: 14, fontSize: 17 }}>{busy ? "Saving…" : "Save goods received"}</button>
      </div>
    </div>

    {pick && <div onClick={() => setPick(null)} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 50 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 12, padding: 18, width: "100%", maxWidth: 460 }}>
        <b>That code is used by {pick.length} items</b>
        <div style={{ fontSize: 12, color: C.muted, margin: "4px 0 10px" }}>Pick the one on the delivery.</div>
        {pick.map((h, i) => (<button key={i} onClick={() => choose(h)} style={{ ...ghost, width: "100%", textAlign: "left", marginBottom: 8, padding: 12 }}>
          <b>{h.sku.code}</b> · {LBL[h.packmat]}<br /><span style={{ fontSize: 12, color: C.muted }}>{(h.sku.description || "").slice(0, 40)}</span>
        </button>))}
      </div>
    </div>}

    <div style={card}>
      <b>Last 15 receipts</b>
      <div style={{ maxHeight: 300, overflowY: "auto", marginTop: 8 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th style={th}>Received</th><th style={th}>Invoice</th><th style={th}>SKU</th><th style={th}>Packmat</th><th style={th}>Qty</th><th style={th}>Location</th><th style={th}>Supplier</th></tr></thead>
          <tbody>{recent.length === 0 ? <tr><td style={td} colSpan={7}>Nothing received yet.</td></tr> :
            recent.map((c) => (<tr key={c.id}>
              <td style={{ ...td, fontSize: 12, color: C.muted }}>{String(c.received_at || c.ts || "").slice(0, 16).replace("T", " ")}</td>
              <td style={td}>{c.invoice || "—"}</td>
              <td style={{ ...td, fontWeight: 600 }}>{c.sku_code}</td>
              <td style={td}>{LBL[c.packmat] || c.packmat}</td>
              <td style={td}>{Math.round(c.qty_base)} {BASE_UNIT[c.packmat]}{c.qty_entered && c.unit && Number(c.qty_entered) !== Number(c.qty_base) ? ` (${c.qty_entered} ${c.unit})` : ""}</td>
              <td style={td}>{c.location}</td>
              <td style={{ ...td, color: C.muted, fontSize: 13 }}>{c.supplier || "—"}</td>
            </tr>))}</tbody>
        </table>
      </div>
    </div>
  </div>);
}
