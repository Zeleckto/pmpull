// Leadership analytics: FG loss (production vs issued), GR/ILT status, movements,
// projected shortfall (weekly optional) + Export to Excel. Read-only.
import React, { useEffect, useState } from "react";
import { loadConsignments, loadProduction, addProduction, loadDispatches, setDispatch, kasaniOnHand, loadSkusK, loadConversionK } from "./dataKasani";
import { loadLedger } from "./data";
import { LBL, UNIT, compsOf, fgEquiv, theo, C, btn, card, th, td, readSheet, exportXlsx, norm } from "./shared";

export default function Leadership() {
  const [skus, setSkus] = useState([]); const [conv, setConv] = useState({});
  const [ledger, setLedger] = useState([]); const [prod, setProd] = useState([]);
  const [cons, setCons] = useState([]); const [disp, setDisp] = useState([]);
  const [loss, setLoss] = useState(null);
  const refresh = async () => { setSkus(await loadSkusK()); setConv(await loadConversionK()); setLedger(await loadLedger()); setProd(await loadProduction()); setCons(await loadConsignments()); setDisp(await loadDispatches()); };
  useEffect(() => { refresh(); }, []);

  const today = new Date().toISOString().slice(0, 10);
  const issuedToday = {}; ledger.forEach((e) => { if (e.direction === "issue" && String(e.ts).slice(0, 10) === today) { const k = `${e.sku_code}|${e.packmat}`; issuedToday[k] = (issuedToday[k] || 0) + Number(e.qty_base); } });

  const runLoss = (file) => readSheet(file, async (aoa) => {
    const H = (aoa[0] || []).map(norm); const iId = H.findIndex((h) => /sku|cbu|code/.test(h)); const iT = H.findIndex((h) => /tonne|ton|fg|qty|produced|total/.test(h));
    const prows = []; for (let r = 1; r < aoa.length; r++) { const row = aoa[r] || []; const code = String(row[iId] || "").trim(); const t = Number(String(row[iT] || "").replace(/[^0-9.]/g, "")) || 0; if (code && t) prows.push({ plan_date: today, sku_code: code, tonnes: t }); }
    if (prows.length) await addProduction(prows);
    computeLoss(prows); refresh();
  });
  function computeLoss(prows) {
    const cat = { carton: 0, cld: 0, sac: 0, laminate: 0 }; const detail = [];
    prows.forEach((p) => { const s = skus.find((x) => x.code === p.sku_code); if (!s) { detail.push({ code: p.sku_code, flag: "not in master" }); return; }
      compsOf(s).forEach((pm) => { if (pm === "divider") return; const th_ = theo(pm, s, p.tonnes, conv); const iss = issuedToday[`${p.sku_code}|${pm}`] || 0; const varB = iss - th_;
        if (cat[pm] != null) cat[pm] += fgEquiv(pm, varB, s, conv); detail.push({ code: p.sku_code, pm, t: p.tonnes, th: Math.round(th_), iss: Math.round(iss), varB: Math.round(varB) }); }); });
    setLoss({ cat, total: cat.carton + cat.cld + cat.sac + cat.laminate, detail });
  }

  const kOn = kasaniOnHand(cons);
  const grPending = cons.filter((c) => c.status === "pending").length;
  const iltPending = disp.filter((d) => !d.ilt_done).length;

  const exportDay = () => {
    const rows = ledger.filter((e) => String(e.ts).slice(0, 10) === today).map((e) => ({ time: e.ts, sku: e.sku_code, packmat: e.packmat, action: e.direction, qty: e.qty_base, line: e.line, shift: e.shift }));
    exportXlsx(`pmstore_${today}.xlsx`, rows.length ? rows : [{ note: "no movements today" }]);
  };

  const Kpi = ({ label, val, color }) => (<div style={{ ...card, marginBottom: 0, minWidth: 150 }}><div style={{ fontSize: 12, color: C.muted }}>{label}</div><div style={{ fontSize: 24, fontWeight: 700, color: color || C.ink }}>{val}</div></div>);

  return (<div style={{ maxWidth: 1040, margin: "0 auto", padding: 20, fontFamily: "system-ui,Arial", color: C.ink }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <h2 style={{ color: C.slate }}>Leadership Analytics</h2>
      <button onClick={exportDay} style={btn(C.slate)}>Export today (Excel)</button>
    </div>
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
      <Kpi label="GR pending (Kasani)" val={grPending} color={grPending ? C.amber : C.green} />
      <Kpi label="ILT pending" val={iltPending} color={iltPending ? C.red : C.green} />
      <Kpi label="Kasani stock lines" val={Object.keys(kOn).length} />
      <Kpi label="SKUs" val={skus.length} />
    </div>
    <div style={card}>
      <b>FG produced → packmat loss (today)</b>
      <div style={{ fontSize: 13, color: C.muted, margin: "6px 0" }}>Upload FG produced (SKU, tonnes). Loss = issued today − should-consume.</div>
      <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => e.target.files[0] && runLoss(e.target.files[0])} />
      {loss && <div style={{ marginTop: 12 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
          {["carton", "cld", "sac", "laminate"].map((k) => <Kpi key={k} label={`${LBL[k]} loss (t)`} val={loss.cat[k].toFixed(2)} color={loss.cat[k] > 0 ? C.red : C.green} />)}
          <Kpi label="Total loss (t)" val={loss.total.toFixed(2)} color={C.slate} />
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}><thead><tr><th style={th}>SKU</th><th style={th}>Packmat</th><th style={th}>FG t</th><th style={th}>Should</th><th style={th}>Issued</th><th style={th}>Variance</th></tr></thead>
          <tbody>{loss.detail.map((r, i) => r.flag ? <tr key={i}><td style={td}>{r.code}</td><td style={{ ...td, color: C.amber }} colSpan={5}>{r.flag}</td></tr> :
            <tr key={i}><td style={td}>{r.code}</td><td style={td}>{LBL[r.pm]}</td><td style={td}>{r.t}</td><td style={td}>{r.th}</td><td style={td}>{r.iss}</td><td style={{ ...td, fontWeight: 600, color: r.varB > 0 ? C.red : C.green }}>{r.varB > 0 ? "+" : ""}{r.varB}</td></tr>)}</tbody>
        </table>
      </div>}
    </div>
  </div>);
}
