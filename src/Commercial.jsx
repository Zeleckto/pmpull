// Commercial. ONE row of cards along the top; clicking one opens that thing underneath
// and nothing else. No second tab row, no nested drill-downs — the cards are the navigation.
//   ILT & trucks      sign-off, expand a truck for its load and the GR behind it
//   Goods received    the GR/SAP register: GRN no, GRN date, SAP ticks, export
//   Quality pending   what Kasani is holding, urgent first, with sample status
//   Blocked/rejected  material held at either site, with quantities
//   Returned          what the lines sent back, and against what they were issued
//   Analytics         loss, shortfall, logistics
import React, { useEffect, useMemo, useState } from "react";
import {
  loadConsignments, loadProduction, loadDispatches, setDispatch,
  updateConsignment, kasaniOnHand, loadSkusK, loadConversionK, remainingOf,
} from "./dataKasani";
import { loadLedger, loadAllRequests } from "./data";
import { loadKasaniRequestsAll, loadPhasing, replacePhasing, replaceProduction } from "./dataKasani";
import Analytics from "./Analytics";
import { LBL, BASE_UNIT, grStatus, istToday, nextShifts, isoWeekStart, parseWeekHeader, C, btn, ghost, card, inp, th, td, readSheet, exportXlsx, norm } from "./shared";

export default function Commercial() {
  const [view, setView] = useState("ilt");
  const [skus, setSkus] = useState([]); const [conv, setConv] = useState({});
  const [ledger, setLedger] = useState([]); const [prod, setProd] = useState([]);
  const [cons, setCons] = useState([]); const [disp, setDisp] = useState([]);
  const [open, setOpen] = useState({});        // truck id -> expanded
  const [edit, setEdit] = useState({});        // consignment id -> {grn_no, grn_date}
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState("");
  const [kreqs, setKreqs] = useState([]);
  const [days, setDays] = useState(7);
  const [phasing, setPhasing] = useState([]);
  const [allReqs, setAllReqs] = useState([]);
  const [uploadMsg, setUploadMsg] = useState("");

  const refresh = async () => {
    setSkus(await loadSkusK()); setConv(await loadConversionK());
    setLedger(await loadLedger()); setProd(await loadProduction());
    setCons(await loadConsignments()); setDisp(await loadDispatches());
    setKreqs(await loadKasaniRequestsAll());
    setPhasing(await loadPhasing());
    setAllReqs(await loadAllRequests());
  };
  useEffect(() => { refresh(); }, []);

  const today = new Date().toISOString().slice(0, 10);
  const issuedToday = {};
  ledger.forEach((e) => {
    if (e.direction === "issue" && String(e.ts).slice(0, 10) === today) {
      const k = `${e.sku_code}|${e.packmat}`; issuedToday[k] = (issuedToday[k] || 0) + Number(e.qty_base);
    }
  });

  // ---------- ILT ----------
  // The GR rows behind a truck: same SKU+packmat, cleared, oldest first — that is the
  // stock the truck was picked from, and the paperwork SAP needs.
  const grBehind = (lines) => {
    const keys = new Set((lines || []).map((l) => `${l.sku_code}|${l.packmat}`));
    return cons
      .filter((c) => keys.has(`${c.sku_code}|${c.packmat}`) && c.status === "cleared")
      .sort((a, b) => String(a.received_at || a.ts).localeCompare(String(b.received_at || b.ts)));
  };
  const signOff = async (d) => {
    await setDispatch(d.id, { ilt_done: true, ilt_sent_at: new Date().toISOString(), status: "dispatched" });
    setMsg(`Truck #${d.truck_no} signed off.`); refresh();
  };

  // ---------- GR register ----------
  const saveGrn = async (c) => {
    const e = edit[c.id] || {};
    const { error } = await updateConsignment(c.id, {
      grn_no: e.grn_no !== undefined ? e.grn_no || null : c.grn_no,
      grn_date: e.grn_date !== undefined ? e.grn_date || null : c.grn_date,
    });
    setMsg(error ? `Error: ${error.message || error}` : `GRN saved for receipt #${c.id}.`);
    if (!error) { const n = { ...edit }; delete n[c.id]; setEdit(n); refresh(); }
  };
  const toggleSap = async (c) => {
    await updateConsignment(c.id, { sap_entered: !c.sap_entered, sap_entered_at: c.sap_entered ? null : new Date().toISOString() });
    refresh();
  };
  const exportGr = () => {
    const rows = cons.map((c) => ({
      received: String(c.received_at || c.ts || "").slice(0, 19).replace("T", " "),
      invoice: c.invoice, invoice_date: c.invoice_date, po_no: c.po_no,
      grn_no: c.grn_no, grn_date: c.grn_date, supplier: c.supplier,
      sku: c.sku_code, description: c.sku_desc || (skus.find((s) => s.code === c.sku_code) || {}).description,
      packmat: c.packmat, material_code: c.packmat_code,
      qty_received: c.qty_base, qty_remaining: remainingOf(c), unit: BASE_UNIT[c.packmat],
      location: c.location, transferred_to: c.transferred_to, barcode_ref: c.barcode_ref,
      status: grStatus(c).label, sap_entered: c.sap_entered ? "yes" : "no",
    }));
    exportXlsx(`kasani_gr_${today}.xlsx`, rows.length ? rows : [{ note: "no receipts" }]);
  };

  // ---------- analytics uploads ----------
  // DPR — the daily production report, one per shift. `line` is optional; when the sheet
  // carries it, packmat loss is worked out per line. Re-uploading a date+shift replaces it.
  const uploadProduction = (file, planDate, shift) => readSheet(file, async (aoa) => {
    let hr = aoa.findIndex((r) => (r || []).some((x) => /sku|cbu|code/i.test(String(x))));
    if (hr < 0) hr = 0;
    const H = (aoa[hr] || []).map(norm);
    const iId = H.findIndex((h) => /sku|cbu|code/.test(h));
    const iT = H.findIndex((h) => /tonne|ton|fg|qty|produced|output|total/.test(h));
    const iLn = H.findIndex((h) => /line|machine/.test(h));
    const rows = [];
    for (let r = hr + 1; r < aoa.length; r++) {
      const row = aoa[r] || [];
      const code = String(row[iId] || "").trim();
      const t = Number(String(row[iT] || "").replace(/[^0-9.]/g, "")) || 0;
      if (!code || !t) continue;
      rows.push({
        plan_date: planDate, shift, sku_code: code, tonnes: t,
        line: iLn >= 0 ? String(row[iLn] || "").trim().toUpperCase() || null : null,
      });
    }
    if (!rows.length) { setUploadMsg("No rows found — the DPR needs a SKU code and tonnes column."); return; }
    const { error } = await replaceProduction(planDate, shift, rows);
    const withLine = rows.filter((r) => r.line).length;
    setUploadMsg(error ? `Error: ${error.message || error}`
      : `DPR loaded: ${rows.length} SKU(s) for ${planDate} shift ${shift}${withLine ? `, ${withLine} tagged to a line` : " (no line column — loss will be shown per SKU, not per line)"}.`);
    if (!error) refresh();
  });

  // Phasing. Daily = SKU + tonnes + shift, for one date. Weekly = SKU + tonnes, no shift.
  // The 19-week plan, in the planners' own wide layout:
  //   CBU Code | Description | 37.2026 | 38.2026 | ...
  // Every week column becomes one row, dated to the Monday of that ISO week.
  const uploadPlan = (file, unit) => readSheet(file, async (aoa) => {
    let hr = aoa.findIndex((r) => (r || []).some((x) => /cbu|sku/i.test(String(x))));
    if (hr < 0) hr = 0;
    const head = aoa[hr] || [];
    const iId = head.findIndex((h) => /cbu|sku/i.test(String(h)));
    // any column whose heading reads like a week number
    const weeks = [];
    head.forEach((h, i) => {
      const w = parseWeekHeader(h);
      if (w) weeks.push({ i, ...w, label: String(h).trim(), date: isoWeekStart(w.year, w.week).toISOString().slice(0, 10) });
    });
    if (!weeks.length) { setUploadMsg("No week columns recognised — headings should read like 37.2026 or 2026-W37."); return; }

    const div = unit === "kg" ? 1000 : 1;      // sheet is in kg unless told otherwise
    const rows = [];
    for (let r = hr + 1; r < aoa.length; r++) {
      const row = aoa[r] || [];
      const code = String(row[iId] || "").trim();
      if (!code) continue;
      weeks.forEach((w) => {
        const v = Number(String(row[w.i] == null ? "" : row[w.i]).replace(/[^0-9.\-]/g, "")) || 0;
        if (v <= 0) return;                    // a zero week is simply no demand
        rows.push({ plan_date: w.date, week_label: w.label, sku_code: code, tonnes: v / div, horizon: "plan", shift: null });
      });
    }
    if (!rows.length) { setUploadMsg("Week columns found, but every cell was blank or zero."); return; }
    const { error } = await replacePhasing(rows.map((r) => r.plan_date), rows, "plan");
    const totT = rows.reduce((a, r) => a + r.tonnes, 0);
    const skuN = new Set(rows.map((r) => r.sku_code)).size;
    setUploadMsg(error ? `Error: ${error.message || error}`
      : `Plan loaded: ${skuN} SKU(s) x ${weeks.length} week(s) (${weeks[0].label} to ${weeks[weeks.length - 1].label}) = ${Math.round(totT).toLocaleString()} t total. If that total looks wrong by 1000x, switch the unit and re-upload.`);
    if (!error) refresh();
  });

  const uploadPhasing = (file, planDate, horizon) => readSheet(file, async (aoa) => {
    let hr = aoa.findIndex((r) => (r || []).some((x) => /sku|cbu|code/i.test(String(x))));
    if (hr < 0) hr = 0;
    const H = (aoa[hr] || []).map(norm);
    const iId = H.findIndex((h) => /sku|cbu|code/.test(h));
    const iT = H.findIndex((h) => /demand|tonne|ton|qty|plan|total/.test(h));
    const iSh = H.findIndex((h) => /shift|needed/.test(h));
    const rows = [];
    let noShift = 0;
    for (let r = hr + 1; r < aoa.length; r++) {
      const row = aoa[r] || [];
      const code = String(row[iId] || "").trim();
      const t = Number(String(row[iT] || "").replace(/[^0-9.]/g, "")) || 0;
      if (!code || !t) continue;
      let shift = null;
      if (horizon === "day") {
        shift = (String(iSh >= 0 ? row[iSh] : "").trim().toUpperCase().match(/[ABC]/) || [null])[0];
        if (!shift) noShift++;
      }
      rows.push({ plan_date: planDate, shift, sku_code: code, tonnes: t, horizon });
    }
    if (!rows.length) { setUploadMsg("No rows found — expected SKU code and demand in tonnes."); return; }
    const { error } = await replacePhasing([planDate], rows, horizon);
    setUploadMsg(error ? `Error: ${error.message || error}`
      : `${horizon === "day" ? "Daily" : "Weekly"} plan loaded: ${rows.length} SKU(s) for ${planDate}${noShift ? `. ${noShift} row(s) had no A/B/C shift — counted in the day total only.` : "."}`);
    if (!error) refresh();
  });

  // ---------- what sits behind each headline number ----------
  const want3 = nextShifts(3);
  const needSoon = useMemo(() => {
    const set = new Set();
    phasing.forEach((p) => { if (want3.some((w) => w.date === p.plan_date && w.shift === p.shift)) set.add(p.sku_code); });
    kreqs.forEach((r) => { if (r.status === "open") set.add(r.sku_code); });
    return set;
  }, [phasing, kreqs]);

  const qualityPending = useMemo(() => cons
    .filter((c) => c.status === "pending")
    .map((c) => ({ ...c, urgent: needSoon.has(c.sku_code), waited: (Date.now() - new Date(c.received_at || c.ts)) / 3600000 }))
    .sort((a, b) => (b.urgent - a.urgent) || b.waited - a.waited), [cons, needSoon]);

  // Blocked material, wherever it is sitting: the PM store's ledger balance
  // (block − released − scrapped) plus anything Kasani has rejected.
  const blockedAll = useMemo(() => {
    const m = {};
    ledger.forEach((e) => {
      const k = `${e.sku_code}|${e.packmat}`; const q = Number(e.qty_base) || 0;
      if (e.direction === "block") m[k] = (m[k] || 0) + q;
      else if (e.direction === "unblock" || e.direction === "scrap") m[k] = (m[k] || 0) - q;
    });
    const pm = Object.entries(m).filter(([, v]) => v > 0.5).map(([k, v]) => {
      const [sku_code, packmat] = k.split("|");
      return { where: "PM store", sku_code, packmat, qty: v, reason: "held at store" };
    });
    const ks = cons.filter((c) => c.status === "rejected").map((c) => ({
      where: "Kasani", sku_code: c.sku_code, packmat: c.packmat, qty: Number(c.qty_base) || 0,
      reason: c.reject_reason || "no reason given", invoice: c.invoice,
    }));
    return [...pm, ...ks].sort((a, b) => b.qty - a.qty);
  }, [ledger, cons]);
  const blockedQty = blockedAll.reduce((a, r) => a + r.qty, 0);

  // What the lines sent back, and what they were issued, so the rate means something.
  const returns = useMemo(() => {
    const m = {};
    ledger.forEach((e) => {
      const ln = String(e.line || "").trim().toUpperCase();
      if (!ln || !["issue", "return"].includes(e.direction)) return;
      const k = `${ln}|${e.sku_code}|${e.packmat}`;
      if (!m[k]) m[k] = { line: ln, sku_code: e.sku_code, packmat: e.packmat, issued: 0, returned: 0, last: null };
      const q = Math.abs(Number(e.qty_base) || 0);
      if (e.direction === "issue") m[k].issued += q;
      else { m[k].returned += q; if (!m[k].last || e.ts > m[k].last) m[k].last = e.ts; }
    });
    return Object.values(m).filter((r) => r.returned > 0)
      .map((r) => ({ ...r, rate: r.issued ? (r.returned / r.issued) * 100 : 100 }))
      .sort((a, b) => b.returned - a.returned);
  }, [ledger]);
  const returnedQty = returns.reduce((a, r) => a + r.returned, 0);

  const iltTrucks = disp.filter((d) => d.dispatched_at && !d.ilt_done);
  const sapRows = cons.filter((c) => !c.sap_entered);

  const exportDay = () => {
    const rows = ledger.filter((e) => String(e.ts).slice(0, 10) === today)
      .map((e) => ({ time: e.ts, sku: e.sku_code, packmat: e.packmat, action: e.direction, qty: e.qty_base, line: e.line, shift: e.shift }));
    exportXlsx(`pmstore_${today}.xlsx`, rows.length ? rows : [{ note: "no movements today" }]);
  };

  const NavCard = ({ id, label, val, sub, color }) => (
    <button onClick={() => setView(id)} style={{
      ...card, marginBottom: 0, minWidth: 150, flex: "1 1 150px", textAlign: "left", cursor: "pointer", font: "inherit",
      border: `1px solid ${view === id ? C.slate : C.line}`,
      borderTop: `3px solid ${view === id ? C.slate : "transparent"}`,
      background: view === id ? "#fff" : "#fbfcfe",
      boxShadow: view === id ? "0 2px 10px rgba(15,23,42,.10)" : "none",
    }}>
      <div style={{ fontSize: 12, color: C.muted }}>{label}</div>
      <div style={{ fontSize: 23, fontWeight: 700, color: color || C.ink }}>{val}</div>
      <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{sub}</div>
    </button>);

  const grRows = cons.filter((c) => !q || `${c.invoice} ${c.grn_no} ${c.po_no} ${c.sku_code} ${c.packmat_code} ${c.supplier}`.toLowerCase().includes(q.toLowerCase()));

  return (<div style={{ maxWidth: 1100, margin: "0 auto", padding: 20, fontFamily: "system-ui,Arial", color: C.ink }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
      <h2 style={{ color: C.slate, margin: 0 }}>Commercial</h2>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={exportGr} style={ghost}>Export GR register</button>
        <button onClick={exportDay} style={btn(C.slate)}>Export today (Excel)</button>
      </div>
    </div>

    {/* ---------------- the only navigation ---------------- */}
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", margin: "16px 0" }}>
      <NavCard id="ilt" label="ILT &amp; trucks" val={iltTrucks.length}
        sub={iltTrucks.length ? "awaiting sign-off" : "all signed off"} color={iltTrucks.length ? C.red : C.green} />
      <NavCard id="gr" label="Goods received" val={cons.length}
        sub={sapRows.length ? `${sapRows.length} not in SAP` : "all in SAP"} color={sapRows.length ? C.amber : C.green} />
      <NavCard id="qp" label="Quality pending" val={qualityPending.length}
        sub={qualityPending.filter((c) => c.urgent).length ? `${qualityPending.filter((c) => c.urgent).length} needed in next 3 shifts` : "at Kasani"}
        color={qualityPending.some((c) => c.urgent) ? C.red : qualityPending.length ? C.amber : C.green} />
      <NavCard id="blk" label="Blocked / rejected" val={Math.round(blockedQty).toLocaleString()}
        sub={`units · ${blockedAll.length} line(s)`} color={blockedQty ? C.red : C.green} />
      <NavCard id="ret" label="Returned from lines" val={Math.round(returnedQty).toLocaleString()}
        sub={`units · ${returns.length} line/SKU`} color={returnedQty ? C.amber : C.green} />
      <NavCard id="an" label="Analytics" val="›" sub="loss, shortfall, logistics" color={C.slate} />
    </div>
    {msg && <div style={{ fontSize: 13, marginBottom: 12, padding: "8px 10px", borderRadius: 8, background: /error/i.test(msg) ? "#fef2f2" : "#f0fdf4", color: /error/i.test(msg) ? C.red : C.green }}>{msg}</div>}

    {/* ---------------- ILT & trucks ---------------- */}
    {view === "ilt" && <div style={card}>
      <b>Trucks from Kasani ({disp.length})</b>
      <div style={{ fontSize: 13, color: C.muted, margin: "4px 0 12px" }}>
        Expand a truck to see its load and the goods-received paperwork behind it.
      </div>
      {disp.length === 0 ? <div style={{ color: C.muted, padding: 8 }}>No trucks yet.</div> :
        disp.map((d) => {
          const gr = open[d.id] ? grBehind(d.lines) : [];
          return (<div key={d.id} style={{ border: `1px solid ${C.line}`, borderLeft: `5px solid ${d.ilt_done ? C.green : d.challan ? C.amber : C.line}`, borderRadius: 10, padding: 12, marginBottom: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div>
                <b>Truck #{d.truck_no}</b>
                <span style={{ color: C.muted, fontSize: 13, marginLeft: 8 }}>
                  {d.plan_date} · shift {d.shift || "—"} · {(d.lines || []).length} line(s) · {d.fill_pct}% full
                </span>
                <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
                  {d.challan
                    ? <>challan <code>{d.challan}</code> · dispatched {String(d.dispatched_at || "").slice(0, 16).replace("T", " ")}</>
                    : <span style={{ color: C.amber }}>not sent yet — Kasani still has to raise the challan</span>}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: d.ilt_done ? C.green : C.amber }}>{d.ilt_done ? "ILT done" : "ILT pending"}</span>
                <button onClick={() => setOpen({ ...open, [d.id]: !open[d.id] })} style={{ ...ghost, padding: "5px 10px" }}>{open[d.id] ? "Hide" : "Expand"}</button>
                {!d.ilt_done && d.challan && <button onClick={() => signOff(d)} style={{ ...btn(C.green), padding: "5px 10px" }}>Mark ILT done</button>}
              </div>
            </div>

            {open[d.id] && <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, marginBottom: 4 }}>TRUCK LOAD</div>
              <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 14 }}>
                <thead><tr><th style={th}>SKU</th><th style={th}>Description</th><th style={th}>Packmat</th><th style={th}>Material code</th><th style={th}>Qty</th><th style={th}>Shift</th></tr></thead>
                <tbody>{(d.lines || []).map((l, i2) => (<tr key={i2}>
                  <td style={{ ...td, fontWeight: 600 }}>{l.sku_code}</td>
                  <td style={{ ...td, color: C.muted, fontSize: 13 }}>{(l.sku_desc || (skus.find((x) => x.code === l.sku_code) || {}).description || "").slice(0, 26)}</td>
                  <td style={td}>{LBL[l.packmat] || l.packmat}</td>
                  <td style={{ ...td, fontFamily: "monospace", fontSize: 12 }}>{l.packmat_code || "—"}</td>
                  <td style={td}>{Math.round(l.qty_base)} {BASE_UNIT[l.packmat]}</td>
                  <td style={td}>{l.shift}</td>
                </tr>))}</tbody>
              </table>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, marginBottom: 4 }}>GOODS RECEIVED BEHIND THIS LOAD — for SAP</div>
              {gr.length === 0 ? <div style={{ fontSize: 13, color: C.muted, padding: 6 }}>No matching cleared receipts found.</div> :
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 820 }}>
                    <thead><tr>
                      <th style={th}>Received</th><th style={th}>Invoice</th><th style={th}>Inv date</th><th style={th}>PO</th>
                      <th style={th}>GRN</th><th style={th}>Supplier</th><th style={th}>Code</th><th style={th}>Qty</th><th style={th}>Location</th><th style={th}>SAP</th>
                    </tr></thead>
                    <tbody>{gr.map((c) => (<tr key={c.id}>
                      <td style={{ ...td, fontSize: 12 }}>{String(c.received_at || c.ts || "").slice(0, 10)}</td>
                      <td style={td}>{c.invoice || "—"}</td>
                      <td style={{ ...td, fontSize: 12 }}>{c.invoice_date || "—"}</td>
                      <td style={{ ...td, fontSize: 12 }}>{c.po_no || "—"}</td>
                      <td style={{ ...td, fontSize: 12, color: c.grn_no ? C.ink : C.amber }}>{c.grn_no || "not set"}</td>
                      <td style={{ ...td, fontSize: 12 }}>{c.supplier || "—"}</td>
                      <td style={{ ...td, fontFamily: "monospace", fontSize: 12 }}>{c.packmat_code || "—"}</td>
                      <td style={td}>{Math.round(c.qty_base)}</td>
                      <td style={{ ...td, fontSize: 12 }}>{c.location || "—"}</td>
                      <td style={td}><input type="checkbox" checked={!!c.sap_entered} onChange={() => toggleSap(c)} /></td>
                    </tr>))}</tbody>
                  </table>
                </div>}
            </div>}
          </div>);
        })}
    </div>}

    {/* ---------------- GR register ---------------- */}
    {view === "gr" && <div style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <b>Goods received register ({grRows.length})</b>
        <input placeholder="search invoice / GRN / PO / SKU / code / supplier" value={q} onChange={(e) => setQ(e.target.value)} style={{ ...inp, width: 340 }} />
      </div>
      <div style={{ fontSize: 13, color: C.muted, marginBottom: 10 }}>
        The warehouse leaves GRN blank. Fill it here, tick <b>SAP</b> once it is keyed in, and export the register for the whole day.
      </div>
      <div style={{ maxHeight: 560, overflowY: "auto", overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
          <thead><tr>
            <th style={th}>Received</th><th style={th}>Invoice</th><th style={th}>PO</th><th style={th}>Supplier</th>
            <th style={th}>SKU</th><th style={th}>Code</th><th style={th}>Qty</th><th style={th}>Status</th>
            <th style={th}>GRN No.</th><th style={th}>GRN date</th><th style={th}>SAP</th><th style={th}></th>
          </tr></thead>
          <tbody>{grRows.length === 0 ? <tr><td style={td} colSpan={12}>No receipts.</td></tr> :
            grRows.map((c) => {
              const e = edit[c.id] || {};
              const dirty = e.grn_no !== undefined || e.grn_date !== undefined;
              const st = grStatus(c);
              return (<tr key={c.id} style={{ background: dirty ? "#fffbeb" : "transparent" }}>
                <td style={{ ...td, fontSize: 12 }}>{String(c.received_at || c.ts || "").slice(0, 10)}</td>
                <td style={td}>{c.invoice || "—"}</td>
                <td style={{ ...td, fontSize: 12 }}>{c.po_no || "—"}</td>
                <td style={{ ...td, fontSize: 12 }}>{c.supplier || "—"}</td>
                <td style={{ ...td, fontWeight: 600 }}>{c.sku_code || "—"}</td>
                <td style={{ ...td, fontFamily: "monospace", fontSize: 12 }}>{c.packmat_code || "—"}</td>
                <td style={td}>{Math.round(c.qty_base)} {BASE_UNIT[c.packmat] || ""}</td>
                <td style={td}><span style={{ background: st.color, color: "#fff", borderRadius: 10, padding: "1px 8px", fontSize: 11, fontWeight: 700 }}>{st.label}</span></td>
                <td style={td}><input value={e.grn_no !== undefined ? e.grn_no : (c.grn_no || "")} placeholder="—"
                  onChange={(ev) => setEdit({ ...edit, [c.id]: { ...e, grn_no: ev.target.value } })} style={{ ...inp, width: 110 }} /></td>
                <td style={td}><input type="date" value={e.grn_date !== undefined ? e.grn_date : (c.grn_date || "")}
                  onChange={(ev) => setEdit({ ...edit, [c.id]: { ...e, grn_date: ev.target.value } })} style={{ ...inp, width: 140 }} /></td>
                <td style={td}><input type="checkbox" checked={!!c.sap_entered} onChange={() => toggleSap(c)} /></td>
                <td style={td}>{dirty && <button onClick={() => saveGrn(c)} style={{ ...btn(C.slate), padding: "4px 10px", fontSize: 13 }}>Save</button>}</td>
              </tr>);
            })}</tbody>
        </table>
      </div>
    </div>}

    {/* ---------------- Quality pending ---------------- */}
    {view === "qp" && <div style={card}>
      <b>Quality pending at Kasani ({qualityPending.length})</b>
      <div style={{ fontSize: 13, color: C.muted, margin: "4px 0 10px" }}>
        <b>Needed soon</b> = the SKU is in the phasing for {want3.map((w) => `${w.date} ${w.shift}`).join(", ")}, or the store has an open request for it. Sample those first.
      </div>
      {qualityPending.length === 0 ? <div style={{ color: C.muted, padding: 8 }}>Nothing awaiting quality.</div> :
        <div style={{ maxHeight: 520, overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th style={th}>Priority</th><th style={th}>SKU</th><th style={th}>Packmat</th><th style={th}>Code</th><th style={th}>Qty</th><th style={th}>Invoice</th><th style={th}>Waiting</th><th style={th}>Sample</th></tr></thead>
            <tbody>{qualityPending.map((c) => (<tr key={c.id} style={{ background: c.urgent ? "#fff7ed" : "transparent" }}>
              <td style={td}>{c.urgent
                ? <span style={{ background: C.red, color: "#fff", borderRadius: 10, padding: "1px 8px", fontSize: 11, fontWeight: 700 }}>NEEDED SOON</span>
                : <span style={{ fontSize: 12, color: C.muted }}>routine</span>}</td>
              <td style={{ ...td, fontWeight: 600 }}>{c.sku_code || "—"}</td>
              <td style={td}>{LBL[c.packmat] || c.packmat}</td>
              <td style={{ ...td, fontFamily: "monospace", fontSize: 12 }}>{c.packmat_code || "—"}</td>
              <td style={td}>{Math.round(c.qty_base)} {BASE_UNIT[c.packmat]}</td>
              <td style={td}>{c.invoice || "—"}</td>
              <td style={{ ...td, fontWeight: 600, color: c.waited > 48 ? C.red : c.waited > 24 ? C.amber : C.ink }}>
                {c.waited < 24 ? `${c.waited.toFixed(1)} h` : `${(c.waited / 24).toFixed(1)} d`}</td>
              <td style={td}>{c.sample_sent
                ? <span style={{ color: C.amber, fontWeight: 700, fontSize: 13 }}>sent</span>
                : <span style={{ color: C.red, fontWeight: 700, fontSize: 13 }}>NOT sent</span>}</td>
            </tr>))}</tbody>
          </table>
        </div>}
    </div>}

    {/* ---------------- Blocked / rejected ---------------- */}
    {view === "blk" && <div style={card}>
      <b>Blocked / rejected material</b>
      <div style={{ fontSize: 13, color: C.muted, margin: "4px 0 10px" }}>
        Held at the PM store (blocked − released − scrapped) or rejected at Kasani. Quantities, not SKU counts.
      </div>
      {blockedAll.length === 0 ? <div style={{ color: C.muted, padding: 8 }}>Nothing blocked at either site.</div> :
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th style={th}>Where</th><th style={th}>SKU</th><th style={th}>Description</th><th style={th}>Packmat</th><th style={th}>Qty held</th><th style={th}>Invoice</th><th style={th}>Reason</th></tr></thead>
          <tbody>{blockedAll.map((r, i2) => (<tr key={i2}>
            <td style={td}><span style={{ background: r.where === "Kasani" ? "#7f1d1d" : C.red, color: "#fff", borderRadius: 10, padding: "1px 8px", fontSize: 11, fontWeight: 700 }}>{r.where}</span></td>
            <td style={{ ...td, fontWeight: 600 }}>{r.sku_code || "—"}</td>
            <td style={{ ...td, color: C.muted, fontSize: 13 }}>{((skus.find((x) => x.code === r.sku_code) || {}).description || "").slice(0, 24)}</td>
            <td style={td}>{LBL[r.packmat] || r.packmat}</td>
            <td style={{ ...td, fontWeight: 700, color: C.red }}>{Math.round(r.qty).toLocaleString()} {BASE_UNIT[r.packmat]}</td>
            <td style={td}>{r.invoice || "—"}</td>
            <td style={{ ...td, fontSize: 13, color: C.muted }}>{r.reason}</td>
          </tr>))}</tbody>
        </table>}
    </div>}

    {/* ---------------- Returned from lines ---------------- */}
    {view === "ret" && <div style={card}>
      <b>Returned from lines ({returns.length})</b>
      <div style={{ fontSize: 13, color: C.muted, margin: "4px 0 10px" }}>
        What came back, against what that line was issued of the same material. A high rate means over-drawing or a problem at the machine.
      </div>
      {returns.length === 0 ? <div style={{ color: C.muted, padding: 8 }}>Nothing returned. Returns only appear here when the line is recorded on the return.</div> :
        <div style={{ maxHeight: 520, overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th style={th}>Line</th><th style={th}>SKU</th><th style={th}>Description</th><th style={th}>Packmat</th><th style={th}>Issued</th><th style={th}>Returned</th><th style={th}>Rate</th><th style={th}>Last return</th></tr></thead>
            <tbody>{returns.map((r, i2) => (<tr key={i2}>
              <td style={{ ...td, fontWeight: 700 }}>{r.line}</td>
              <td style={{ ...td, fontWeight: 600 }}>{r.sku_code}</td>
              <td style={{ ...td, color: C.muted, fontSize: 13 }}>{((skus.find((x) => x.code === r.sku_code) || {}).description || "").slice(0, 22)}</td>
              <td style={td}>{LBL[r.packmat] || r.packmat}</td>
              <td style={td}>{Math.round(r.issued).toLocaleString()}</td>
              <td style={{ ...td, fontWeight: 600, color: C.amber }}>{Math.round(r.returned).toLocaleString()} {BASE_UNIT[r.packmat]}</td>
              <td style={{ ...td, fontWeight: 700, color: r.rate > 15 ? C.red : r.rate > 5 ? C.amber : C.green }}>{r.rate.toFixed(1)}%</td>
              <td style={{ ...td, fontSize: 12, color: C.muted }}>{String(r.last || "").slice(0, 16).replace("T", " ")}</td>
            </tr>))}</tbody>
          </table>
        </div>}
    </div>}

    {/* asked vs given lives with returns: both are about issue accuracy */}
    {view === "ret" && (() => {
      const done = allReqs.filter((r) => r.qty_issued != null);
      const short = done.filter((r) => Number(r.qty_issued) < Number(r.qty_base));
      const over = done.filter((r) => Number(r.qty_issued) > Number(r.qty_base));
      return (<div style={card}>
        <b>Asked vs given ({done.length})</b>
        <div style={{ fontSize: 13, color: C.muted, margin: "4px 0 10px" }}>
          What the line called for against what the store actually issued.
          {done.length ? ` ${short.length} short, ${over.length} over, ${done.length - short.length - over.length} exact.` : ""}
        </div>
        {done.length === 0 ? <div style={{ color: C.muted, padding: 8 }}>
          Nothing yet. This fills up as the store issues against requests using <b>Issue…</b> on the PM Requests tab.
        </div> :
          <div style={{ maxHeight: 420, overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr><th style={th}>Issued at</th><th style={th}>Line</th><th style={th}>SKU</th><th style={th}>Packmat</th><th style={th}>Asked</th><th style={th}>Given</th><th style={th}>Difference</th></tr></thead>
              <tbody>{done.slice(0, 200).map((r) => {
                const d = Number(r.qty_issued) - Number(r.qty_base);
                return (<tr key={r.id}>
                  <td style={{ ...td, fontSize: 12 }}>{String(r.issued_at || "").slice(0, 16).replace("T", " ")}</td>
                  <td style={{ ...td, fontWeight: 700 }}>{r.line || "—"}</td>
                  <td style={{ ...td, fontWeight: 600 }}>{r.sku_code}</td>
                  <td style={td}>{LBL[r.packmat] || r.packmat}</td>
                  <td style={td}>{Math.round(r.qty_base)}</td>
                  <td style={{ ...td, fontWeight: 600 }}>{Math.round(r.qty_issued)} {BASE_UNIT[r.packmat]}</td>
                  <td style={{ ...td, fontWeight: 700, color: d === 0 ? C.green : d < 0 ? C.amber : C.blue }}>
                    {d === 0 ? "exact" : d > 0 ? `+${Math.round(d)}` : Math.round(d)}</td>
                </tr>);
              })}</tbody>
            </table>
          </div>}
      </div>);
    })()}

    {/* ---------------- Analytics ---------------- */}
    {view === "an" && <Analytics ledger={ledger} cons={cons} disp={disp} reqs={kreqs} skus={skus} conv={conv}
      production={prod} phasing={phasing} days={days} setDays={setDays}
      onUploadProduction={uploadProduction} onUploadPhasing={uploadPhasing} onUploadPlan={uploadPlan} uploadMsg={uploadMsg} />}
  </div>);
}
