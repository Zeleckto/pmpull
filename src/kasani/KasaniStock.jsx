// Stock Status. Every consignment with its quality state and what to do next.
//   Quality pending (red)  -> Send Sample
//   Sample sent (orange)   -> Clear  or  Block / reject
//   Cleared (green)        -> available to dispatch
//   Blocked (dark red)     -> out of dispatch
import React, { useEffect, useState } from "react";
import { loadConsignments, setConsignmentStatus, loadSkusK } from "../dataKasani";
import { LBL, BASE_UNIT, grStatus, C, btn, ghost, card, inp, th, td } from "../shared";

const COUNTS = [
  { key: "pending", label: "Quality pending", color: C.red },
  { key: "sample", label: "Sample sent", color: C.amber },
  { key: "cleared", label: "Cleared", color: C.green },
  { key: "rejected", label: "Blocked", color: "#7f1d1d" },
];

export default function KasaniStock() {
  const [cons, setCons] = useState([]);
  const [skus, setSkus] = useState([]);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("");
  const [reject, setReject] = useState(null);   // consignment being blocked
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState("");

  const refresh = async () => { setCons(await loadConsignments()); setSkus(await loadSkusK()); };
  useEffect(() => { refresh(); }, []);

  const act = async (c, patch, note) => { await setConsignmentStatus(c.id, patch); setMsg(note); refresh(); };
  const sendSample = (c) => act(c, { sample_sent: true, sample_sent_at: new Date().toISOString() }, `Sample sent for ${c.sku_code} (${c.invoice || "no invoice"}).`);
  const clear = (c) => act(c, { status: "cleared", cleared_at: new Date().toISOString() }, `${c.sku_code} cleared — now available to dispatch.`);
  const doReject = async () => {
    if (!reject) return;
    await setConsignmentStatus(reject.id, { status: "rejected", reject_reason: reason });
    setMsg(`${reject.sku_code} blocked — it will not be dispatched.`);
    setReject(null); setReason(""); refresh();
  };
  const unblock = (c) => act(c, { status: "pending", reject_reason: null }, `${c.sku_code} put back to quality pending.`);

  const desc = (code) => (skus.find((s) => s.code === code) || {}).description || "";
  const withStatus = cons.map((c) => ({ ...c, st: grStatus(c) }));
  const rows = withStatus
    .filter((c) => !filter || c.st.key === filter)
    .filter((c) => !q || `${c.invoice} ${c.sku_code} ${desc(c.sku_code)} ${LBL[c.packmat]} ${c.packmat_code} ${c.location} ${c.supplier}`.toLowerCase().includes(q.toLowerCase()));
  const count = (k) => withStatus.filter((c) => c.st.key === k).length;

  return (<div>
    {/* status summary — also the filter */}
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
      {COUNTS.map((s) => (
        <button key={s.key} onClick={() => setFilter(filter === s.key ? "" : s.key)} style={{
          background: filter === s.key ? s.color : "#fff", color: filter === s.key ? "#fff" : C.ink,
          border: `1px solid ${filter === s.key ? s.color : C.line}`, borderLeft: `6px solid ${s.color}`,
          borderRadius: 10, padding: "12px 18px", cursor: "pointer", font: "inherit", minWidth: 150, textAlign: "left",
        }}>
          <div style={{ fontSize: 12, opacity: 0.85 }}>{s.label}</div>
          <div style={{ fontSize: 26, fontWeight: 700 }}>{count(s.key)}</div>
        </button>
      ))}
    </div>

    <div style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
        <b>Stock ({rows.length}{filter ? ` of ${cons.length}` : ""})</b>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {filter && <button onClick={() => setFilter("")} style={ghost}>Show all</button>}
          <input placeholder="search invoice / SKU / code / location / supplier" value={q} onChange={(e) => setQ(e.target.value)} style={{ ...inp, width: 320 }} />
        </div>
      </div>

      {/* stock CSV upload — parked until the column format is confirmed */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "10px 12px", background: "#f8fafc", border: `1px dashed ${C.line}`, borderRadius: 8, marginBottom: 12 }}>
        <button disabled title="Send Claude the column headings and this gets switched on"
          style={{ ...ghost, opacity: 0.55, cursor: "not-allowed" }}>⬆ Upload stock sheet (CSV)</button>
        <span style={{ fontSize: 12, color: C.muted }}>Not wired up yet — confirm the column headings and this becomes a bulk load.</span>
      </div>

      {msg && <div style={{ fontSize: 13, marginBottom: 10, padding: "8px 10px", background: "#f0fdf4", color: C.green, borderRadius: 8 }}>{msg}</div>}

      <div style={{ maxHeight: 480, overflowY: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>
            <th style={th}>Status</th><th style={th}>Invoice</th><th style={th}>SKU</th><th style={th}>Packmat</th>
            <th style={th}>Code</th><th style={th}>Qty</th><th style={th}>Location</th><th style={th}>Action</th>
          </tr></thead>
          <tbody>{rows.length === 0 ? <tr><td style={td} colSpan={8}>Nothing here.</td></tr> :
            rows.map((c) => (<tr key={c.id}>
              <td style={td}><span style={{ background: c.st.color, color: "#fff", borderRadius: 10, padding: "2px 9px", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>{c.st.label}</span></td>
              <td style={td}>{c.invoice || "—"}</td>
              <td style={{ ...td, fontWeight: 600 }}>{c.sku_code}</td>
              <td style={td}>{LBL[c.packmat] || c.packmat}</td>
              <td style={{ ...td, fontFamily: "monospace", fontSize: 12, color: C.muted }}>{c.packmat_code || "—"}</td>
              <td style={td}>{Math.round(c.qty_base)} {BASE_UNIT[c.packmat]}</td>
              <td style={td}>{c.location}</td>
              <td style={{ ...td, whiteSpace: "nowrap" }}>
                {c.st.key === "pending" && <>
                  <button onClick={() => sendSample(c)} style={{ ...btn(C.amber), padding: "5px 10px", marginRight: 6 }}>Send Sample</button>
                  <button onClick={() => setReject(c)} style={{ ...ghost, padding: "5px 10px", color: C.red }}>Block</button>
                </>}
                {c.st.key === "sample" && <>
                  <button onClick={() => clear(c)} style={{ ...btn(C.green), padding: "5px 10px", marginRight: 6 }}>Clear</button>
                  <button onClick={() => setReject(c)} style={{ ...ghost, padding: "5px 10px", color: C.red }}>Block / reject</button>
                </>}
                {c.st.key === "cleared" && <span style={{ fontSize: 12, color: C.muted }}>ready to dispatch</span>}
                {c.st.key === "rejected" && <>
                  <span style={{ fontSize: 12, color: C.muted, marginRight: 8 }}>{c.reject_reason || "no reason"}</span>
                  <button onClick={() => unblock(c)} style={{ ...ghost, padding: "5px 10px" }}>Un-block</button>
                </>}
              </td>
            </tr>))}</tbody>
        </table>
      </div>
    </div>

    {reject && <div onClick={() => setReject(null)} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 50 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 12, padding: 18, width: "100%", maxWidth: 420 }}>
        <b>Block / reject — {reject.sku_code}</b>
        <div style={{ fontSize: 12, color: C.muted, margin: "6px 0 10px" }}>
          {Math.round(reject.qty_base)} {BASE_UNIT[reject.packmat]} of {LBL[reject.packmat]}, invoice {reject.invoice || "—"}. Blocked stock is excluded from dispatch.
        </div>
        <label style={{ fontSize: 12, color: C.muted }}>Reason</label>
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. torn rolls, moisture, wrong code" style={{ ...inp, width: "100%", padding: 10, boxSizing: "border-box", marginTop: 4 }} />
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <button onClick={() => setReject(null)} style={{ ...ghost, flex: 1 }}>Cancel</button>
          <button onClick={doReject} style={{ ...btn(C.red), flex: 1 }}>Block it</button>
        </div>
      </div>
    </div>}
  </div>);
}
