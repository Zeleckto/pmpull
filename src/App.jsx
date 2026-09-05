import React, { useEffect, useState } from "react";
import * as XLSX from "xlsx";
import { hasSupabase } from "./supabase";
import {
  loadSkus, upsertSkus, updateSku, deleteAllSkus, loadConversion,
  addLedger, loadLedger, computeOnHand, computeBlocked,
  loadRequests, addRequest, closeRequest,
} from "./data";

// ---------- conversion helpers ----------
const CLD_KG = 12;
const compsOf = (s) => {
  const a = [];
  if (s.primary_type) a.push(String(s.primary_type).includes("lam") ? "laminate" : "carton");
  if (s.outer_type) a.push(String(s.outer_type).includes("sac") ? "sac" : "cld");
  if (s.divider) a.push("divider");
  return a;
};
const codeFor = (s, pm) => (pm === "carton" || pm === "laminate") ? s.primary_code : (pm === "cld" || pm === "sac") ? s.outer_code : "";
// FG tonnes that `qty` base units represents
function fgEquiv(pm, qty, s, conv) {
  const c = conv[s.weight] || {};
  if (pm === "carton") return qty / (c.cartons_per_t || 1e6 / (s.weight || 250));
  if (pm === "cld") return qty * CLD_KG / 1000;
  if (pm === "sac") return qty * (s.sac_kg || 24) / 1000;
  if (pm === "laminate") return qty / (c.lam_rate || 20);
  if (pm === "divider") return qty * CLD_KG / 1000;
  return 0;
}
// theoretical base units that `tonnes` FG needs (for shortfall)
function theo(pm, s, t, conv) {
  const c = conv[s.weight] || {};
  if (pm === "carton") return (c.cartons_per_t || 1e6 / (s.weight || 250)) * t;
  if (pm === "cld") return (c.cld_per_t || 1000 / CLD_KG) * t;
  if (pm === "sac") return (1000 / (s.sac_kg || 24)) * t;
  if (pm === "laminate") return (c.lam_rate || 20) * t;
  return 0;
}
const LBL = { carton: "Carton", cld: "CLD", sac: "Sac", laminate: "Laminate", divider: "Divider" };
const UNIT = { carton: "cartons", cld: "cases", sac: "bags", laminate: "kg", divider: "pcs" };
const norm = (h) => String(h || "").trim().toLowerCase();
function readSheet(file, cb) {
  const r = new FileReader();
  r.onload = () => {
    const wb = XLSX.read(new Uint8Array(r.result), { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    cb(XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false }));
  };
  r.readAsArrayBuffer(file);
}

// ---------- styles ----------
const C = { slate: "#1f3a5f", ink: "#1b2a41", muted: "#64748b", line: "#e2e8f0", bg: "#f1f5f9", green: "#2e7d46", red: "#c1442e", amber: "#b26a00", blue: "#2c5aa0" };
const btn = (bg) => ({ padding: "8px 14px", background: bg, color: "#fff", border: 0, borderRadius: 8, fontWeight: 600, cursor: "pointer" });
const card = { background: "#fff", border: `1px solid ${C.line}`, borderRadius: 10, padding: 14, marginBottom: 16 };
const th = { textAlign: "left", padding: "6px 8px", borderBottom: `1px solid ${C.line}`, color: C.muted, fontSize: 13, position: "sticky", top: 0, background: "#fff" };
const td = { padding: "6px 8px", borderBottom: "1px solid #f1f5f9", fontSize: 14 };
const inp = { padding: 6, border: `1px solid ${C.line}`, borderRadius: 6, fontSize: 14 };

export default function App() {
  const [tab, setTab] = useState("requests");
  const [skus, setSkus] = useState([]);
  const [conv, setConv] = useState({});
  const [ledger, setLedger] = useState([]);
  const [requests, setRequests] = useState([]);
  const [modal, setModal] = useState(null); // {type, sku?, packmat?}
  const [msg, setMsg] = useState("");
  const onHand = computeOnHand(ledger);
  const blocked = computeBlocked(ledger);

  const refresh = async () => {
    setSkus(await loadSkus());
    setConv(await loadConversion());
    setLedger(await loadLedger());
    setRequests(await loadRequests());
  };
  useEffect(() => { refresh(); }, []);

  const Tab = ({ id, children, badge }) => (
    <button onClick={() => setTab(id)} style={{ padding: "9px 15px", borderRadius: 8, marginRight: 8, fontWeight: 600, border: `1px solid ${C.line}`, cursor: "pointer", background: tab === id ? C.slate : "#fff", color: tab === id ? "#fff" : "#334155" }}>
      {children}{badge ? <span style={{ marginLeft: 6, background: "#f59e0b", color: "#fff", borderRadius: 10, padding: "0 7px", fontSize: 12 }}>{badge}</span> : null}
    </button>
  );

  return (
    <div style={{ fontFamily: "system-ui, Arial", color: C.ink, maxWidth: 1040, margin: "0 auto", padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <h2 style={{ color: C.slate, margin: 0 }}>PM Store</h2>
        <button onClick={() => setTab("settings")} style={{ ...btn("#fff"), color: C.muted, border: `1px solid ${C.line}` }}>⚙ Settings</button>
      </div>
      <div style={{ fontSize: 13, color: hasSupabase ? C.green : C.red, marginBottom: 12 }}>
        {hasSupabase ? "● Connected — data persists across shifts" : "⚠ No database keys (.env.local) — not persistent"}
      </div>
      <div style={{ marginBottom: 16 }}>
        <Tab id="requests" badge={requests.length || 0}>PM Requests</Tab>
        <Tab id="inventory">Inventory & Store Actions</Tab>
        <Tab id="shortfall">Request Shortfall from Kasani</Tab>
      </div>

      {tab === "requests" && <PMRequests requests={requests} skus={skus} onHand={onHand}
        onFulfill={async (r) => { await addLedger({ sku_code: r.sku_code, packmat: r.packmat, direction: "issue", qty_base: r.qty_base, line: r.line, shift: r.shift, note: "fulfil request" }); await closeRequest(r.id); refresh(); }} />}

      {tab === "inventory" && <Inventory skus={skus} conv={conv} onHand={onHand} blocked={blocked} openModal={(t, sku, pm) => setModal({ type: t, sku, packmat: pm })} />}

      {tab === "shortfall" && <Shortfall skus={skus} conv={conv} onHand={onHand} />}

      {tab === "settings" && <Settings skus={skus} onImport={refresh} msg={msg} setMsg={setMsg} refresh={refresh} />}

      {modal && <ActionModal modal={modal} skus={skus} onHand={onHand} onClose={() => setModal(null)}
        onSave={async (e) => { await addLedger(e); setModal(null); refresh(); }} />}
    </div>
  );
}

// ---------------- PM Requests ----------------
function PMRequests({ requests, onFulfill }) {
  return (<div style={card}>
    <b>Active requests from lines</b>
    <div style={{ fontSize: 12, color: C.muted, margin: "4px 0 10px" }}>Requests raised by BCE/lines appear here to fulfil. (Empty until line-HMI or manual calls feed them.)</div>
    {requests.length === 0 ? <div style={{ color: C.muted, fontSize: 14, padding: 8 }}>No active requests.</div> :
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr><th style={th}>Line</th><th style={th}>SKU</th><th style={th}>Packmat</th><th style={th}>Qty</th><th style={th}></th></tr></thead>
        <tbody>{requests.map((r) => (<tr key={r.id}><td style={td}>{r.line}</td><td style={td}>{r.sku_code}</td><td style={td}>{LBL[r.packmat] || r.packmat}</td><td style={td}>{r.qty_base}</td>
          <td style={td}><button onClick={() => onFulfill(r)} style={btn(C.green)}>Give</button></td></tr>))}</tbody>
      </table>}
  </div>);
}

// ---------------- Inventory & Store Actions ----------------
function Inventory({ skus, conv, onHand, blocked, openModal }) {
  const [q, setQ] = useState("");
  const rows = [];
  skus.forEach((s) => compsOf(s).forEach((pm) => {
    const qty = onHand[`${s.code}|${pm}`] || 0;
    rows.push({ code: s.code, desc: s.description, pm, code_pm: codeFor(s, pm), qty, fg: fgEquiv(pm, qty, s, conv), blk: blocked[`${s.code}|${pm}`] || 0 });
  }));
  const f = rows.filter((r) => !q || `${r.code} ${r.desc} ${LBL[r.pm]} ${r.code_pm}`.toLowerCase().includes(q.toLowerCase()));
  return (<div>
    <div style={card}>
      <b>Store actions</b>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
        <button onClick={() => openModal("issue")} style={btn(C.slate)}>Issue packmat</button>
        <button onClick={() => openModal("receive")} style={btn(C.green)}>Incoming from Kasani</button>
        <button onClick={() => openModal("return")} style={btn(C.amber)}>Return unused</button>
        <button onClick={() => openModal("block")} style={btn(C.red)}>Block / reject</button>
      </div>
      <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>Each opens a form and writes a timestamped ledger entry. Issue records the machine line.</div>
    </div>
    <div style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <b>Inventory ({f.length} rows)</b>
        <input placeholder="search SKU / desc / packmat / code" value={q} onChange={(e) => setQ(e.target.value)} style={{ ...inp, width: 300 }} />
      </div>
      <div style={{ maxHeight: 440, overflowY: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th style={th}>SKU Code</th><th style={th}>Description</th><th style={th}>Packmat</th><th style={th}>Code</th><th style={th}>On-hand</th><th style={th}>≈ FG (t)</th><th style={th}>Blocked</th></tr></thead>
          <tbody>{f.length === 0 ? <tr><td style={td} colSpan={7}>No SKUs. Import in Settings.</td></tr> :
            f.map((r, i) => (<tr key={i}>
              <td style={{ ...td, fontWeight: 600 }}>{r.code}</td>
              <td style={{ ...td, color: C.muted, fontSize: 13 }}>{(r.desc || "").slice(0, 30)}</td>
              <td style={td}>{LBL[r.pm]}</td>
              <td style={{ ...td, fontFamily: "monospace", fontSize: 12, color: C.muted }}>{r.code_pm || "—"}</td>
              <td style={{ ...td, fontWeight: 600, color: r.qty <= 0 ? C.red : C.ink }}>{Math.round(r.qty)} {UNIT[r.pm]}</td>
              <td style={td}>{r.fg.toFixed(2)}</td>
              <td style={{ ...td, color: r.blk ? C.red : C.muted }}>{r.blk ? Math.round(r.blk) : "—"}</td>
            </tr>))}</tbody>
        </table>
      </div>
    </div>
  </div>);
}

// ---------------- Shortfall from Kasani ----------------
function Shortfall({ skus, conv, onHand }) {
  const [plan, setPlan] = useState(null);
  const run = (file) => readSheet(file, (aoa) => {
    const H = (aoa[0] || []).map(norm); const iId = H.findIndex((h) => /sku|cbu|code/.test(h)); const iT = H.findIndex((h) => /qty|tonne|ton|plan|total/.test(h)); const iSh = H.findIndex((h) => h === "shift");
    const rows = [];
    for (let r = 1; r < aoa.length; r++) {
      const row = aoa[r] || []; const code = String(row[iId] || "").trim(); const t = Number(String(row[iT] || "").replace(/[^0-9.]/g, "")) || 0; if (!code || !t) continue;
      const s = skus.find((x) => x.code === code); if (!s) continue; const shift = String(row[iSh] || "").trim().toUpperCase() || "A";
      compsOf(s).forEach((pm) => { if (pm === "divider") return; const need = theo(pm, s, t, conv); const have = onHand[`${code}|${pm}`] || 0; rows.push({ code, desc: s.description, pm, shift, need: Math.round(need), have: Math.round(have), short: Math.max(0, Math.round(need - have)) }); });
    }
    rows.sort((a, b) => a.shift.localeCompare(b.shift)); setPlan(rows);
  });
  return (<div style={card}>
    <b>Daily phasing → shortfall (pink slip)</b>
    <div style={{ fontSize: 13, color: C.muted, margin: "6px 0" }}>Upload the day's phasing (SKU/CBU code, Qty in FG tonnes, Shift). Shortfall = needed − on-hand.</div>
    <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => e.target.files[0] && run(e.target.files[0])} />
    {plan && <div style={{ maxHeight: 460, overflowY: "auto", marginTop: 12 }}><table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead><tr><th style={th}>Shift</th><th style={th}>SKU</th><th style={th}>Packmat</th><th style={th}>Needed</th><th style={th}>On-hand</th><th style={th}>Short → pull</th></tr></thead>
      <tbody>{plan.map((r, i) => (<tr key={i}><td style={td}>{r.shift}</td><td style={td}>{r.code}</td><td style={td}>{LBL[r.pm]}</td><td style={td}>{r.need}</td><td style={td}>{r.have}</td><td style={{ ...td, fontWeight: 600, color: r.short > 0 ? C.red : C.green }}>{r.short > 0 ? r.short : "covered"}</td></tr>))}</tbody>
    </table></div>}
  </div>);
}

// ---------------- Settings ----------------
function Settings({ skus, msg, setMsg, refresh }) {
  const [edit, setEdit] = useState(null);
  const [add, setAdd] = useState(false);
  const importSkus = (file) => readSheet(file, async (aoa) => {
    let hr = aoa.findIndex((r) => (r || []).some((x) => /sku\s*code|^sku$/i.test(String(x)))); if (hr < 0) hr = 0;
    const H = (aoa[hr] || []).map(norm); const find = (re) => H.findIndex((h) => re.test(h));
    const iId = H.findIndex((h) => h === "sku code" || h === "sku"), iDesc = H.findIndex((h) => /descrip/.test(h) && !/primary|outer/.test(h));
    const iOut = find(/type.*out|outer.*type/), iPrim = find(/type.*prim|primary.*type/), iPc = find(/primary\s*code/), iOc = find(/outer\s*code/), iW = find(/weight|gram/), iAdd = find(/additional/);
    const rows = [];
    for (let r = hr + 1; r < aoa.length; r++) {
      const row = aoa[r] || []; const code = String(row[iId] || "").trim(); if (!code) continue;
      const w = Number(String(row[iW] || "").replace(/[^0-9.]/g, "")) || 250;
      const ot = String(row[iOut] || "").toLowerCase().includes("sac") ? "sac" : "cld";
      rows.push({ code, description: String(row[iDesc] || ""), weight: w, primary_type: String(row[iPrim] || "").toLowerCase().includes("lam") ? "laminate" : "carton", outer_type: ot, primary_code: String(row[iPc] || ""), outer_code: String(row[iOc] || ""), divider: /divider|yes|required/.test(String(row[iAdd] || "").toLowerCase()) || (w >= 1000 && ot === "cld") });
    }
    if (!rows.length) { setMsg("No SKU rows found — check headers."); return; }
    const { error } = await upsertSkus(rows); setMsg(error ? `Error: ${error.message || error}` : `Imported ${rows.length} SKUs.`); refresh();
  });
  return (<div>
    <div style={card}>
      <b>Import SKU master</b>
      <div style={{ fontSize: 13, color: C.muted, margin: "6px 0" }}>Columns: SKU Code, Description, Type (Outer), Type (Primary), Weight, Primary Code, Outer Code, Additional Requirement.</div>
      <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => e.target.files[0] && importSkus(e.target.files[0])} />
      {msg && <div style={{ fontSize: 13, marginTop: 8 }}>{msg}</div>}
      <div style={{ marginTop: 10 }}><button onClick={async () => { if (confirm("Delete all SKUs?")) { await deleteAllSkus(); refresh(); } }} style={btn(C.red)}>Delete all SKUs</button></div>
    </div>
    <div style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 8 }}>
        <b>Active SKUs ({skus.length})</b>
        <button onClick={() => setAdd(true)} style={{ ...btn(C.slate), padding: "7px 12px" }}>+ Add SKU</button>
      </div>
      <div style={{ maxHeight: 360, overflowY: "auto", marginTop: 8 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th style={th}>Code</th><th style={th}>Description</th><th style={th}>Wt</th><th style={th}>Primary</th><th style={th}>Outer</th><th style={th}></th></tr></thead>
          <tbody>{skus.map((s) => (<tr key={s.code}><td style={{ ...td, fontWeight: 600 }}>{s.code}</td><td style={{ ...td, color: C.muted, fontSize: 13 }}>{(s.description || "").slice(0, 30)}</td><td style={td}>{s.weight}</td><td style={td}>{s.primary_type} <span style={{ color: C.muted, fontFamily: "monospace", fontSize: 11 }}>{s.primary_code}</span></td><td style={td}>{s.outer_type} <span style={{ color: C.muted, fontFamily: "monospace", fontSize: 11 }}>{s.outer_code}</span></td><td style={td}><button onClick={() => setEdit(s)} style={{ ...btn("#fff"), color: C.slate, border: `1px solid ${C.line}` }}>Edit</button></td></tr>))}</tbody>
        </table>
      </div>
    </div>
    {add && <AddSku onClose={() => setAdd(false)} onSaved={() => { setAdd(false); refresh(); }} />}
    {edit && <EditSku sku={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); refresh(); }} />}
  </div>);
}

function AddSku({ onClose, onSaved }) {
  const [f, setF] = useState({ code: "", description: "", weight: 250, primary_type: "carton", outer_type: "cld", primary_code: "", outer_code: "", divider: false });
  const [err, setErr] = useState("");
  const save = async () => {
    const code = String(f.code || "").trim();
    if (!code) { setErr("SKU code is required."); return; }
    const row = {
      code,
      description: String(f.description || ""),
      weight: Number(f.weight) || 250,
      primary_type: String(f.primary_type || "carton"),
      outer_type: String(f.outer_type || "cld"),
      primary_code: String(f.primary_code || ""),
      outer_code: String(f.outer_code || ""),
      divider: !!f.divider,
    };
    const { error } = await upsertSkus([row]);
    if (error) { setErr(error.message || String(error)); return; }
    onSaved();
  };
  const F = (lbl, key, type = "text") => (<label style={{ fontSize: 12, display: "block", marginBottom: 8 }}>{lbl}<br /><input type={type} value={f[key] ?? ""} onChange={(e) => setF({ ...f, [key]: type === "number" ? Number(e.target.value) : e.target.value })} style={{ ...inp, width: "100%" }} /></label>);
  return (<Overlay onClose={onClose}><b>Add new SKU</b>
    {F("SKU Code", "code")}{F("Description", "description")}{F("Weight (g)", "weight", "number")}
    <div style={{ display: "flex", gap: 8 }}><div style={{ flex: 1 }}>{F("Primary type", "primary_type")}</div><div style={{ flex: 1 }}>{F("Outer type", "outer_type")}</div></div>
    <div style={{ display: "flex", gap: 8 }}><div style={{ flex: 1 }}>{F("Primary code", "primary_code")}</div><div style={{ flex: 1 }}>{F("Outer code", "outer_code")}</div></div>
    <label style={{ fontSize: 13 }}><input type="checkbox" checked={!!f.divider} onChange={(e) => setF({ ...f, divider: e.target.checked })} /> Divider required</label>
    {err && <div style={{ color: C.red, fontSize: 12, marginTop: 8 }}>{err}</div>}
    <button onClick={save} style={{ ...btn(C.slate), width: "100%", marginTop: 12 }}>Save SKU</button>
  </Overlay>);
}

function EditSku({ sku, onClose, onSaved }) {
  const [f, setF] = useState({ ...sku });
  const save = async () => { await updateSku(sku.code, { description: f.description, weight: Number(f.weight), primary_type: f.primary_type, outer_type: f.outer_type, primary_code: f.primary_code, outer_code: f.outer_code, divider: !!f.divider }); onSaved(); };
  const F = (lbl, key) => (<label style={{ fontSize: 12, display: "block", marginBottom: 8 }}>{lbl}<br /><input value={f[key] || ""} onChange={(e) => setF({ ...f, [key]: e.target.value })} style={{ ...inp, width: "100%" }} /></label>);
  return (<Overlay onClose={onClose}><b>Edit {sku.code}</b>
    {F("Description", "description")}{F("Weight", "weight")}
    <div style={{ display: "flex", gap: 8 }}><div style={{ flex: 1 }}>{F("Primary type", "primary_type")}</div><div style={{ flex: 1 }}>{F("Primary code", "primary_code")}</div></div>
    <div style={{ display: "flex", gap: 8 }}><div style={{ flex: 1 }}>{F("Outer type", "outer_type")}</div><div style={{ flex: 1 }}>{F("Outer code", "outer_code")}</div></div>
    <label style={{ fontSize: 13 }}><input type="checkbox" checked={!!f.divider} onChange={(e) => setF({ ...f, divider: e.target.checked })} /> Divider required</label>
    <button onClick={save} style={{ ...btn(C.slate), width: "100%", marginTop: 12 }}>Save</button>
  </Overlay>);
}

// ---------------- Action modal (Issue / Incoming / Return / Block) ----------------
function ActionModal({ modal, skus, onHand, onClose, onSave }) {
  const titles = { issue: "Issue packmat to line", receive: "Incoming from Kasani", return: "Return unused", block: "Block / reject" };
  const [sku, setSku] = useState(modal.sku || "");
  const s = skus.find((x) => x.code === sku);
  const comps = s ? compsOf(s) : [];
  const [packmat, setPackmat] = useState(modal.packmat || "");
  const [qty, setQty] = useState(""); const [line, setLine] = useState(""); const [shift, setShift] = useState("A");
  useEffect(() => { if (s && !comps.includes(packmat)) setPackmat(comps[0] || ""); }, [sku]); // eslint-disable-line
  const avail = onHand[`${sku}|${packmat}`] || 0;
  const submit = () => { const q = Number(qty); if (!sku || !packmat || !q) return; onSave({ sku_code: sku, packmat, direction: modal.type, qty_base: q, line: modal.type === "issue" ? line : "", shift, note: "" }); };
  return (<Overlay onClose={onClose}><b>{titles[modal.type]}</b>
    <label style={{ fontSize: 12, display: "block", margin: "10px 0 4px" }}>SKU</label>
    <select value={sku} onChange={(e) => setSku(e.target.value)} style={{ ...inp, width: "100%" }}><option value="">select…</option>{skus.map((x) => <option key={x.code} value={x.code}>{x.code} — {(x.description || "").slice(0, 26)}</option>)}</select>
    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
      <div style={{ flex: 1 }}><label style={{ fontSize: 12 }}>Packmat</label><br /><select value={packmat} onChange={(e) => setPackmat(e.target.value)} style={{ ...inp, width: "100%" }}>{comps.map((pm) => <option key={pm} value={pm}>{LBL[pm]}</option>)}</select></div>
      <div style={{ width: 90 }}><label style={{ fontSize: 12 }}>Qty</label><br /><input type="number" value={qty} onChange={(e) => setQty(e.target.value)} style={{ ...inp, width: "100%" }} /></div>
    </div>
    {sku && packmat && <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>On-hand now: {Math.round(avail)} {UNIT[packmat]}</div>}
    {modal.type === "issue" && <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
      <div style={{ flex: 1 }}><label style={{ fontSize: 12 }}>Machine / line</label><br /><input value={line} onChange={(e) => setLine(e.target.value)} placeholder="e.g. K9" style={{ ...inp, width: "100%" }} /></div>
      <div style={{ width: 90 }}><label style={{ fontSize: 12 }}>Shift</label><br /><select value={shift} onChange={(e) => setShift(e.target.value)} style={{ ...inp, width: "100%" }}><option>A</option><option>B</option><option>C</option></select></div>
    </div>}
    <button onClick={submit} style={{ ...btn(C.slate), width: "100%", marginTop: 14 }}>Save</button>
  </Overlay>);
}

function Overlay({ children, onClose }) {
  return (<div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 50 }}>
    <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 12, padding: 18, width: "100%", maxWidth: 440, maxHeight: "88vh", overflowY: "auto" }}>{children}</div>
  </div>);
}
