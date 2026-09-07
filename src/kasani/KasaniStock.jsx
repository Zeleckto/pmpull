// Stock Status. Two ways to look at the same rows:
//   By material — what Kasani has of each material code, and WHERE to pick it from.
//                 The location shown is the oldest invoice still holding stock; when that
//                 invoice runs out it drops off and the next oldest one's location shows.
//   By invoice  — every consignment with its quality state and the action to take.
//     Quality pending (red) -> Send Sample ; Sample sent (orange) -> Clear / Block.
import React, { useEffect, useState } from "react";
import {
  loadConsignments, setConsignmentStatus, addConsignments, loadSkusK,
  stockByMaterial, remainingOf, clearOpeningStock, fillSkuGaps,
} from "../dataKasani";
import {
  LBL, BASE_UNIT, grStatus, compsOf, codeFor, findByCode,
  C, btn, ghost, card, inp, th, td, readSheet, norm, todayStr,
} from "../shared";

const COUNTS = [
  { key: "pending", label: "Quality pending", color: C.red },
  { key: "sample", label: "Sample sent", color: C.amber },
  { key: "cleared", label: "Cleared", color: C.green },
  { key: "rejected", label: "Blocked", color: "#7f1d1d" },
];

export default function KasaniStock() {
  const [cons, setCons] = useState([]);
  const [skus, setSkus] = useState([]);
  const [view, setView] = useState("material");   // material | invoice
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("");
  const [reject, setReject] = useState(null);
  const [reason, setReason] = useState("");
  const [expand, setExpand] = useState({});       // material key -> show all invoices
  const [detail, setDetail] = useState(null);     // material clicked open: full invoice list
  const [chosenInv, setChosenInv] = useState(null); // invoice picked inside that box
  const [up, setUp] = useState(null);             // parsed CSV awaiting confirmation
  const [asCleared, setAsCleared] = useState(true);
  const [op, setOp] = useState(null);              // parsed opening-stock sheet
  const [opDate, setOpDate] = useState(todayStr());
  const [opReplace, setOpReplace] = useState(true);
  const [opFillMaster, setOpFillMaster] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const refresh = async () => { setCons(await loadConsignments()); setSkus(await loadSkusK()); };
  useEffect(() => { refresh(); }, []);

  // ---------- quality actions ----------
  const act = async (c, patch, note) => { await setConsignmentStatus(c.id, patch); setMsg(note); refresh(); };
  const sendSample = (c) => act(c, { sample_sent: true, sample_sent_at: new Date().toISOString() }, `Sample sent for ${c.sku_code} (${c.invoice || "no invoice"}).`);
  const clear = (c) => act(c, { status: "cleared", cleared_at: new Date().toISOString() }, `${c.sku_code} cleared — now available to dispatch.`);
  const unblock = (c) => act(c, { status: "pending", reject_reason: null }, `${c.sku_code} put back to quality pending.`);
  const doReject = async () => {
    if (!reject) return;
    await setConsignmentStatus(reject.id, { status: "rejected", reject_reason: reason });
    setMsg(`${reject.sku_code} blocked — it will not be dispatched.`);
    setReject(null); setReason(""); refresh();
  };

  // ---------- stock CSV ----------
  // Anything can be blank. If only a material code is given the SKU and packmat are
  // looked up from it; if only a SKU is given the code is derived. Rows still upload
  // when neither resolves — they just show with whatever was in the sheet.
  const parseCsv = (file) => readSheet(file, (aoa) => {
    let hr = aoa.findIndex((r) => (r || []).some((x) => /code|sku|packmat|material/i.test(String(x))));
    if (hr < 0) hr = 0;
    const H = (aoa[hr] || []).map(norm);
    const find = (re) => H.findIndex((h) => re.test(h));
    const iCode = find(/material.*code|packmat.*code|^code$|pm.*code/);
    const iSku = H.findIndex((h) => /sku|cbu/.test(h) && !/desc/.test(h));
    const iDesc = find(/desc/);
    const iType = find(/packmat.*type|^packmat$|^type$|pack.*type/);
    const iQty = find(/qty|quantity|stock|on.?hand|balance/);
    const iLoc = find(/location|bin|rack|store/);
    const iInv = find(/invoice|inv.*no|bill/);
    const iDate = find(/invoice.*date|received|grn.*date|^date$/);
    const iSup = find(/supplier|vendor|party/);

    const typeOf = (raw) => {
      const t = String(raw || "").toLowerCase();
      if (!t) return "";
      if (t.includes("lam")) return "laminate";
      if (t.includes("cld") || t.includes("case")) return "cld";
      if (t.includes("sac") || t.includes("wov")) return "sac";
      if (t.includes("div") || t.includes("inner")) return "divider";
      if (t.includes("cart") || t.includes("box")) return "carton";
      return "";
    };
    const rows = [];
    for (let r = hr + 1; r < aoa.length; r++) {
      const row = aoa[r] || [];
      const cell = (i) => (i >= 0 ? String(row[i] == null ? "" : row[i]).trim() : "");
      const code = cell(iCode);
      let sku = cell(iSku);
      let packmat = typeOf(cell(iType));
      const qty = Number(cell(iQty).replace(/[^0-9.\-]/g, "")) || 0;
      if (!code && !sku && !qty) continue;               // truly empty line

      // fill in whatever is missing, from whichever side was supplied
      if (code && (!sku || !packmat)) {
        const hits = findByCode(skus, code);
        if (hits.length === 1) { sku = sku || hits[0].sku.code; packmat = packmat || hits[0].packmat; }
        else if (hits.length > 1 && packmat) {
          const h = hits.find((x) => x.packmat === packmat);
          if (h) sku = sku || h.sku.code;
        }
      }
      const sObj = skus.find((x) => x.code === sku);
      if (sObj && !packmat) { const c0 = compsOf(sObj); if (c0.length === 1) packmat = c0[0]; }
      const derivedCode = sObj && packmat ? codeFor(sObj, packmat) : "";

      rows.push({
        packmat_code: code || derivedCode || null,
        sku_code: sku || null,
        sku_desc: cell(iDesc) || (sObj ? sObj.description : "") || null,
        packmat: packmat || null,
        qty_base: qty,
        location: cell(iLoc) || null,
        invoice: cell(iInv) || null,
        invoice_date: /^\d{4}-\d{2}-\d{2}/.test(cell(iDate)) ? cell(iDate).slice(0, 10) : null,
        received_raw: cell(iDate),
        supplier: cell(iSup) || null,
        known: !!sObj,
      });
    }
    setUp(rows);
    setMsg(rows.length ? "" : "No usable rows — the sheet needs at least a material code or SKU, and a quantity.");
  });

  const commitCsv = async () => {
    if (!up || !up.length) return;
    setBusy(true);
    // oldest first, so the received_at order matches the order in the sheet
    const base = Date.now() - up.length * 1000;
    const rows = up.map((r, i) => ({
      received_at: /^\d{4}-\d{2}-\d{2}/.test(r.received_raw)
        ? new Date(r.received_raw.slice(0, 10)).toISOString()
        : new Date(base + i * 1000).toISOString(),
      invoice: r.invoice, invoice_date: r.invoice_date,
      sku_code: r.sku_code, sku_desc: r.sku_desc,
      packmat: r.packmat, packmat_code: r.packmat_code,
      qty_base: r.qty_base, qty_remaining: r.qty_base,
      qty_entered: r.qty_base, unit: r.packmat ? BASE_UNIT[r.packmat] : null,
      location: r.location, floor: /first/i.test(r.location || "") ? "First" : "Ground",
      supplier: r.supplier, source: "csv",
      status: asCleared ? "cleared" : "pending",
      cleared_at: asCleared ? new Date().toISOString() : null,
      sample_sent: false,
    }));
    const { error } = await addConsignments(rows);
    setBusy(false);
    if (error) { setMsg(`Error: ${error.message || error}`); return; }
    setMsg(`Loaded ${rows.length} stock row(s).`);
    setUp(null); refresh();
  };

  // ---------- opening stock, from the wide "qty in hand" sheet ----------
  // One row carries BOTH packmats:
  //   SKU Code | Description | Primary Type | Primary Packmat Code | Outer Type |
  //   Outer Packmat Code | Qty in Hand - Primary | Qty in Hand - Outer
  // so each row becomes up to two consignments. Cells holding 0, "-" or blank are
  // treated as MISSING and the SKU master is used instead — never the other way round.
  const canonPrimary = (t) => (String(t || "").toLowerCase().includes("lam") ? "laminate" : "carton");
  const canonOuter = (t) => (/sac|wov/.test(String(t || "").toLowerCase()) ? "sac" : "cld");
  const blankish = (v) => {
    const t = String(v == null ? "" : v).trim();
    return !t || t === "-" || t === "0" || t === "0.00";
  };
  const numOf = (v) => {
    const t = String(v == null ? "" : v).replace(/,/g, "").trim();
    if (!t || t === "-") return 0;
    const n = Number(t.replace(/[^0-9.\-]/g, ""));
    return Number.isFinite(n) && n > 0 ? n : 0;
  };

  const parseOpening = (file) => readSheet(file, (aoa) => {
    let hr = aoa.findIndex((r) => (r || []).some((x) => /sku\s*code|cbu/i.test(String(x))));
    if (hr < 0) hr = 0;
    const H = (aoa[hr] || []).map(norm);
    const at = (test) => H.findIndex(test);
    const iSku = at((h) => /^sku\s*code$|^sku$|^cbu/.test(h)) >= 0 ? at((h) => /^sku\s*code$|^sku$|^cbu/.test(h)) : at((h) => /sku|cbu/.test(h));
    const iDesc = at((h) => /descrip/.test(h));
    const iQtyP = at((h) => /qty|hand/.test(h) && /primar/.test(h));
    const iQtyO = at((h) => /qty|hand/.test(h) && /outer/.test(h));
    const iCodeP = at((h) => /primar/.test(h) && /code/.test(h) && !/qty|hand/.test(h));
    const iCodeO = at((h) => /outer/.test(h) && /code/.test(h) && !/qty|hand/.test(h));
    const iTypeP = at((h) => /primar/.test(h) && /type/.test(h));
    const iTypeO = at((h) => /outer/.test(h) && /type/.test(h));
    if (iSku < 0 || (iQtyP < 0 && iQtyO < 0)) {
      setMsg("Could not find the columns — expected SKU Code plus Qty in Hand - Primary / Qty in Hand - Outer.");
      return;
    }
    const out = [];
    for (let r = hr + 1; r < aoa.length; r++) {
      const row = aoa[r] || [];
      const code = String(row[iSku] || "").trim();
      if (!code) continue;
      const master = skus.find((x) => x.code === code);
      const cell = (i) => (i >= 0 ? row[i] : "");

      // sheet value if it is real, otherwise whatever the SKU master already knows
      const pType = blankish(cell(iTypeP)) ? (master ? master.primary_type : "") : cell(iTypeP);
      const oType = blankish(cell(iTypeO)) ? (master ? master.outer_type : "") : cell(iTypeO);
      const pCode = blankish(cell(iCodeP)) ? (master ? master.primary_code : "") : String(cell(iCodeP)).trim();
      const oCode = blankish(cell(iCodeO)) ? (master ? master.outer_code : "") : String(cell(iCodeO)).trim();

      out.push({
        sku_code: code,
        desc: String(cell(iDesc) || "").trim() || (master ? master.description : ""),
        known: !!master,
        primary: pType ? { packmat: canonPrimary(pType), code: pCode || "", qty: numOf(cell(iQtyP)) } : null,
        outer: oType ? { packmat: canonOuter(oType), code: oCode || "", qty: numOf(cell(iQtyO)) } : null,
      });
    }
    const usable = out.filter((r) => (r.primary && r.primary.qty > 0) || (r.outer && r.outer.qty > 0));
    setOp({ all: out, usable });
    setMsg(usable.length ? "" : "Rows read, but every quantity was zero or blank.");
  });

  const opTotals = () => {
    const t = {};
    (op ? op.usable : []).forEach((r) => {
      [r.primary, r.outer].forEach((x) => {
        if (!x || x.qty <= 0) return;
        t[x.packmat] = (t[x.packmat] || 0) + x.qty;
      });
    });
    return t;
  };

  const commitOpening = async () => {
    if (!op || !op.usable.length) return;
    setBusy(true);
    if (opReplace) {
      const { error } = await clearOpeningStock();
      if (error) { setBusy(false); setMsg(`Error clearing old opening stock: ${error.message || error}`); return; }
    }
    // fill only the BLANKS on the SKU master — an existing value is never touched
    if (opFillMaster) {
      const patch = [];
      op.all.forEach((r) => {
        const m = skus.find((x) => x.code === r.sku_code);
        if (!m) return;
        const next = { ...m };
        let changed = false;
        if (!String(m.primary_code || "").trim() && r.primary && r.primary.code) { next.primary_code = r.primary.code; changed = true; }
        if (!String(m.outer_code || "").trim() && r.outer && r.outer.code) { next.outer_code = r.outer.code; changed = true; }
        if (!String(m.primary_type || "").trim() && r.primary) { next.primary_type = r.primary.packmat; changed = true; }
        if (!String(m.outer_type || "").trim() && r.outer) { next.outer_type = r.outer.packmat; changed = true; }
        if (changed) patch.push(next);
      });
      if (patch.length) {
        const { error } = await fillSkuGaps(patch);
        if (error) { setBusy(false); setMsg(`Error updating the SKU master: ${error.message || error}`); return; }
      }
    }
    const stamp = new Date(`${opDate}T06:00:00`).toISOString();
    const rows = [];
    op.usable.forEach((r) => {
      [r.primary, r.outer].forEach((x) => {
        if (!x || x.qty <= 0) return;
        rows.push({
          received_at: stamp, invoice: "OPENING", sku_code: r.sku_code, sku_desc: r.desc,
          packmat: x.packmat, packmat_code: x.code || null,
          qty_base: x.qty, qty_remaining: x.qty, qty_entered: x.qty, unit: BASE_UNIT[x.packmat],
          location: "Kasani", floor: "Ground", supplier: null, source: "opening",
          status: "cleared", cleared_at: stamp, sample_sent: false,
          note: "opening stock load",
        });
      });
    });
    const { error } = await addConsignments(rows);
    setBusy(false);
    if (error) { setMsg(`Error: ${error.message || error}`); return; }
    setMsg(`Opening stock loaded: ${rows.length} line(s) across ${op.usable.length} SKU(s), dated ${opDate}.`);
    setOp(null); refresh();
  };

  // ---------- views ----------
  const desc = (code) => (skus.find((s) => s.code === code) || {}).description || "";
  const withStatus = cons.map((c) => ({ ...c, st: grStatus(c) }));
  const rows = withStatus
    .filter((c) => !filter || c.st.key === filter)
    .filter((c) => !q || `${c.invoice} ${c.sku_code} ${desc(c.sku_code)} ${LBL[c.packmat]} ${c.packmat_code} ${c.location} ${c.supplier}`.toLowerCase().includes(q.toLowerCase()));
  const count = (k) => withStatus.filter((c) => c.st.key === k).length;

  const materials = stockByMaterial(cons)
    .filter((g) => !q || `${g.sku_code} ${g.sku_desc || desc(g.sku_code)} ${LBL[g.packmat]} ${g.packmat_code} ${(g.oldest || {}).location}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => String(a.packmat_code || "~").localeCompare(String(b.packmat_code || "~")));

  const Tab = ({ id, children }) => (
    <button onClick={() => setView(id)} style={{
      padding: "8px 16px", borderRadius: 8, marginRight: 8, fontWeight: 600, cursor: "pointer",
      border: `1px solid ${C.line}`, background: view === id ? C.slate : "#fff", color: view === id ? "#fff" : "#334155",
    }}>{children}</button>
  );

  return (<div>
    {/* status summary — also the filter */}
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
      {COUNTS.map((s) => (
        <button key={s.key} onClick={() => { setFilter(filter === s.key ? "" : s.key); setView("invoice"); }} style={{
          background: filter === s.key ? s.color : "#fff", color: filter === s.key ? "#fff" : C.ink,
          border: `1px solid ${filter === s.key ? s.color : C.line}`, borderLeft: `6px solid ${s.color}`,
          borderRadius: 10, padding: "12px 18px", cursor: "pointer", font: "inherit", minWidth: 150, textAlign: "left",
        }}>
          <div style={{ fontSize: 12, opacity: 0.85 }}>{s.label}</div>
          <div style={{ fontSize: 26, fontWeight: 700 }}>{count(s.key)}</div>
        </button>
      ))}
    </div>

    {/* ---- CSV load ---- */}
    {/* ---- opening stock: the wide "qty in hand" sheet ---- */}
    <div style={{ ...card, borderLeft: `5px solid ${C.blue}` }}>
      <b>Load opening stock (qty in hand sheet)</b>
      <div style={{ fontSize: 13, color: C.muted, margin: "6px 0 10px" }}>
        The wide layout: <b>SKU Code · Description · Primary Type · Primary Packmat Code · Outer Type · Outer Packmat Code ·
        Qty in Hand - Primary · Qty in Hand - Outer</b>. Each row becomes up to two stock lines.
        Cells holding <b>0</b>, <b>-</b> or blank are treated as missing and the SKU master is used instead — the sheet never overwrites it.
        Quantities go in as they are: laminate in <b>kg</b>, carton / CLD / sac in <b>pcs</b>.
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => e.target.files[0] && parseOpening(e.target.files[0])} />
        <label style={{ fontSize: 12, color: C.muted }}>Stock as at&nbsp;
          <input type="date" value={opDate} onChange={(e) => setOpDate(e.target.value)} style={inp} /></label>
        <label style={{ fontSize: 13, color: C.muted }}>
          <input type="checkbox" checked={opReplace} onChange={(e) => setOpReplace(e.target.checked)} /> replace previous opening stock
        </label>
        <label style={{ fontSize: 13, color: C.muted }}>
          <input type="checkbox" checked={opFillMaster} onChange={(e) => setOpFillMaster(e.target.checked)} /> fill blank codes on the SKU master
        </label>
      </div>

      {op && <div style={{ marginTop: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
          <div>
            <b style={{ fontSize: 14 }}>Preview — {op.usable.length} SKU(s) with stock, {op.all.length - op.usable.length} with none</b>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
              {Object.entries(opTotals()).map(([pm, v]) => `${LBL[pm]}: ${Math.round(v).toLocaleString()} ${BASE_UNIT[pm]}`).join("  ·  ") || "nothing"}
              {op.all.some((r) => !r.known) ? ` · ${op.all.filter((r) => !r.known).length} not in the SKU master (still loads)` : ""}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => { setOp(null); setMsg(""); }} style={ghost}>Cancel</button>
            <button onClick={commitOpening} disabled={busy || !op.usable.length} style={btn(C.blue)}>
              {busy ? "Loading…" : `Load ${op.usable.reduce((a, r) => a + ((r.primary && r.primary.qty > 0) ? 1 : 0) + ((r.outer && r.outer.qty > 0) ? 1 : 0), 0)} stock line(s)`}
            </button>
          </div>
        </div>
        <div style={{ maxHeight: 300, overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              <th style={th}>SKU</th><th style={th}>Description</th>
              <th style={th}>Primary</th><th style={th}>Code</th><th style={th}>Qty</th>
              <th style={th}>Outer</th><th style={th}>Code</th><th style={th}>Qty</th>
            </tr></thead>
            <tbody>{op.usable.map((r, i) => (<tr key={i}>
              <td style={{ ...td, fontWeight: 600, color: r.known ? C.ink : C.amber }}>{r.sku_code}</td>
              <td style={{ ...td, color: C.muted, fontSize: 13 }}>{(r.desc || "").slice(0, 26)}</td>
              <td style={td}>{r.primary ? LBL[r.primary.packmat] : "—"}</td>
              <td style={{ ...td, fontFamily: "monospace", fontSize: 12 }}>{(r.primary && r.primary.code) || "—"}</td>
              <td style={{ ...td, fontWeight: 600 }}>{r.primary && r.primary.qty > 0 ? Math.round(r.primary.qty).toLocaleString() : "—"}</td>
              <td style={td}>{r.outer ? LBL[r.outer.packmat] : "—"}</td>
              <td style={{ ...td, fontFamily: "monospace", fontSize: 12 }}>{(r.outer && r.outer.code) || "—"}</td>
              <td style={{ ...td, fontWeight: 600 }}>{r.outer && r.outer.qty > 0 ? Math.round(r.outer.qty).toLocaleString() : "—"}</td>
            </tr>))}</tbody>
          </table>
        </div>
      </div>}
    </div>

    <div style={card}>
      <b>Load stock from a sheet</b>
      <div style={{ fontSize: 13, color: C.muted, margin: "6px 0 10px" }}>
        Columns picked up: <b>material code</b>, SKU, description, packmat type, qty, location, invoice, invoice date, supplier.
        Any of them may be blank — a row with just a material code and a quantity still loads, and the SKU is looked up from the code.
        The same material on several invoices stays as separate rows, which is what makes the pick location work.
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => e.target.files[0] && parseCsv(e.target.files[0])} />
        <label style={{ fontSize: 13, color: C.muted }}>
          <input type="checkbox" checked={asCleared} onChange={(e) => setAsCleared(e.target.checked)} /> already quality-cleared
        </label>
      </div>
      {up && <div style={{ marginTop: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
          <b style={{ fontSize: 14 }}>
            Preview — {up.length} row(s){up.filter((r) => !r.known).length ? `, ${up.filter((r) => !r.known).length} not matched to the SKU master (still uploads)` : ""}
          </b>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => { setUp(null); setMsg(""); }} style={ghost}>Cancel</button>
            <button onClick={commitCsv} disabled={busy} style={btn(C.green)}>{busy ? "Loading…" : `Load ${up.length} row(s)`}</button>
          </div>
        </div>
        <div style={{ maxHeight: 240, overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th style={th}>Code</th><th style={th}>SKU</th><th style={th}>Description</th><th style={th}>Packmat</th><th style={th}>Qty</th><th style={th}>Location</th><th style={th}>Invoice</th></tr></thead>
            <tbody>{up.map((r, i) => (<tr key={i}>
              <td style={{ ...td, fontFamily: "monospace", fontSize: 12 }}>{r.packmat_code || "—"}</td>
              <td style={{ ...td, fontWeight: 600, color: r.known ? C.ink : C.amber }}>{r.sku_code || "—"}</td>
              <td style={{ ...td, color: C.muted, fontSize: 13 }}>{(r.sku_desc || "").slice(0, 28) || "—"}</td>
              <td style={td}>{r.packmat ? LBL[r.packmat] : <span style={{ color: C.amber }}>—</span>}</td>
              <td style={td}>{r.qty_base}</td>
              <td style={td}>{r.location || "—"}</td>
              <td style={td}>{r.invoice || "—"}</td>
            </tr>))}</tbody>
          </table>
        </div>
      </div>}
      {msg && <div style={{ fontSize: 13, marginTop: 10, padding: "8px 10px", borderRadius: 8, background: /error|No usable/i.test(msg) ? "#fef2f2" : "#f0fdf4", color: /error|No usable/i.test(msg) ? C.red : C.green }}>{msg}</div>}
    </div>

    <div style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
        <div><Tab id="material">By material</Tab><Tab id="invoice">By invoice</Tab></div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {filter && <button onClick={() => setFilter("")} style={ghost}>Show all statuses</button>}
          <input placeholder="search code / SKU / packmat / location" value={q} onChange={(e) => setQ(e.target.value)} style={{ ...inp, width: 320 }} />
        </div>
      </div>

      {/* ---------- BY MATERIAL: what we have and where to pick it ---------- */}
      {view === "material" && <>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>
          Cleared stock only. <b>Pick from</b> is the oldest invoice still holding stock — when it empties, the next invoice&apos;s location takes its place automatically.
          Click any row to open its full invoice list and pick a specific one.
        </div>
        <div style={{ maxHeight: 480, overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              <th style={th}>Material code</th><th style={th}>SKU</th><th style={th}>Description</th><th style={th}>Packmat</th>
              <th style={th}>Qty we have</th><th style={th}>Pick from (oldest)</th><th style={th}>Then</th><th style={th}></th>
            </tr></thead>
            <tbody>{materials.length === 0 ? <tr><td style={td} colSpan={8}>No cleared stock.</td></tr> :
              materials.map((g) => {
                const k = `${g.sku_code}|${g.packmat}`;
                return (<React.Fragment key={k}>
                  <tr onClick={() => { setDetail(g); setChosenInv(g.oldest); }} style={{ cursor: "pointer" }} title="Open the invoice list">
                    <td style={{ ...td, fontFamily: "monospace", fontWeight: 600, color: C.blue, textDecoration: "underline" }}>{g.packmat_code || "—"}</td>
                    <td style={{ ...td, fontWeight: 600 }}>{g.sku_code || "—"}</td>
                    <td style={{ ...td, color: C.muted, fontSize: 13 }}>{(g.sku_desc || desc(g.sku_code) || "").slice(0, 26) || "—"}</td>
                    <td style={td}>{LBL[g.packmat] || g.packmat || "—"}</td>
                    <td style={{ ...td, fontWeight: 700 }}>{Math.round(g.qty)} {BASE_UNIT[g.packmat] || ""}</td>
                    <td style={td}>
                      <b>{(g.oldest || {}).location || "—"}</b>
                      <div style={{ fontSize: 11, color: C.muted }}>
                        inv {(g.oldest || {}).invoice || "—"} · {Math.round((g.oldest || {}).qty || 0)} left
                      </div>
                    </td>
                    <td style={{ ...td, fontSize: 12, color: C.muted }}>
                      {g.next ? <>{g.next.location}<div style={{ fontSize: 11 }}>inv {g.next.invoice || "—"}</div></> : "—"}
                    </td>
                    <td style={td}>{g.invoices.length > 1 &&
                      <button onClick={(ev) => { ev.stopPropagation(); setExpand({ ...expand, [k]: !expand[k] }); }} style={{ ...ghost, padding: "3px 9px", fontSize: 12 }}>
                        {expand[k] ? "Hide" : `${g.invoices.length} invoices`}
                      </button>}</td>
                  </tr>
                  {expand[k] && g.invoices.map((iv, n) => (
                    <tr key={iv.id} style={{ background: "#f8fafc" }}>
                      <td style={td}></td>
                      <td style={{ ...td, fontSize: 12, color: C.muted }} colSpan={2}>
                        {n === 0 ? "→ picking now" : `${n + 1}${n === 1 ? "nd" : n === 2 ? "rd" : "th"} in line`}
                      </td>
                      <td style={{ ...td, fontSize: 12 }}>inv {iv.invoice || "—"}</td>
                      <td style={{ ...td, fontSize: 12 }}>{Math.round(iv.qty)} left</td>
                      <td style={{ ...td, fontSize: 12 }}>{iv.location || "—"}</td>
                      <td style={{ ...td, fontSize: 11, color: C.muted }} colSpan={2}>{String(iv.received_at || "").slice(0, 10)}</td>
                    </tr>
                  ))}
                </React.Fragment>);
              })}</tbody>
          </table>
        </div>
      </>}

      {/* ---------- BY INVOICE: quality workflow ---------- */}
      {view === "invoice" && <div style={{ maxHeight: 480, overflowY: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>
            <th style={th}>Status</th><th style={th}>Invoice</th><th style={th}>SKU</th><th style={th}>Packmat</th>
            <th style={th}>Code</th><th style={th}>Qty (left)</th><th style={th}>Location</th><th style={th}>Action</th>
          </tr></thead>
          <tbody>{rows.length === 0 ? <tr><td style={td} colSpan={8}>Nothing here.</td></tr> :
            rows.map((c) => (<tr key={c.id}>
              <td style={td}><span style={{ background: c.st.color, color: "#fff", borderRadius: 10, padding: "2px 9px", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>{c.st.label}</span></td>
              <td style={td}>{c.invoice || "—"}</td>
              <td style={{ ...td, fontWeight: 600 }}>{c.sku_code || "—"}</td>
              <td style={td}>{LBL[c.packmat] || c.packmat || "—"}</td>
              <td style={{ ...td, fontFamily: "monospace", fontSize: 12, color: C.muted }}>{c.packmat_code || "—"}</td>
              <td style={{ ...td, color: remainingOf(c) < 0 ? C.red : C.ink }}>
                {Math.round(remainingOf(c))} {BASE_UNIT[c.packmat] || ""}
                {Math.round(remainingOf(c)) !== Math.round(c.qty_base) && <span style={{ color: C.muted, fontSize: 11 }}> / {Math.round(c.qty_base)}</span>}
              </td>
              <td style={td}>{c.location || "—"}</td>
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
      </div>}
    </div>

    {/* ---------- material clicked: every invoice for it, choose one ---------- */}
    {detail && <div onClick={() => setDetail(null)} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 50 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 12, padding: 20, width: "100%", maxWidth: 720, maxHeight: "88vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div>
            <b style={{ fontSize: 17, fontFamily: "monospace" }}>{detail.packmat_code || "no code"}</b>
            <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>
              {detail.sku_code || "—"} · {LBL[detail.packmat] || detail.packmat} · {(detail.sku_desc || desc(detail.sku_code) || "").slice(0, 44)}
            </div>
          </div>
          <button onClick={() => setDetail(null)} style={ghost}>Close</button>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", margin: "14px 0" }}>
          <div style={{ border: `1px solid ${C.line}`, borderRadius: 8, padding: "8px 14px" }}>
            <div style={{ fontSize: 11, color: C.muted }}>Total we have</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{Math.round(detail.qty)} {BASE_UNIT[detail.packmat]}</div>
          </div>
          <div style={{ border: `1px solid ${C.line}`, borderRadius: 8, padding: "8px 14px" }}>
            <div style={{ fontSize: 11, color: C.muted }}>Invoices holding it</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{detail.invoices.length}</div>
          </div>
        </div>

        <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, marginBottom: 6 }}>CHOOSE AN INVOICE</div>
        <div style={{ maxHeight: "38vh", overflowY: "auto", marginBottom: 14 }}>
          {detail.invoices.map((iv, n) => {
            const on = chosenInv && chosenInv.id === iv.id;
            return (<button key={iv.id} onClick={() => setChosenInv(iv)} style={{
              display: "block", width: "100%", textAlign: "left", font: "inherit", cursor: "pointer",
              background: on ? "#f0fdf4" : "#fff", border: `1px solid ${on ? C.green : C.line}`,
              borderLeft: `5px solid ${n === 0 ? C.green : C.line}`, borderRadius: 10, padding: 12, marginBottom: 8,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <b>{iv.invoice || "no invoice number"}</b>
                <span style={{ fontSize: 12, color: n === 0 ? C.green : C.muted, fontWeight: 700 }}>
                  {n === 0 ? "OLDEST — pick from this first" : `${n + 1} in line`}
                </span>
              </div>
              <div style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>
                Received {String(iv.received_at || "").slice(0, 10)} · <b style={{ color: C.ink }}>{Math.round(iv.qty)} {BASE_UNIT[detail.packmat]}</b> left
              </div>
            </button>);
          })}
        </div>

        {chosenInv && <div style={{ border: `1px solid ${C.green}`, background: "#f0fdf4", borderRadius: 10, padding: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, marginBottom: 8 }}>SELECTED INVOICE</div>
          <div style={{ display: "flex", gap: 26, flexWrap: "wrap", fontSize: 14 }}>
            <span><b>Invoice</b><br />{chosenInv.invoice || "—"}</span>
            <span><b>Material code</b><br /><code>{detail.packmat_code || "—"}</code></span>
            <span><b>SKU</b><br />{detail.sku_code || "—"}</span>
            <span><b>Packmat</b><br />{LBL[detail.packmat] || detail.packmat}</span>
            <span><b>Qty left</b><br />{Math.round(chosenInv.qty)} {BASE_UNIT[detail.packmat]}</span>
            <span><b>Received</b><br />{String(chosenInv.received_at || "").slice(0, 10)}</span>
            <span style={{ color: C.green }}><b>📍 Location</b><br /><b style={{ fontSize: 17 }}>{chosenInv.location || "—"}</b></span>
          </div>
        </div>}
      </div>
    </div>}

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
