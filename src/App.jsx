import React, { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { hasSupabase } from "./supabase";
import {
  loadSkus, upsertSkus, updateSku, deleteAllSkus, loadConversion, upsertConversion,
  addLedger, loadLedger, computeOnHand, computeBlocked,
  loadRequests, closeRequest,
  loadKasaniRequests, addKasaniRequests, setKasaniStatus,
} from "./data";

// ---------- packmat / unit model ----------
// Base units stored in the ledger: carton=pcs, cld=pcs(cases), sac=pcs(bags), laminate=kg.
// A packmat may be ENTERED in another unit; f = how many base units one of that unit is.
const UNITS = {
  carton:   [{ u: "pcs", f: 1 }],
  cld:      [{ u: "pcs", f: 1 }, { u: "bundles", f: 10 }],   // 1 bundle = 10 CLD
  sac:      [{ u: "pcs", f: 1 }],
  laminate: [{ u: "kg", f: 1 }],
  divider:  [{ u: "pcs", f: 1 }],
};
const baseUnit = (pm) => (UNITS[pm] || [{ u: "pcs" }])[0].u;
const LBL = { carton: "Carton", cld: "CLD", sac: "Sac", laminate: "Laminate", divider: "Divider" };
const UNIT = { carton: "pcs", cld: "pcs", sac: "pcs", laminate: "kg", divider: "pcs" };

const compsOf = (s) => {
  const p = String(s.primary_type || "").toLowerCase();
  const o = String(s.outer_type || "").toLowerCase();
  const a = [];
  if (p) a.push(p.includes("lam") ? "laminate" : "carton");
  if (o) a.push(o.includes("sac") || o.includes("wov") ? "sac" : "cld");
  if (s.divider) a.push("divider");
  return a;
};
const codeFor = (s, pm) => (pm === "carton" || pm === "laminate") ? s.primary_code : (pm === "cld" || pm === "sac") ? s.outer_code : "";

// per-tonne factor for a packmat at this SKU's weight, from the `conversion` table
const perT = (pm, s, conv) => {
  const c = (conv && conv[s.weight]) || {};
  return { carton: c.cartons_per_t, cld: c.cld_per_t, sac: c.sac_per_t, laminate: c.lam_per_t, divider: c.inner_per_t }[pm];
};
// FG tonnes that `qty` base units represents
function fgEquiv(pm, qty, s, conv) {
  const per = perT(pm, s, conv);
  if (per) return qty / per;              // base units / (units per tonne) = FG tonnes
  // fallback if that weight isn't in the conversion table
  if (pm === "cld") return qty * 12 / 1000;
  if (pm === "sac") return qty * (s.sac_kg || 24) / 1000;
  if (pm === "carton") return qty / (1e6 / (s.weight || 250));
  if (pm === "laminate") return qty / 20;
  return 0;
}
// theoretical base units that `t` FG tonnes needs (for shortfall)
function theo(pm, s, t, conv) {
  const per = perT(pm, s, conv);
  if (per) return t * per;                // FG tonnes x (units per tonne) = base units
  if (pm === "cld") return t * 1000 / 12;
  if (pm === "sac") return t * 1000 / (s.sac_kg || 24);
  if (pm === "carton") return t * (1e6 / (s.weight || 250));
  if (pm === "laminate") return t * 20;
  return 0;
}

const SHIFTS = ["A", "B", "C"];
const PRIO = { A: 1, B: 2, C: 3 };
const norm = (h) => String(h || "").trim().toLowerCase();
const today = () => new Date().toISOString().slice(0, 10);
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
const ghost = { ...btn("#fff"), color: C.slate, border: `1px solid ${C.line}` };
const card = { background: "#fff", border: `1px solid ${C.line}`, borderRadius: 10, padding: 14, marginBottom: 16 };
const th = { textAlign: "left", padding: "6px 8px", borderBottom: `1px solid ${C.line}`, color: C.muted, fontSize: 13, position: "sticky", top: 0, background: "#fff" };
const td = { padding: "6px 8px", borderBottom: "1px solid #f1f5f9", fontSize: 14 };
const inp = { padding: 6, border: `1px solid ${C.line}`, borderRadius: 6, fontSize: 14 };
const pill = (bg) => ({ background: bg, color: "#fff", borderRadius: 10, padding: "1px 8px", fontSize: 12, fontWeight: 700 });
const prioColor = (p) => (p === 1 ? C.red : p === 2 ? C.amber : C.blue);

export default function App() {
  const [tab, setTab] = useState("requests");
  const [skus, setSkus] = useState([]);
  const [conv, setConv] = useState({});
  const [ledger, setLedger] = useState([]);
  const [requests, setRequests] = useState([]);
  const [kasani, setKasani] = useState([]);
  const [modal, setModal] = useState(null); // {type, sku?, packmat?}
  const [msg, setMsg] = useState("");
  const onHand = computeOnHand(ledger);
  const blocked = computeBlocked(ledger);

  const refresh = async () => {
    setSkus(await loadSkus());
    setConv(await loadConversion());
    setLedger(await loadLedger());
    setRequests(await loadRequests());
    setKasani(await loadKasaniRequests());
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
        <button onClick={() => setTab("settings")} style={{ ...btn("#fff"), color: C.muted, border: `1px solid ${C.line}` }}>&#9881; Settings</button>
      </div>
      <div style={{ fontSize: 13, color: hasSupabase ? C.green : C.red, marginBottom: 12 }}>
        {hasSupabase ? "● Connected — data persists across shifts" : "⚠ No database keys (.env.local) — not persistent"}
      </div>
      <div style={{ marginBottom: 16 }}>
        <Tab id="requests" badge={requests.length || 0}>PM Requests</Tab>
        <Tab id="inventory">Inventory &amp; Store Actions</Tab>
        <Tab id="shortfall" badge={kasani.filter((k) => k.status === "open").length || 0}>Request Shortfall from Kasani</Tab>
      </div>

      {tab === "requests" && <PMRequests requests={requests}
        onFulfill={async (r) => { await addLedger({ sku_code: r.sku_code, packmat: r.packmat, direction: "issue", qty_base: r.qty_base, line: r.line, shift: r.shift, note: "fulfil request" }); await closeRequest(r.id); refresh(); }} />}

      {tab === "inventory" && <Inventory skus={skus} conv={conv} onHand={onHand} blocked={blocked} openModal={(t, sku, pm) => setModal({ type: t, sku, packmat: pm })} />}

      {tab === "shortfall" && <Shortfall skus={skus} conv={conv} onHand={onHand} kasani={kasani} refresh={refresh} />}

      {tab === "settings" && <Settings skus={skus} msg={msg} setMsg={setMsg} refresh={refresh} />}

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
        <tbody>{requests.map((r) => (<tr key={r.id}><td style={td}>{r.line}</td><td style={td}>{r.sku_code}</td><td style={td}>{LBL[r.packmat] || r.packmat}</td><td style={td}>{r.qty_base} {UNIT[r.packmat]}</td>
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
          <thead><tr><th style={th}>SKU Code</th><th style={th}>Description</th><th style={th}>Packmat</th><th style={th}>Code</th><th style={th}>On-hand</th><th style={th}>&#8776; FG (t)</th><th style={th}>Blocked</th></tr></thead>
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
// Flow: upload phasing CSV -> PREVIEW -> OK -> shortfall computed, shift A first (priority 1),
// then B, then C. On-hand is consumed in that order, so a later shift never counts stock that
// an earlier, more urgent shift has already been allocated.
function Shortfall({ skus, conv, onHand, kasani, refresh }) {
  const [planDate, setPlanDate] = useState(today());
  const [preview, setPreview] = useState(null);   // rows read from the file, before OK
  const [plan, setPlan] = useState(null);         // computed shortfall rows
  const [sel, setSel] = useState({});             // row index -> selected
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState("");

  // ---- 1. read the file into a preview (no computation yet) ----
  const readPhasing = (file) => readSheet(file, (aoa) => {
    let hr = aoa.findIndex((r) => (r || []).some((x) => /sku|cbu|code/i.test(String(x))));
    if (hr < 0) hr = 0;
    const H = (aoa[hr] || []).map(norm);
    const iId = H.findIndex((h) => /sku|cbu|code/.test(h));
    const iT = H.findIndex((h) => /demand|tonne|ton|qty|plan|total/.test(h));
    const iSh = H.findIndex((h) => /shift|needed/.test(h));
    const rows = [];
    for (let r = hr + 1; r < aoa.length; r++) {
      const row = aoa[r] || [];
      const code = String(row[iId] || "").trim();
      const t = Number(String(row[iT] || "").replace(/[^0-9.]/g, "")) || 0;
      if (!code || !t) continue;
      const shift = (String(row[iSh] || "").trim().toUpperCase().match(/[ABC]/) || ["A"])[0];
      const s = skus.find((x) => x.code === code);
      rows.push({ code, desc: s ? s.description : "", t, shift, known: !!s });
    }
    rows.sort((a, b) => (PRIO[a.shift] || 9) - (PRIO[b.shift] || 9) || a.code.localeCompare(b.code));
    setPreview(rows); setPlan(null); setSel({});
    setInfo(rows.length ? "" : "No usable rows found — expected columns: SKU Code, Demand (tonnes), Shift (A/B/C).");
  });

  // ---- 2. on OK, compute the shortfall in shift-priority order ----
  const compute = () => {
    const demand = new Map();   // "code|pm|shift" -> tonnes
    (preview || []).forEach((p) => {
      const s = skus.find((x) => x.code === p.code);
      if (!s) return;
      compsOf(s).forEach((pm) => {
        const k = `${p.code}|${pm}|${p.shift}`;
        demand.set(k, (demand.get(k) || 0) + p.t);
      });
    });
    // work through A, then B, then C — on-hand is drawn down as we go
    const entries = [...demand.entries()].sort((a, b) => {
      const sa = a[0].split("|")[2], sb = b[0].split("|")[2];
      return (PRIO[sa] || 9) - (PRIO[sb] || 9) || a[0].localeCompare(b[0]);
    });
    const left = {};   // "code|pm" -> stock not yet allocated to an earlier shift
    const out = [];
    for (const [k, t] of entries) {
      const [code, pm, shift] = k.split("|");
      const s = skus.find((x) => x.code === code);
      const need = theo(pm, s, t, conv);
      if (!need) continue;                       // no factor for this packmat at this weight
      const key = `${code}|${pm}`;
      if (left[key] === undefined) left[key] = onHand[key] || 0;
      const have = Math.max(0, left[key]);       // still free for THIS shift
      const use = Math.min(have, need);
      left[key] = have - use;
      out.push({
        code, desc: s.description, pm, shift, priority: PRIO[shift] || 9,
        t, need: Math.round(need), have: Math.round(have),
        short: Math.max(0, Math.round(need - use)),
      });
    }
    out.sort((a, b) => a.priority - b.priority || b.short - a.short || a.code.localeCompare(b.code));
    const s0 = {};
    out.forEach((r, i) => { if (r.short > 0) s0[i] = true; });
    setPlan(out); setSel(s0);
    setInfo(out.length ? "" : "Nothing to compute — none of those SKU codes matched the SKU master.");
  };

  // ---- 3. send the selected shortfall rows to Kasani ----
  const chosen = (plan || []).filter((r, i) => sel[i] && r.short > 0);
  const ask = async () => {
    if (!chosen.length) return;
    setBusy(true);
    const rows = chosen.map((r) => ({
      plan_date: planDate, sku_code: r.code, packmat: r.pm,
      qty_base: r.short, unit: baseUnit(r.pm), qty_entered: r.short,
      shift: r.shift, priority: r.priority, source: "phasing",
      demand_t: r.t, need_base: r.need, onhand_base: r.have,
      status: "open", note: note || "",
    }));
    const { error } = await addKasaniRequests(rows);
    setBusy(false);
    setInfo(error ? `Error: ${error.message || error}` : `Sent ${rows.length} request(s) to Kasani.`);
    if (!error) { setSel({}); await refresh(); }
  };

  const nShort = (plan || []).filter((r) => r.short > 0).length;

  return (<div>
    {/* results render at the top */}
    {plan && <div style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 12, flexWrap: "wrap" }}>
        <b>Shortfall for {planDate} — {nShort} short of {plan.length} line(s)</b>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input placeholder="note for Kasani (optional)" value={note} onChange={(e) => setNote(e.target.value)} style={{ ...inp, width: 210 }} />
          <button onClick={ask} disabled={busy || !chosen.length} style={{ ...btn(chosen.length ? C.red : "#94a3b8"), cursor: chosen.length ? "pointer" : "not-allowed" }}>
            {busy ? "Sending…" : `Ask Kasani (${chosen.length})`}
          </button>
        </div>
      </div>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>
        Stock is allocated shift A first, then B, then C — so &quot;on-hand&quot; below is what is still free for that shift.
      </div>
      <div style={{ maxHeight: 420, overflowY: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>
            <th style={th}></th><th style={th}>Priority</th><th style={th}>SKU</th><th style={th}>Packmat</th>
            <th style={th}>Demand (t)</th><th style={th}>Needed</th><th style={th}>On-hand</th><th style={th}>Short &#8594; pull</th>
          </tr></thead>
          <tbody>{plan.map((r, i) => (<tr key={i}>
            <td style={td}>{r.short > 0 ? <input type="checkbox" checked={!!sel[i]} onChange={(e) => setSel({ ...sel, [i]: e.target.checked })} /> : null}</td>
            <td style={td}><span style={pill(prioColor(r.priority))}>{r.priority} &middot; {r.shift}</span></td>
            <td style={{ ...td, fontWeight: 600 }}>{r.code}</td>
            <td style={td}>{LBL[r.pm]}</td>
            <td style={td}>{r.t.toFixed(2)}</td>
            <td style={td}>{r.need}</td>
            <td style={td}>{r.have}</td>
            <td style={{ ...td, fontWeight: 600, color: r.short > 0 ? C.red : C.green }}>{r.short > 0 ? `${r.short} ${UNIT[r.pm]}` : "covered"}</td>
          </tr>))}</tbody>
        </table>
      </div>
    </div>}

    {/* upload -> preview -> OK */}
    <div style={card}>
      <b>Daily phasing &#8594; shortfall (pink slip)</b>
      <div style={{ fontSize: 13, color: C.muted, margin: "6px 0" }}>
        Upload the day&apos;s phasing — columns: <b>SKU Code</b>, <b>Demand (tonnes)</b>, <b>Shift (A/B/C)</b>.
        Check the preview, then press OK to compute. Shortfall = needed &minus; on-hand, worked A &#8594; B &#8594; C.
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ fontSize: 12, color: C.muted }}>Plan date&nbsp;
          <input type="date" value={planDate} onChange={(e) => setPlanDate(e.target.value)} style={inp} /></label>
        <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => e.target.files[0] && readPhasing(e.target.files[0])} />
      </div>
      {info && <div style={{ fontSize: 13, marginTop: 8, color: /error/i.test(info) ? C.red : C.green }}>{info}</div>}

      {preview && <div style={{ marginTop: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, gap: 10, flexWrap: "wrap" }}>
          <b style={{ fontSize: 14 }}>Preview — {preview.length} row(s){preview.some((p) => !p.known) ? `, ${preview.filter((p) => !p.known).length} unknown SKU` : ""}</b>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => { setPreview(null); setPlan(null); setInfo(""); }} style={ghost}>Cancel</button>
            <button onClick={compute} style={btn(C.slate)}>OK — compute shortfall</button>
          </div>
        </div>
        <div style={{ maxHeight: 260, overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th style={th}>SKU Code</th><th style={th}>Description</th><th style={th}>Demand (t)</th><th style={th}>Shift</th></tr></thead>
            <tbody>{preview.map((p, i) => (<tr key={i}>
              <td style={{ ...td, fontWeight: 600, color: p.known ? C.ink : C.red }}>{p.code}</td>
              <td style={{ ...td, color: C.muted, fontSize: 13 }}>{p.known ? (p.desc || "").slice(0, 34) : "not in SKU master — will be skipped"}</td>
              <td style={td}>{p.t}</td>
              <td style={td}><span style={pill(prioColor(PRIO[p.shift] || 9))}>{p.shift}</span></td>
            </tr>))}</tbody>
          </table>
        </div>
      </div>}
    </div>

    <ManualKasaniAsk skus={skus} onHand={onHand} planDate={planDate} refresh={refresh} />
    <KasaniOpenList kasani={kasani} refresh={refresh} />
  </div>);
}

// ---- manual ask, outside of any phasing upload ----
function ManualKasaniAsk({ skus, onHand, planDate, refresh }) {
  const [open, setOpen] = useState(false);
  const [sku, setSku] = useState("");
  const s = skus.find((x) => x.code === sku);
  const comps = s ? compsOf(s) : [];
  const [packmat, setPackmat] = useState("");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("pcs");
  const [shift, setShift] = useState("A");
  const [note, setNote] = useState("");
  const [info, setInfo] = useState("");
  const ordered = useMemo(() => sortSkusByStock(skus, onHand), [skus, onHand]);
  useEffect(() => { if (s && !comps.includes(packmat)) setPackmat(comps[0] || ""); }, [sku]); // eslint-disable-line
  useEffect(() => { setUnit(baseUnit(packmat || "carton")); }, [packmat]);
  const opts = UNITS[packmat] || UNITS.carton;
  const f = (opts.find((o) => o.u === unit) || opts[0]).f;
  const qb = (Number(qty) || 0) * f;

  const save = async () => {
    if (!sku || !packmat || !qb) { setInfo("Pick a SKU, packmat and quantity."); return; }
    const { error } = await addKasaniRequests([{
      plan_date: planDate, sku_code: sku, packmat, qty_base: qb, unit,
      qty_entered: Number(qty), shift, priority: PRIO[shift] || 9, source: "manual",
      onhand_base: onHand[`${sku}|${packmat}`] || 0, status: "open", note,
    }]);
    if (error) { setInfo(`Error: ${error.message || error}`); return; }
    setInfo(`Requested ${qb} ${baseUnit(packmat)} of ${LBL[packmat]} for ${sku}.`);
    setQty(""); setNote(""); await refresh();
  };

  return (<div style={card}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
      <b>Manual request to Kasani</b>
      <button onClick={() => setOpen(!open)} style={ghost}>{open ? "Hide" : "+ Raise a request"}</button>
    </div>
    <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>For anything the phasing upload does not cover — an ad-hoc pull from Kasani warehouse.</div>
    {open && <div style={{ marginTop: 10 }}>
      <label style={{ fontSize: 12 }}>SKU</label><br />
      <select value={sku} onChange={(e) => setSku(e.target.value)} style={{ ...inp, width: "100%" }}>
        <option value="">select…</option>
        {ordered.map((x) => <option key={x.code} value={x.code}>{x.code} — {(x.description || "").slice(0, 26)}</option>)}
      </select>
      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 120 }}><label style={{ fontSize: 12 }}>Packmat</label><br />
          <select value={packmat} onChange={(e) => setPackmat(e.target.value)} style={{ ...inp, width: "100%" }}>{comps.map((pm) => <option key={pm} value={pm}>{LBL[pm]}</option>)}</select></div>
        <div style={{ width: 90 }}><label style={{ fontSize: 12 }}>Qty</label><br />
          <input type="number" value={qty} onChange={(e) => setQty(e.target.value)} style={{ ...inp, width: "100%" }} /></div>
        <div style={{ width: 110 }}><label style={{ fontSize: 12 }}>Unit</label><br />
          <select value={unit} onChange={(e) => setUnit(e.target.value)} style={{ ...inp, width: "100%" }}>{opts.map((o) => <option key={o.u} value={o.u}>{o.u}</option>)}</select></div>
        <div style={{ width: 90 }}><label style={{ fontSize: 12 }}>Needed in</label><br />
          <select value={shift} onChange={(e) => setShift(e.target.value)} style={{ ...inp, width: "100%" }}>{SHIFTS.map((x) => <option key={x}>{x}</option>)}</select></div>
      </div>
      {f !== 1 && Number(qty) > 0 && <div style={{ fontSize: 12, color: C.slate, marginTop: 6 }}>= {qb} {baseUnit(packmat)}</div>}
      <input placeholder="note (optional)" value={note} onChange={(e) => setNote(e.target.value)} style={{ ...inp, width: "100%", marginTop: 8 }} />
      {info && <div style={{ fontSize: 12, marginTop: 8, color: /error/i.test(info) ? C.red : C.green }}>{info}</div>}
      <button onClick={save} style={{ ...btn(C.red), width: "100%", marginTop: 10 }}>Send request to Kasani</button>
    </div>}
  </div>);
}

// ---- open asks sitting with Kasani ----
function KasaniOpenList({ kasani, refresh }) {
  const set = async (id, status) => { await setKasaniStatus(id, status); await refresh(); };
  return (<div style={card}>
    <b>Requests with Kasani ({kasani.length})</b>
    <div style={{ fontSize: 12, color: C.muted, margin: "4px 0 10px" }}>Worked in priority order: 1 = shift A (now), 2 = B, 3 = C. Mark <i>Received</i> once the material lands, then record it as <i>Incoming from Kasani</i> in Inventory so the ledger picks it up.</div>
    {kasani.length === 0 ? <div style={{ color: C.muted, fontSize: 14, padding: 8 }}>Nothing pending with Kasani.</div> :
      <div style={{ maxHeight: 340, overflowY: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th style={th}>Prio</th><th style={th}>SKU</th><th style={th}>Packmat</th><th style={th}>Qty</th><th style={th}>Src</th><th style={th}>Status</th><th style={th}></th></tr></thead>
          <tbody>{kasani.map((k) => (<tr key={k.id}>
            <td style={td}><span style={pill(prioColor(k.priority))}>{k.priority} &middot; {k.shift}</span></td>
            <td style={{ ...td, fontWeight: 600 }}>{k.sku_code}</td>
            <td style={td}>{LBL[k.packmat] || k.packmat}</td>
            <td style={td}>{Math.round(k.qty_base)} {baseUnit(k.packmat)}{k.unit && k.unit !== baseUnit(k.packmat) ? ` (${k.qty_entered} ${k.unit})` : ""}</td>
            <td style={{ ...td, color: C.muted, fontSize: 12 }}>{k.source}</td>
            <td style={{ ...td, fontWeight: 600, color: k.status === "sent" ? C.amber : C.red }}>{k.status}</td>
            <td style={{ ...td, whiteSpace: "nowrap" }}>
              {k.status === "open" && <button onClick={() => set(k.id, "sent")} style={{ ...ghost, padding: "5px 9px", marginRight: 6 }}>Sent</button>}
              <button onClick={() => set(k.id, "received")} style={{ ...btn(C.green), padding: "5px 9px", marginRight: 6 }}>Received</button>
              <button onClick={() => set(k.id, "cancelled")} style={{ ...ghost, padding: "5px 9px", color: C.red }}>Cancel</button>
            </td>
          </tr>))}</tbody>
        </table>
      </div>}
  </div>);
}

// ---------------- Settings ----------------
function Settings({ skus, msg, setMsg, refresh }) {
  const [edit, setEdit] = useState(null);
  const [add, setAdd] = useState(false);
  const [cmsg, setCmsg] = useState("");
  const importSkus = (file) => readSheet(file, async (aoa) => {
    let hr = aoa.findIndex((r) => (r || []).some((x) => /sku\s*code|^sku$/i.test(String(x)))); if (hr < 0) hr = 0;
    const H = (aoa[hr] || []).map(norm); const find = (re) => H.findIndex((h) => re.test(h));
    const iId = H.findIndex((h) => h === "sku code" || h === "sku"), iDesc = H.findIndex((h) => /descrip/.test(h) && !/primary|outer/.test(h));
    const iOut = find(/type.*out|outer.*type/), iPrim = find(/type.*prim|primary.*type/), iPc = find(/primary\s*code/), iOc = find(/outer\s*code/), iW = find(/weight|gram/), iAdd = find(/additional/);
    const rows = [];
    for (let r = hr + 1; r < aoa.length; r++) {
      const row = aoa[r] || []; const code = String(row[iId] || "").trim(); if (!code) continue;
      const w = Number(String(row[iW] || "").replace(/[^0-9.]/g, "")) || 250;
      const ot = /sac|wov/.test(String(row[iOut] || "").toLowerCase()) ? "sac" : "cld";
      rows.push({ code, description: String(row[iDesc] || ""), weight: w, primary_type: String(row[iPrim] || "").toLowerCase().includes("lam") ? "laminate" : "carton", outer_type: ot, primary_code: String(row[iPc] || ""), outer_code: String(row[iOc] || ""), divider: /divider|yes|required/.test(String(row[iAdd] || "").toLowerCase()) || (w >= 1000 && ot === "cld") });
    }
    if (!rows.length) { setMsg("No SKU rows found — check headers."); return; }
    const { error } = await upsertSkus(rows); setMsg(error ? `Error: ${error.message || error}` : `Imported ${rows.length} SKUs.`); refresh();
  });

  // conversion CSV: weight, cartons_per_t, pouch_per_t, lam_per_t, cld_per_t, sac_per_t, inner_per_t
  const importConv = (file) => readSheet(file, async (aoa) => {
    let hr = aoa.findIndex((r) => (r || []).some((x) => /weight|gram/i.test(String(x)))); if (hr < 0) hr = 0;
    const H = (aoa[hr] || []).map(norm); const find = (re) => H.findIndex((h) => re.test(h));
    const iW = find(/weight|gram/);
    const cols = {
      cartons_per_t: find(/carton/), pouch_per_t: find(/pouch/), lam_per_t: find(/lam/),
      cld_per_t: find(/cld/), sac_per_t: find(/sac/), inner_per_t: find(/inner|divider/),
    };
    const num = (v) => { const n = Number(String(v == null ? "" : v).replace(/[^0-9.]/g, "")); return Number.isFinite(n) && n > 0 ? n : null; };
    const rows = [];
    for (let r = hr + 1; r < aoa.length; r++) {
      const row = aoa[r] || []; const w = num(row[iW]); if (!w) continue;
      const o = { weight: Math.round(w) };
      Object.entries(cols).forEach(([k, i]) => { o[k] = i >= 0 ? num(row[i]) : null; });   // "-" or blank -> null
      rows.push(o);
    }
    if (!rows.length) { setCmsg("No conversion rows found — there should be a weight (g) column."); return; }
    const { error } = await upsertConversion(rows);
    setCmsg(error ? `Error: ${error.message || error}` : `Upserted ${rows.length} conversion row(s).`); refresh();
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
      <b>Import conversion factors</b>
      <div style={{ fontSize: 13, color: C.muted, margin: "6px 0" }}>
        Columns: weight (g), cartons_per_t, pouch_per_t, lam_per_t, cld_per_t, sac_per_t, inner_per_t — all &quot;base units per tonne of FG&quot;. Blank or &quot;-&quot; means that packmat does not apply at that weight. Rows are upserted by weight.
      </div>
      <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => e.target.files[0] && importConv(e.target.files[0])} />
      {cmsg && <div style={{ fontSize: 13, marginTop: 8, color: /error/i.test(cmsg) ? C.red : C.green }}>{cmsg}</div>}
    </div>
    <div style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 8 }}>
        <b>Active SKUs ({skus.length})</b>
        <button onClick={() => setAdd(true)} style={{ ...btn(C.slate), padding: "7px 12px" }}>+ Add SKU</button>
      </div>
      <div style={{ maxHeight: 360, overflowY: "auto", marginTop: 8 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th style={th}>Code</th><th style={th}>Description</th><th style={th}>Wt</th><th style={th}>Primary</th><th style={th}>Outer</th><th style={th}></th></tr></thead>
          <tbody>{skus.map((s) => (<tr key={s.code}><td style={{ ...td, fontWeight: 600 }}>{s.code}</td><td style={{ ...td, color: C.muted, fontSize: 13 }}>{(s.description || "").slice(0, 30)}</td><td style={td}>{s.weight}</td><td style={td}>{s.primary_type} <span style={{ color: C.muted, fontFamily: "monospace", fontSize: 11 }}>{s.primary_code}</span></td><td style={td}>{s.outer_type} <span style={{ color: C.muted, fontFamily: "monospace", fontSize: 11 }}>{s.outer_code}</span></td><td style={td}><button onClick={() => setEdit(s)} style={ghost}>Edit</button></td></tr>))}</tbody>
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
      primary_type: String(f.primary_type || "carton").toLowerCase(),
      outer_type: String(f.outer_type || "cld").toLowerCase(),
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
  const save = async () => { await updateSku(sku.code, { description: f.description, weight: Number(f.weight), primary_type: String(f.primary_type || "").toLowerCase(), outer_type: String(f.outer_type || "").toLowerCase(), primary_code: f.primary_code, outer_code: f.outer_code, divider: !!f.divider }); onSaved(); };
  const F = (lbl, key) => (<label style={{ fontSize: 12, display: "block", marginBottom: 8 }}>{lbl}<br /><input value={f[key] || ""} onChange={(e) => setF({ ...f, [key]: e.target.value })} style={{ ...inp, width: "100%" }} /></label>);
  return (<Overlay onClose={onClose}><b>Edit {sku.code}</b>
    {F("Description", "description")}{F("Weight", "weight")}
    <div style={{ display: "flex", gap: 8 }}><div style={{ flex: 1 }}>{F("Primary type", "primary_type")}</div><div style={{ flex: 1 }}>{F("Primary code", "primary_code")}</div></div>
    <div style={{ display: "flex", gap: 8 }}><div style={{ flex: 1 }}>{F("Outer type", "outer_type")}</div><div style={{ flex: 1 }}>{F("Outer code", "outer_code")}</div></div>
    <label style={{ fontSize: 13 }}><input type="checkbox" checked={!!f.divider} onChange={(e) => setF({ ...f, divider: e.target.checked })} /> Divider required</label>
    <button onClick={save} style={{ ...btn(C.slate), width: "100%", marginTop: 12 }}>Save</button>
  </Overlay>);
}

// SKUs that actually have stock come first (most stock first), then the rest by code.
function sortSkusByStock(skus, onHand) {
  const tot = (s) => compsOf(s).reduce((a, pm) => a + Math.max(0, onHand[`${s.code}|${pm}`] || 0), 0);
  return [...skus].sort((a, b) => {
    const ta = tot(a), tb = tot(b);
    if ((ta > 0) !== (tb > 0)) return ta > 0 ? -1 : 1;
    if (ta > 0 && tb > 0 && ta !== tb) return tb - ta;
    return String(a.code).localeCompare(String(b.code));
  });
}

// ---------------- Action modal (Issue / Incoming / Return / Block) ----------------
function ActionModal({ modal, skus, onHand, onClose, onSave }) {
  const titles = { issue: "Issue packmat to line", receive: "Incoming from Kasani", return: "Return unused", block: "Block / reject" };
  const [sku, setSku] = useState(modal.sku || "");
  const s = skus.find((x) => x.code === sku);
  const comps = s ? compsOf(s) : [];
  const [packmat, setPackmat] = useState(modal.packmat || "");
  const [qty, setQty] = useState(""); const [unit, setUnit] = useState("pcs");
  const [line, setLine] = useState(""); const [shift, setShift] = useState("A");
  useEffect(() => { if (s && !comps.includes(packmat)) setPackmat(comps[0] || ""); }, [sku]); // eslint-disable-line
  useEffect(() => { setUnit(baseUnit(packmat || "carton")); }, [packmat]);
  const ordered = useMemo(() => sortSkusByStock(skus, onHand), [skus, onHand]);   // in-stock SKUs first
  const opts = UNITS[packmat] || UNITS.carton;
  const f = (opts.find((o) => o.u === unit) || opts[0]).f;
  const qb = (Number(qty) || 0) * f;
  const avail = onHand[`${sku}|${packmat}`] || 0;
  const submit = () => {
    if (!sku || !packmat || !qb) return;
    onSave({
      sku_code: sku, packmat, direction: modal.type, qty_base: qb,
      line: modal.type === "issue" ? line : "", shift,
      note: `${Number(qty)} ${unit}`,   // keep what was actually typed
    });
  };
  return (<Overlay onClose={onClose}><b>{titles[modal.type]}</b>
    <label style={{ fontSize: 12, display: "block", margin: "10px 0 4px" }}>SKU <span style={{ color: C.muted }}>(in-stock first)</span></label>
    <select value={sku} onChange={(e) => setSku(e.target.value)} style={{ ...inp, width: "100%" }}><option value="">select…</option>{ordered.map((x) => <option key={x.code} value={x.code}>{x.code} — {(x.description || "").slice(0, 26)}</option>)}</select>
    <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
      <div style={{ flex: 1, minWidth: 110 }}><label style={{ fontSize: 12 }}>Packmat</label><br /><select value={packmat} onChange={(e) => setPackmat(e.target.value)} style={{ ...inp, width: "100%" }}>{comps.map((pm) => <option key={pm} value={pm}>{LBL[pm]}</option>)}</select></div>
      <div style={{ width: 90 }}><label style={{ fontSize: 12 }}>Qty</label><br /><input type="number" value={qty} onChange={(e) => setQty(e.target.value)} style={{ ...inp, width: "100%" }} /></div>
      <div style={{ width: 110 }}><label style={{ fontSize: 12 }}>Unit</label><br /><select value={unit} onChange={(e) => setUnit(e.target.value)} style={{ ...inp, width: "100%" }}>{opts.map((o) => <option key={o.u} value={o.u}>{o.u}</option>)}</select></div>
    </div>
    {f !== 1 && Number(qty) > 0 && <div style={{ fontSize: 12, color: C.slate, marginTop: 6 }}>= {qb} {baseUnit(packmat)}</div>}
    {sku && packmat && <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>On-hand now: {Math.round(avail)} {UNIT[packmat]}</div>}
    {modal.type === "issue" && <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
      <div style={{ flex: 1 }}><label style={{ fontSize: 12 }}>Machine / line</label><br /><input value={line} onChange={(e) => setLine(e.target.value)} placeholder="e.g. K9" style={{ ...inp, width: "100%" }} /></div>
      <div style={{ width: 90 }}><label style={{ fontSize: 12 }}>Shift</label><br /><select value={shift} onChange={(e) => setShift(e.target.value)} style={{ ...inp, width: "100%" }}>{SHIFTS.map((x) => <option key={x}>{x}</option>)}</select></div>
    </div>}
    <button onClick={submit} style={{ ...btn(C.slate), width: "100%", marginTop: 14 }}>Save</button>
  </Overlay>);
}

function Overlay({ children, onClose }) {
  return (<div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 50 }}>
    <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 12, padding: 18, width: "100%", maxWidth: 440, maxHeight: "88vh", overflowY: "auto" }}>{children}</div>
  </div>);
}
