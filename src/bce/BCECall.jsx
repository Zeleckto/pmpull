// BCE mobile screen: pick line -> SKU (filtered by line map if present) -> packmat -> qty -> Call.
// Mobile-first, big tap targets. Writes to `requests`. Reads skus + lines_map.
import React, { useEffect, useState } from "react";
import { loadSkusK, loadLinesMap, addRequestRow } from "../dataKasani";
import { LBL, UNIT, compsOf, C, btn } from "../shared";

export default function BCECall({ presetLine }) {
  const [skus, setSkus] = useState([]); const [lmap, setLmap] = useState([]);
  const [line, setLine] = useState(presetLine || ""); const [sku, setSku] = useState("");
  const [packmat, setPackmat] = useState(""); const [qty, setQty] = useState(""); const [shift, setShift] = useState("A");
  const [done, setDone] = useState(false);
  useEffect(() => { (async () => { setSkus(await loadSkusK()); setLmap(await loadLinesMap()); })(); }, []);

  const lineCfg = lmap.find((l) => l.line === line);
  const allowed = skus.filter((s) => {
    if (!lineCfg) return true; // no map -> show all
    const ws = (lineCfg.weights || "").split(/[ ,]+/).map(Number).filter(Boolean);
    const wOk = !ws.length || ws.includes(Number(s.weight));
    const pOk = !lineCfg.primary_type || String(s.primary_type).toLowerCase().includes(String(lineCfg.primary_type).toLowerCase().slice(0, 3));
    return wOk && pOk;
  });
  const s = skus.find((x) => x.code === sku); const comps = s ? compsOf(s) : [];
  const lines = lmap.length ? lmap.map((l) => l.line) : ["K1A","K1B","K2","K2A","K2B","K3","K3A","K4A","K4B","K5","K6","K9","K10","K11","K12","K14","KL","M2","M8"];

  const call = async () => {
    const n = Number(qty); if (!line || !sku || !packmat || !n) return;
    await addRequestRow({ line, sku_code: sku, packmat, qty_base: n, shift, status: "open" });
    setDone(true); setQty(""); setTimeout(() => setDone(false), 2500);
  };
  const big = { fontSize: 18, padding: 14, width: "100%", borderRadius: 10, border: `1px solid ${C.line}`, marginTop: 6, boxSizing: "border-box" };
  const lbl = { fontSize: 14, fontWeight: 600, color: C.muted, marginTop: 14, display: "block" };

  return (<div style={{ maxWidth: 460, margin: "0 auto", padding: 18, fontFamily: "system-ui,Arial", color: C.ink }}>
    <h2 style={{ color: C.slate, marginBottom: 2 }}>Call Packaging</h2>
    <div style={{ fontSize: 13, color: C.muted }}>Line {line || "—"}</div>
    <label style={lbl}>Line</label>
    <select value={line} onChange={(e) => { setLine(e.target.value); setSku(""); }} style={big}><option value="">select line…</option>{lines.map((l) => <option key={l}>{l}</option>)}</select>
    <label style={lbl}>SKU</label>
    <select value={sku} onChange={(e) => { setSku(e.target.value); setPackmat(""); }} style={big}><option value="">select SKU…</option>{allowed.map((x) => <option key={x.code} value={x.code}>{x.code} — {(x.description || "").slice(0, 24)}</option>)}</select>
    <label style={lbl}>Packmat</label>
    <select value={packmat} onChange={(e) => setPackmat(e.target.value)} style={big}><option value="">select…</option>{comps.map((pm) => <option key={pm} value={pm}>{LBL[pm]}</option>)}</select>
    <div style={{ display: "flex", gap: 10 }}>
      <div style={{ flex: 1 }}><label style={lbl}>Qty ({packmat ? UNIT[packmat] : "units"})</label><input type="number" value={qty} onChange={(e) => setQty(e.target.value)} style={big} /></div>
      <div style={{ width: 110 }}><label style={lbl}>Shift</label><select value={shift} onChange={(e) => setShift(e.target.value)} style={big}><option>A</option><option>B</option><option>C</option></select></div>
    </div>
    <button onClick={call} style={{ ...btn(C.slate), width: "100%", fontSize: 20, padding: 16, marginTop: 20 }}>Call packaging</button>
    {done && <div style={{ marginTop: 14, padding: 12, background: "#eafaf0", color: C.green, borderRadius: 10, textAlign: "center", fontWeight: 600 }}>✓ Sent to PM store</div>}
  </div>);
}
