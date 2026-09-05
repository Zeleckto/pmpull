import React, { useEffect, useState } from "react";
import * as XLSX from "xlsx";
import { hasSupabase } from "./supabase";
import {
  loadSkus, upsertSkus, deleteAllSkus,
  loadConversion, upsertConversion,
  addLedger, loadLedger, computeOnHand,
} from "./data";

// ---- packmat helpers (base-unit conversions) ----
const boxPcs = { 250: 700, 500: 300, 100: 700 };
const CLD_KG = 12;
const compsOf = (s) => {
  const a = [];
  if (s.primary_type) a.push(s.primary_type === "laminate" ? "laminate" : "carton");
  if (s.outer_type) a.push(s.outer_type === "sac" ? "sac" : "cld");
  if (s.divider) a.push("divider");
  return a;
};
const codeFor = (s, packmat) =>
  packmat === s.primary_type || (packmat === "carton" && s.primary_type === "carton") || (packmat === "laminate" && s.primary_type === "laminate")
    ? s.primary_code
    : packmat === s.outer_type || (packmat === "cld" && s.outer_type === "cld") || (packmat === "sac" && s.outer_type === "sac")
    ? s.outer_code
    : "";
// theoretical packmat (base units) that `tonnes` of FG should consume
function theo(packmat, s, tonnes, conv) {
  const c = conv[s.weight] || {};
  if (packmat === "carton") return (c.cartons_per_t || 1e6 / s.weight) * tonnes;
  if (packmat === "cld") return (c.cld_per_t || 1000 / CLD_KG) * tonnes;
  if (packmat === "sac") return (1000 / (c.sac_kg || 24)) * tonnes;
  if (packmat === "laminate") return (c.lam_rate || 20) * tonnes;
  return 0;
}
const label = { carton: "Carton", cld: "CLD", sac: "Sac", laminate: "Laminate", divider: "Divider" };
const baseUnit = { carton: "cartons", cld: "cases", sac: "bags", laminate: "kg", divider: "pcs" };

function readSheet(file, cb) {
  const reader = new FileReader();
  reader.onload = () => {
    const wb = XLSX.read(new Uint8Array(reader.result), { type: "array" });
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, blankrows: false });
    cb(aoa);
  };
  reader.readAsArrayBuffer(file);
}
const norm = (h) => String(h || "").trim().toLowerCase();

export default function App() {
  const [tab, setTab] = useState("ledger");
  const [skus, setSkus] = useState([]);
  const [conv, setConv] = useState({});
  const [ledger, setLedger] = useState([]);
  const onHand = computeOnHand(ledger);

  const refresh = async () => {
    setSkus(await loadSkus());
    const cv = await loadConversion(); const map = {}; cv.forEach((r) => (map[r.weight] = r)); setConv(map);
    setLedger(await loadLedger());
  };
  useEffect(() => { refresh(); }, []);

  // ---- movement form ----
  const [mv, setMv] = useState({ sku: "", packmat: "", direction: "issue", qty: "", shift: "A" });
  const mvSku = skus.find((s) => s.code === mv.sku);
  const mvComps = mvSku ? compsOf(mvSku) : [];
  const submitMove = async () => {
    const q = Number(mv.qty); if (!mv.sku || !mv.packmat || !q) return;
    await addLedger({ sku_code: mv.sku, packmat: mv.packmat, direction: mv.direction, qty_base: q, shift: mv.shift, note: "" });
    setMv({ ...mv, qty: "" }); refresh();
  };

  // ---- SKU import ----
  const [imp, setImp] = useState("");
  const importSkus = (file) => readSheet(file, async (aoa) => {
    let hr = aoa.findIndex((r) => (r || []).some((x) => /sku\s*code|^sku$/i.test(String(x))));
    if (hr < 0) hr = 0;
    const H = (aoa[hr] || []).map(norm);
    const find = (re) => H.findIndex((h) => re.test(h));
    const iId = H.findIndex((h) => h === "sku code" || h === "sku"), iDesc = H.findIndex((h) => /descrip/.test(h) && !/primary|outer/.test(h));
    const iOut = find(/type.*out|outer.*type/), iPrim = find(/type.*prim|primary.*type/);
    const iPc = find(/primary\s*code/), iOc = find(/outer\s*code/), iW = find(/weight|gram/), iAdd = find(/additional/);
    const rows = [];
    for (let r = hr + 1; r < aoa.length; r++) {
      const row = aoa[r] || []; const code = String(row[iId] || "").trim(); if (!code) continue;
      const w = Number(String(row[iW] || "").replace(/[^0-9.]/g, "")) || 250;
      const pt = String(row[iPrim] || "").toLowerCase().includes("lam") ? "laminate" : "carton";
      const ot = String(row[iOut] || "").toLowerCase().includes("sac") ? "sac" : "cld";
      rows.push({ code, description: String(row[iDesc] || ""), weight: w, primary_type: pt, outer_type: ot,
        primary_code: String(row[iPc] || ""), outer_code: String(row[iOc] || ""),
        divider: /divider|yes|required/.test(String(row[iAdd] || "").toLowerCase()) || (w >= 1000 && ot === "cld") });
    }
    if (!rows.length) { setImp("No SKU rows found — check column headers."); return; }
    await upsertSkus(rows); setImp(`Imported ${rows.length} SKUs.`); refresh();
  });

  // ---- production -> loss ----
  const [loss, setLoss] = useState(null);
  const runLoss = (file) => readSheet(file, (aoa) => {
    const H = (aoa[0] || []).map(norm); const iId = H.findIndex((h) => /sku|cbu|code/.test(h)); const iT = H.findIndex((h) => /tonne|ton|fg|qty|produced|total/.test(h));
    const issued = {}; ledger.forEach((e) => { if (e.direction === "issue") { const k = `${e.sku_code}|${e.packmat}`; issued[k] = (issued[k] || 0) + Number(e.qty_base); } });
    const cat = { carton: 0, cld: 0, sac: 0, laminate: 0 }; const detail = [];
    for (let r = 1; r < aoa.length; r++) {
      const row = aoa[r] || []; const code = String(row[iId] || "").trim(); const t = Number(String(row[iT] || "").replace(/[^0-9.]/g, "")) || 0; if (!code || !t) continue;
      const s = skus.find((x) => x.code === code); if (!s) { detail.push({ code, flag: "not in master" }); continue; }
      compsOf(s).forEach((pm) => { if (pm === "divider") return; const th = theo(pm, s, t, conv); const iss = issued[`${code}|${pm}`] || 0; const varB = iss - th;
        if (cat[pm] != null) cat[pm] += varB * fgPer(pm, s, conv); detail.push({ code, pm, t, th: Math.round(th), iss: Math.round(iss), varB: Math.round(varB) }); });
    }
    setLoss({ cat, total: cat.carton + cat.cld + cat.sac + cat.laminate, detail });
  });
  // FG-tonne per one base unit (to sum categories)
  function fgPer(pm, s, conv) { const c = conv[s.weight] || {}; if (pm === "carton") return 1 / (c.cartons_per_t || 1e6 / s.weight); if (pm === "cld") return 1 / (c.cld_per_t || 1000 / CLD_KG); if (pm === "sac") return (c.sac_kg || 24) / 1000; if (pm === "laminate") return 1 / (c.lam_rate || 20); return 0; }

  // ---- phasing -> shortfall (pink slip) ----
  const [plan, setPlan] = useState(null);
  const runPhasing = (file) => readSheet(file, (aoa) => {
    const H = (aoa[0] || []).map(norm); const iId = H.findIndex((h) => /sku|cbu|code/.test(h)); const iT = H.findIndex((h) => /qty|tonne|ton|plan|total/.test(h)); const iSh = H.findIndex((h) => h === "shift");
    const rows = [];
    for (let r = 1; r < aoa.length; r++) {
      const row = aoa[r] || []; const code = String(row[iId] || "").trim(); const t = Number(String(row[iT] || "").replace(/[^0-9.]/g, "")) || 0; if (!code || !t) continue;
      const s = skus.find((x) => x.code === code); if (!s) continue; const shift = String(row[iSh] || "").trim().toUpperCase() || "A";
      compsOf(s).forEach((pm) => { if (pm === "divider") return; const need = theo(pm, s, t, conv); const have = onHand[`${code}|${pm}`] || 0; const short = Math.max(0, need - have);
        rows.push({ code, desc: s.description, pm, shift, need: Math.round(need), have: Math.round(have), short: Math.round(short) }); });
    }
    rows.sort((a, b) => a.shift.localeCompare(b.shift)); setPlan(rows);
  });

  const Tab = ({ id, children }) => (
    <button onClick={() => setTab(id)} style={{ padding: "8px 14px", borderRadius: 8, marginRight: 8, fontWeight: 600, border: "1px solid #cbd5e1", cursor: "pointer",
      background: tab === id ? "#1f3a5f" : "#fff", color: tab === id ? "#fff" : "#334155" }}>{children}</button>
  );
  const th = { textAlign: "left", padding: "6px 8px", borderBottom: "1px solid #e2e8f0", color: "#64748b", fontSize: 13 };
  const td = { padding: "6px 8px", borderBottom: "1px solid #f1f5f9", fontSize: 14 };

  return (
    <div style={{ fontFamily: "system-ui, Arial", color: "#1b2a41", maxWidth: 1000, margin: "0 auto", padding: 20 }}>
      <h2 style={{ color: "#1f3a5f", marginBottom: 4 }}>PM Store — Digital Ledger</h2>
      <div style={{ fontSize: 13, color: "#64748b", marginBottom: 12 }}>
        {hasSupabase ? "Connected to database — data persists across shifts." : "⚠ No database keys set (.env.local) — running without persistence."}
      </div>
      <div style={{ marginBottom: 16 }}>
        <Tab id="ledger">Record & On-hand</Tab><Tab id="loss">Loss</Tab><Tab id="phasing">Shortfall</Tab><Tab id="settings">Settings</Tab>
      </div>

      {tab === "ledger" && (<div>
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 14, marginBottom: 16 }}>
          <b>Record a movement</b>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8, alignItems: "flex-end" }}>
            <label style={{ fontSize: 12 }}>SKU<br /><select value={mv.sku} onChange={(e) => setMv({ ...mv, sku: e.target.value, packmat: "" })} style={{ padding: 6, minWidth: 220 }}>
              <option value="">select…</option>{skus.map((s) => <option key={s.code} value={s.code}>{s.code} — {s.description?.slice(0, 24)}</option>)}</select></label>
            <label style={{ fontSize: 12 }}>Packmat<br /><select value={mv.packmat} onChange={(e) => setMv({ ...mv, packmat: e.target.value })} style={{ padding: 6 }}>
              <option value="">—</option>{mvComps.map((pm) => <option key={pm} value={pm}>{label[pm]}</option>)}</select></label>
            <label style={{ fontSize: 12 }}>Action<br /><select value={mv.direction} onChange={(e) => setMv({ ...mv, direction: e.target.value })} style={{ padding: 6 }}>
              <option value="issue">Issue to line</option><option value="return">Return unused</option><option value="receive">Incoming (Kasani)</option><option value="adjust">Sunday set</option></select></label>
            <label style={{ fontSize: 12 }}>Qty (base)<br /><input type="number" value={mv.qty} onChange={(e) => setMv({ ...mv, qty: e.target.value })} style={{ padding: 6, width: 90 }} /></label>
            <label style={{ fontSize: 12 }}>Shift<br /><select value={mv.shift} onChange={(e) => setMv({ ...mv, shift: e.target.value })} style={{ padding: 6 }}><option>A</option><option>B</option><option>C</option></select></label>
            <button onClick={submitMove} style={{ padding: "8px 14px", background: "#1f3a5f", color: "#fff", border: 0, borderRadius: 8, fontWeight: 600, cursor: "pointer" }}>Record</button>
          </div>
          <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 6 }}>Base units: cartons / CLD cases / sac bags / laminate kg. "Sunday set" writes the physical count as the new on-hand.</div>
        </div>

        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 14, marginBottom: 16 }}>
          <b>On-hand now</b>
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
            <thead><tr><th style={th}>SKU</th><th style={th}>Packmat</th><th style={th}>On-hand (base)</th></tr></thead>
            <tbody>{Object.keys(onHand).length === 0 ? <tr><td style={td} colSpan={3}>No movements yet.</td></tr> :
              Object.entries(onHand).map(([k, v]) => { const [code, pm] = k.split("|"); return (<tr key={k}><td style={td}>{code}</td><td style={td}>{label[pm] || pm}</td><td style={{ ...td, fontWeight: 600 }}>{Math.round(v)} {baseUnit[pm]}</td></tr>); })}</tbody>
          </table>
        </div>

        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 14 }}>
          <b>Recent movements</b>
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
            <thead><tr><th style={th}>When</th><th style={th}>SKU</th><th style={th}>Packmat</th><th style={th}>Action</th><th style={th}>Qty</th><th style={th}>Shift</th></tr></thead>
            <tbody>{ledger.slice(0, 30).map((e) => (<tr key={e.id}><td style={td}>{new Date(e.ts).toLocaleString()}</td><td style={td}>{e.sku_code}</td><td style={td}>{label[e.packmat] || e.packmat}</td><td style={td}>{e.direction}</td><td style={td}>{e.qty_base}</td><td style={td}>{e.shift}</td></tr>))}</tbody>
          </table>
        </div>
      </div>)}

      {tab === "loss" && (<div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 14 }}>
        <b>FG produced → packmat loss</b>
        <div style={{ fontSize: 13, color: "#64748b", margin: "6px 0" }}>Upload today's FG produced (SKU code, FG tonnes). Loss = issued (from ledger) − what the tonnage should have consumed.</div>
        <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => e.target.files[0] && runLoss(e.target.files[0])} />
        {loss && (<div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
            {["carton", "cld", "sac", "laminate"].map((k) => <div key={k} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: 8, minWidth: 110 }}><div style={{ fontSize: 12, color: "#64748b" }}>{label[k]} loss</div><div style={{ fontSize: 18, fontWeight: 700, color: loss.cat[k] > 0 ? "#c1442e" : "#2e7d46" }}>{loss.cat[k].toFixed(2)} t</div></div>)}
            <div style={{ border: "2px solid #1f3a5f", borderRadius: 8, padding: 8, minWidth: 110 }}><div style={{ fontSize: 12, color: "#64748b" }}>Total loss</div><div style={{ fontSize: 18, fontWeight: 700 }}>{loss.total.toFixed(2)} t</div></div>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}><thead><tr><th style={th}>SKU</th><th style={th}>Packmat</th><th style={th}>FG t</th><th style={th}>Should consume</th><th style={th}>Issued</th><th style={th}>Variance</th></tr></thead>
            <tbody>{loss.detail.map((r, i) => r.flag ? <tr key={i}><td style={td}>{r.code}</td><td style={{ ...td, color: "#b26a00" }} colSpan={5}>{r.flag}</td></tr> :
              <tr key={i}><td style={td}>{r.code}</td><td style={td}>{label[r.pm]}</td><td style={td}>{r.t}</td><td style={td}>{r.th}</td><td style={td}>{r.iss}</td><td style={{ ...td, fontWeight: 600, color: r.varB > 0 ? "#c1442e" : "#2e7d46" }}>{r.varB > 0 ? "+" : ""}{r.varB}</td></tr>)}</tbody></table>
        </div>)}
      </div>)}

      {tab === "phasing" && (<div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 14 }}>
        <b>Daily phasing → shortfall (pink slip)</b>
        <div style={{ fontSize: 13, color: "#64748b", margin: "6px 0" }}>Upload the day's phasing (CBU/SKU code, Qty in FG tonnes, Shift). Shortfall = needed − on-hand, by shift.</div>
        <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => e.target.files[0] && runPhasing(e.target.files[0])} />
        {plan && (<table style={{ width: "100%", borderCollapse: "collapse", marginTop: 12 }}><thead><tr><th style={th}>Shift</th><th style={th}>SKU</th><th style={th}>Packmat</th><th style={th}>Needed</th><th style={th}>On-hand</th><th style={th}>Short → pull</th></tr></thead>
          <tbody>{plan.map((r, i) => <tr key={i}><td style={td}>{r.shift}</td><td style={td}>{r.code}</td><td style={td}>{label[r.pm]}</td><td style={td}>{r.need}</td><td style={td}>{r.have}</td><td style={{ ...td, fontWeight: 600, color: r.short > 0 ? "#c1442e" : "#2e7d46" }}>{r.short || "covered"}</td></tr>)}</tbody></table>)}
      </div>)}

      {tab === "settings" && (<div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 14 }}>
        <b>Import SKU master</b>
        <div style={{ fontSize: 13, color: "#64748b", margin: "6px 0" }}>Columns: SKU Code, Description, Type (Outer), Type (Primary), Weight, Primary Code, Outer Code, Additional Requirement.</div>
        <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => e.target.files[0] && importSkus(e.target.files[0])} />
        {imp && <div style={{ fontSize: 13, marginTop: 8 }}>{imp}</div>}
        <div style={{ marginTop: 10 }}><button onClick={async () => { if (confirm("Delete all SKUs?")) { await deleteAllSkus(); refresh(); } }} style={{ padding: "6px 12px", background: "#c1442e", color: "#fff", border: 0, borderRadius: 8, cursor: "pointer" }}>Delete all SKUs</button></div>
        <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 10 }}>SKUs loaded: {skus.length}. Conversion factors default to formulas (cartons = 1e6/wt, CLD = 1000/12) until you load a conversion sheet.</div>
      </div>)}
    </div>
  );
}
