// Commercial (was "Leadership"). Two jobs beyond the analytics:
//   1. ILT sign-off on trucks Kasani has dispatched — expand a truck to see every line
//      AND the goods-received rows behind them, which is what gets keyed into SAP.
//   2. The GR register: fill in GRN No. / GRN date, tick off SAP entry, export to Excel.
import React, { useEffect, useState } from "react";
import {
  loadConsignments, loadProduction, addProduction, loadDispatches, setDispatch,
  updateConsignment, kasaniOnHand, loadSkusK, loadConversionK, remainingOf,
} from "./dataKasani";
import { loadLedger } from "./data";
import { loadKasaniRequestsAll } from "./dataKasani";
import Analytics from "./Analytics";
import { LBL, BASE_UNIT, compsOf, fgEquiv, theo, grStatus, C, btn, ghost, card, inp, th, td, readSheet, exportXlsx, norm } from "./shared";

export default function Commercial() {
  const [tab, setTab] = useState("ilt");
  const [skus, setSkus] = useState([]); const [conv, setConv] = useState({});
  const [ledger, setLedger] = useState([]); const [prod, setProd] = useState([]);
  const [cons, setCons] = useState([]); const [disp, setDisp] = useState([]);
  const [loss, setLoss] = useState(null);
  const [open, setOpen] = useState({});        // truck id -> expanded
  const [edit, setEdit] = useState({});        // consignment id -> {grn_no, grn_date}
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState("");
  const [kreqs, setKreqs] = useState([]);
  const [days, setDays] = useState(7);

  const refresh = async () => {
    setSkus(await loadSkusK()); setConv(await loadConversionK());
    setLedger(await loadLedger()); setProd(await loadProduction());
    setCons(await loadConsignments()); setDisp(await loadDispatches());
    setKreqs(await loadKasaniRequestsAll());
  };
  useEffect(() => { refresh(); }, []);

  const today = new Date().toISOString().slice(0, 10);
  const issuedToday = {};
  ledger.forEach((e) => {
    if (e.direction === "issue" && String(e.ts).slice(0, 10) === today) {
      const k = `${e.sku_code}|${e.packmat}`; issuedToday[k] = (issuedToday[k] || 0) + Number(e.qty_base);
    }
  });

  // ---------- loss ----------
  const runLoss = (file) => readSheet(file, async (aoa) => {
    const H = (aoa[0] || []).map(norm);
    const iId = H.findIndex((h) => /sku|cbu|code/.test(h));
    const iT = H.findIndex((h) => /tonne|ton|fg|qty|produced|total/.test(h));
    const prows = [];
    for (let r = 1; r < aoa.length; r++) {
      const row = aoa[r] || []; const code = String(row[iId] || "").trim();
      const t = Number(String(row[iT] || "").replace(/[^0-9.]/g, "")) || 0;
      if (code && t) prows.push({ plan_date: today, sku_code: code, tonnes: t });
    }
    if (prows.length) await addProduction(prows);
    computeLoss(prows); refresh();
  });
  function computeLoss(prows) {
    const cat = { carton: 0, cld: 0, sac: 0, laminate: 0 }; const detail = [];
    prows.forEach((p) => {
      const s = skus.find((x) => x.code === p.sku_code);
      if (!s) { detail.push({ code: p.sku_code, flag: "not in master" }); return; }
      compsOf(s).forEach((pm) => {
        if (pm === "divider") return;
        const th_ = theo(pm, s, p.tonnes, conv); const iss = issuedToday[`${p.sku_code}|${pm}`] || 0;
        const varB = iss - th_;
        if (cat[pm] != null) cat[pm] += fgEquiv(pm, varB, s, conv);
        detail.push({ code: p.sku_code, pm, t: p.tonnes, th: Math.round(th_), iss: Math.round(iss), varB: Math.round(varB) });
      });
    });
    setLoss({ cat, total: cat.carton + cat.cld + cat.sac + cat.laminate, detail });
  }

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

  const kOn = kasaniOnHand(cons);
  const grPending = cons.filter((c) => c.status === "pending").length;
  const iltPending = disp.filter((d) => !d.ilt_done).length;
  const sapPending = cons.filter((c) => !c.sap_entered).length;
  const exportDay = () => {
    const rows = ledger.filter((e) => String(e.ts).slice(0, 10) === today)
      .map((e) => ({ time: e.ts, sku: e.sku_code, packmat: e.packmat, action: e.direction, qty: e.qty_base, line: e.line, shift: e.shift }));
    exportXlsx(`pmstore_${today}.xlsx`, rows.length ? rows : [{ note: "no movements today" }]);
  };

  const Kpi = ({ label, val, color }) => (<div style={{ ...card, marginBottom: 0, minWidth: 150 }}>
    <div style={{ fontSize: 12, color: C.muted }}>{label}</div>
    <div style={{ fontSize: 24, fontWeight: 700, color: color || C.ink }}>{val}</div></div>);
  const Tab = ({ id, children }) => (<button onClick={() => setTab(id)} style={{
    padding: "9px 15px", borderRadius: 8, marginRight: 8, fontWeight: 600, cursor: "pointer",
    border: `1px solid ${C.line}`, background: tab === id ? C.slate : "#fff", color: tab === id ? "#fff" : "#334155",
  }}>{children}</button>);

  const grRows = cons.filter((c) => !q || `${c.invoice} ${c.grn_no} ${c.po_no} ${c.sku_code} ${c.packmat_code} ${c.supplier}`.toLowerCase().includes(q.toLowerCase()));

  return (<div style={{ maxWidth: 1100, margin: "0 auto", padding: 20, fontFamily: "system-ui,Arial", color: C.ink }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
      <h2 style={{ color: C.slate, margin: 0 }}>Commercial</h2>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={exportGr} style={ghost}>Export GR register</button>
        <button onClick={exportDay} style={btn(C.slate)}>Export today (Excel)</button>
      </div>
    </div>

    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", margin: "16px 0" }}>
      <Kpi label="ILT pending" val={iltPending} color={iltPending ? C.red : C.green} />
      <Kpi label="Not yet in SAP" val={sapPending} color={sapPending ? C.amber : C.green} />
      <Kpi label="GR quality pending" val={grPending} color={grPending ? C.amber : C.green} />
      <Kpi label="Kasani stock lines" val={Object.keys(kOn).length} />
      <Kpi label="SKUs" val={skus.length} />
    </div>

    <div style={{ marginBottom: 16 }}>
      <Tab id="ilt">ILT &amp; trucks</Tab><Tab id="gr">GR register (SAP)</Tab><Tab id="analytics">Analytics</Tab><Tab id="loss">Packmat loss</Tab>
    </div>
    {msg && <div style={{ fontSize: 13, marginBottom: 12, padding: "8px 10px", borderRadius: 8, background: /error/i.test(msg) ? "#fef2f2" : "#f0fdf4", color: /error/i.test(msg) ? C.red : C.green }}>{msg}</div>}

    {/* ---------------- ILT ---------------- */}
    {tab === "ilt" && <div style={card}>
      <b>Trucks from Kasani ({disp.length})</b>
      <div style={{ fontSize: 13, color: C.muted, margin: "4px 0 12px" }}>
        Expand a truck to see its load and the goods-received paperwork behind it — invoice, PO, GRN, supplier and location, ready to key into SAP.
      </div>
      {disp.length === 0 ? <div style={{ color: C.muted, padding: 8 }}>No trucks yet.</div> :
        disp.map((d) => {
          const gr = open[d.id] ? grBehind(d.lines) : [];
          return (<div key={d.id} style={{ border: `1px solid ${C.line}`, borderLeft: `5px solid ${d.ilt_done ? C.green : C.amber}`, borderRadius: 10, padding: 12, marginBottom: 10 }}>
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
                <thead><tr><th style={th}>SKU</th><th style={th}>Packmat</th><th style={th}>Material code</th><th style={th}>Qty</th><th style={th}>Shift</th></tr></thead>
                <tbody>{(d.lines || []).map((l, i) => (<tr key={i}>
                  <td style={{ ...td, fontWeight: 600 }}>{l.sku_code}</td>
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
    {tab === "gr" && <div style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <b>Goods received register ({grRows.length})</b>
        <input placeholder="search invoice / GRN / PO / SKU / code / supplier" value={q} onChange={(e) => setQ(e.target.value)} style={{ ...inp, width: 340 }} />
      </div>
      <div style={{ fontSize: 13, color: C.muted, marginBottom: 10 }}>
        The warehouse leaves GRN blank. Fill it here, tick <b>SAP</b> once it is keyed in, and export the register when you need the whole day at once.
      </div>
      <div style={{ maxHeight: 520, overflowY: "auto", overflowX: "auto" }}>
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

    {tab === "analytics" && <Analytics ledger={ledger} cons={cons} disp={disp} reqs={kreqs} skus={skus} days={days} setDays={setDays} />}

    {/* ---------------- loss ---------------- */}
    {tab === "loss" && <div style={card}>
      <b>FG produced → packmat loss (today)</b>
      <div style={{ fontSize: 13, color: C.muted, margin: "6px 0" }}>Upload FG produced (SKU, tonnes). Loss = issued today − should-consume.</div>
      <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => e.target.files[0] && runLoss(e.target.files[0])} />
      {loss && <div style={{ marginTop: 12 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
          {["carton", "cld", "sac", "laminate"].map((k) => <Kpi key={k} label={`${LBL[k]} loss (t)`} val={loss.cat[k].toFixed(2)} color={loss.cat[k] > 0 ? C.red : C.green} />)}
          <Kpi label="Total loss (t)" val={loss.total.toFixed(2)} color={C.slate} />
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th style={th}>SKU</th><th style={th}>Packmat</th><th style={th}>FG t</th><th style={th}>Should</th><th style={th}>Issued</th><th style={th}>Variance</th></tr></thead>
          <tbody>{loss.detail.map((r, i) => r.flag
            ? <tr key={i}><td style={td}>{r.code}</td><td style={{ ...td, color: C.amber }} colSpan={5}>{r.flag}</td></tr>
            : <tr key={i}><td style={td}>{r.code}</td><td style={td}>{LBL[r.pm]}</td><td style={td}>{r.t}</td><td style={td}>{r.th}</td><td style={td}>{r.iss}</td>
              <td style={{ ...td, fontWeight: 600, color: r.varB > 0 ? C.red : C.green }}>{r.varB > 0 ? "+" : ""}{r.varB}</td></tr>)}</tbody>
        </table>
      </div>}
    </div>}
  </div>);
}
