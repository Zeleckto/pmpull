// Commercial analytics. Four views, all computed from tables you already have.
//   Shift & lines  — what each line drew and sent back, this shift or any window,
//                    plus FG produced vs packmat issued = the real loss per line.
//   Shortfall      — today by shift and a week out: demand vs the FG the PM store can
//                    actually pack, and what Kasani could top it up with.
//   Quality        — blocked/rejected at the store, and Kasani's quality-pending list
//                    ranked by whether that material is needed in the next 3 shifts.
//   Logistics      — GR in, trucks out, ILT timing, and stock ageing towards 6 months.
//
// Shifts are IST and fixed: A 06:00–14:00, B 14:00–22:00, C 22:00–06:00 next morning.
import React, { useMemo, useState } from "react";
import {
  LBL, BASE_UNIT, compsOf, fgEquiv, theo, fgCapable, grStatus,
  shiftOf, currentShift, nextShifts, istToday, SHIFT_HOURS,
  C, card, th, td, inp, exportXlsx,
} from "./shared";
import { remainingOf, kasaniOnHand } from "./dataKasani";

const DAY = 86400000;
const hrs = (a, b) => (new Date(b) - new Date(a)) / 3600000;
const fmtH = (h) => (h == null ? "—" : h < 24 ? `${h.toFixed(1)} h` : `${(h / 24).toFixed(1)} d`);
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);
const n0 = (x) => Math.round(x || 0).toLocaleString();
const t2 = (x) => (Number(x) || 0).toFixed(2);

export default function Analytics({
  ledger, cons, disp, reqs, skus, conv, production, phasing,
  days, setDays, onUploadProduction, onUploadPhasing, uploadMsg,
}) {
  const [view, setView] = useState("shift");
  const [scope, setScope] = useState("shift");    // shift | window  (Shift & lines view)
  const cur = currentShift();
  // which shift slot the screen is looking at — defaults to the one running now
  const [slot, setSlot] = useState({ date: cur.date, shift: cur.shift });
  const [dayDate, setDayDate] = useState(istToday());     // daily phasing date
  const [weekDate, setWeekDate] = useState(istToday());   // weekly phasing week-start

  const since = days === 0 ? null : new Date(Date.now() - days * DAY);
  const inWin = (ts) => !since || (ts && new Date(ts) >= since);
  const skuOf = (c) => skus.find((s) => s.code === c);

  // ---------- movement buckets ----------
  const led = useMemo(() => ledger.map((e) => ({ ...e, ...shiftOf(e.ts) })), [ledger]);
  const thisShift = led.filter((e) => e.date === slot.date && e.shift === slot.shift);
  const moves = scope === "shift" ? thisShift : led.filter((e) => inWin(e.ts));

  // ---------- lines: issued / returned, split by packmat ----------
  const lineRows = useMemo(() => {
    const m = {};
    moves.forEach((e) => {
      const ln = String(e.line || "").trim().toUpperCase();
      if (!ln || !["issue", "return"].includes(e.direction)) return;
      if (!m[ln]) m[ln] = { line: ln, issued: 0, returned: 0, pm: {}, skus: {} };
      const q = Math.abs(Number(e.qty_base) || 0);
      const bucket = m[ln].pm[e.packmat] || (m[ln].pm[e.packmat] = { issued: 0, returned: 0 });
      const sk = m[ln].skus[e.sku_code] || (m[ln].skus[e.sku_code] = { issued: 0, returned: 0, pm: {} });
      const skpm = sk.pm[e.packmat] || (sk.pm[e.packmat] = { issued: 0, returned: 0 });
      if (e.direction === "issue") { m[ln].issued += q; bucket.issued += q; sk.issued += q; skpm.issued += q; }
      else { m[ln].returned += q; bucket.returned += q; sk.returned += q; skpm.returned += q; }
    });
    return Object.values(m)
      .map((l) => ({ ...l, rate: l.issued ? (l.returned / l.issued) * 100 : 0 }))
      .sort((a, b) => b.issued - a.issued);
  }, [moves]);
  const [openLine, setOpenLine] = useState(null);

  // ---------- production vs issued = loss ----------
  const prodRows = useMemo(() => {
    const p = production.filter((r) => (scope === "shift"
      ? r.plan_date === slot.date && (r.shift || slot.shift) === slot.shift
      : inWin(r.ts)));
    const perLine = p.some((r) => r.line);      // DPR carried a line column
    const out = [];
    let lossT = 0;
    p.forEach((r) => {
      const s2 = skuOf(r.sku_code);
      if (!s2) { out.push({ code: r.sku_code, flag: "not in SKU master" }); return; }
      const ln = r.line ? String(r.line).toUpperCase() : null;
      compsOf(s2).forEach((pm) => {
        if (pm === "divider") return;
        const should = theo(pm, s2, Number(r.tonnes) || 0, conv);
        // consumed = issued - returned, restricted to this line when the DPR names one
        const match = (e, dir) => e.direction === dir && e.sku_code === r.sku_code && e.packmat === pm
          && (!ln || String(e.line || "").toUpperCase() === ln);
        const issued = moves.filter((e) => match(e, "issue")).reduce((a, e) => a + (Number(e.qty_base) || 0), 0);
        const back = moves.filter((e) => match(e, "return")).reduce((a, e) => a + (Number(e.qty_base) || 0), 0);
        const used = issued - back;
        const varB = used - should;
        const varT = fgEquiv(pm, varB, s2, conv);
        lossT += varT;
        out.push({ line: ln, code: r.sku_code, pm, t: Number(r.tonnes) || 0, should: Math.round(should), used: Math.round(used), varB: Math.round(varB), varT });
      });
    });
    // roll up by line so the worst offender is obvious
    const byLine = {};
    out.filter((r) => !r.flag && r.line).forEach((r) => {
      byLine[r.line] = byLine[r.line] || { line: r.line, t: 0, lossT: 0, rows: 0 };
      byLine[r.line].lossT += r.varT; byLine[r.line].rows++;
    });
    p.filter((r) => r.line).forEach((r) => {
      const k = String(r.line).toUpperCase();
      if (byLine[k]) byLine[k].t += Number(r.tonnes) || 0;
    });
    return { rows: out, lossT, perLine, byLine: Object.values(byLine).sort((a, b) => b.lossT - a.lossT) };
  }, [production, moves, scope, slot, conv, skus]);

  // ---------- stock positions ----------
  const pmOnHand = useMemo(() => {
    const m = {};
    ledger.forEach((r) => {
      const k = `${r.sku_code}|${r.packmat}`; const q = Number(r.qty_base) || 0;
      if (r.direction === "issue" || r.direction === "block") m[k] = (m[k] || 0) - q;
      else if (r.direction === "adjust") m[k] = q;
      else if (r.direction === "scrap") m[k] = m[k] || 0;
      else m[k] = (m[k] || 0) + q;
    });
    return m;
  }, [ledger]);
  const kOnHand = useMemo(() => kasaniOnHand(cons), [cons]);
  const bothOnHand = useMemo(() => {
    const m = { ...pmOnHand };
    Object.entries(kOnHand).forEach(([k, v]) => { m[k] = (m[k] || 0) + v; });
    return m;
  }, [pmOnHand, kOnHand]);

  // ---------- shortfall ----------
  // Daily plan  -> checked against the PM STORE only (it is the store's own shortfall).
  // Weekly plan -> checked against PM STORE + KASANI (what the site can cover in a week).
  const today = istToday();
  const buildShort = (rows, onHand) => {
    const bySku = {};
    rows.forEach((p) => {
      if (!bySku[p.sku_code]) bySku[p.sku_code] = { code: p.sku_code, demand: 0, byShift: { A: 0, B: 0, C: 0 } };
      bySku[p.sku_code].demand += Number(p.tonnes) || 0;
      if (p.shift && bySku[p.sku_code].byShift[p.shift] != null) bySku[p.sku_code].byShift[p.shift] += Number(p.tonnes) || 0;
    });
    return Object.values(bySku).map((r) => {
      const s2 = skuOf(r.code);
      if (!s2) return { ...r, unknown: true, can: 0, limit: null, gap: r.demand };
      const c = fgCapable(s2, onHand, conv);
      return { ...r, s: s2, can: c.t, limit: c.limit, per: c.per, gap: Math.max(0, r.demand - c.t) };
    }).sort((x, y) => y.gap - x.gap || y.demand - x.demand);
  };
  const dayRows = useMemo(() => buildShort(phasing.filter((p) => p.horizon !== "week" && p.plan_date === dayDate), pmOnHand),
    [phasing, dayDate, pmOnHand, conv, skus]);
  const weekRows = useMemo(() => buildShort(phasing.filter((p) => p.horizon === "week" && p.plan_date === weekDate), bothOnHand),
    [phasing, weekDate, bothOnHand, conv, skus]);

  // ---------- what is needed in the next 3 shifts ----------
  const need3 = useMemo(() => {
    const want = nextShifts(3);
    const set = new Set();
    phasing.forEach((p) => { if (want.some((w) => w.date === p.plan_date && w.shift === p.shift)) set.add(p.sku_code); });
    reqs.forEach((r) => { if (r.status === "open") set.add(r.sku_code); });
    return { set, want };
  }, [phasing, reqs]);

  // ---------- quality ----------
  const pendingQC = cons
    .filter((c) => c.status === "pending")
    .map((c) => ({ ...c, urgent: need3.set.has(c.sku_code), waited: hrs(c.received_at || c.ts, new Date()) }))
    .sort((a, b) => (b.urgent - a.urgent) || b.waited - a.waited);
  const rejectedK = cons.filter((c) => c.status === "rejected");
  const dirTotal = (d) => led.filter((e) => inWin(e.ts) && e.direction === d).reduce((a, e) => a + Math.abs(Number(e.qty_base) || 0), 0);
  const blocked = dirTotal("block"), scrapped = dirTotal("scrap"), released = dirTotal("unblock");

  // ---------- logistics ----------
  const grs = cons.filter((c) => inWin(c.received_at || c.ts));
  const trucks = disp.filter((d) => inWin(d.ts));
  const sentTrucks = trucks.filter((d) => d.dispatched_at);
  const iltLag = trucks.filter((d) => d.dispatched_at && d.ilt_sent_at).map((d) => hrs(d.dispatched_at, d.ilt_sent_at));
  const ageing = cons
    .filter((c) => c.status === "cleared" && remainingOf(c) > 0)
    .map((c) => ({ ...c, age: (Date.now() - new Date(c.received_at || c.ts)) / DAY }))
    .sort((a, b) => b.age - a.age);
  const nearSixMonths = ageing.filter((c) => c.age >= 150);

  // ---------- ui bits ----------
  const Kpi = ({ label, val, sub, color }) => (<div style={{ ...card, marginBottom: 0, minWidth: 146, flex: "1 1 146px" }}>
    <div style={{ fontSize: 12, color: C.muted }}>{label}</div>
    <div style={{ fontSize: 22, fontWeight: 700, color: color || C.ink }}>{val}</div>
    {sub && <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{sub}</div>}</div>);
  const Sec = ({ title, hint, children }) => (<div style={card}>
    <b>{title}</b>{hint && <div style={{ fontSize: 12, color: C.muted, margin: "4px 0 10px" }}>{hint}</div>}{children}</div>);
  // Filters inside the page are quiet segmented controls — deliberately unlike the solid
  // action buttons in the header, so "change the view" never looks like "do something".
  const Pill = ({ on, onClick, children }) => (<button onClick={onClick} style={{
    padding: "6px 13px", borderRadius: 7, marginRight: 4, fontWeight: 600, fontSize: 13, cursor: "pointer",
    border: on ? `1px solid ${C.line}` : "1px solid transparent",
    background: on ? "#fff" : "transparent", color: on ? C.slate : C.muted,
    boxShadow: on ? "0 1px 2px rgba(15,23,42,.10)" : "none" }}>{children}</button>);
  const Seg = ({ children, style }) => (<div style={{
    display: "inline-flex", flexWrap: "wrap", gap: 2, padding: 4, borderRadius: 10,
    background: "#eef2f7", border: `1px solid ${C.line}`, ...style }}>{children}</div>);
  const Bar = ({ v, max, color }) => (<div style={{ width: 90, height: 7, background: "#e2e8f0", borderRadius: 4, display: "inline-block", verticalAlign: "middle" }}>
    <div style={{ width: `${Math.min(100, max ? (v / max) * 100 : 0)}%`, height: "100%", background: color, borderRadius: 4 }} /></div>);

  const maxIssued = Math.max(1, ...lineRows.map((l) => l.issued));

  return (<div>
    {/* ---------------- view switch ---------------- */}
    <div style={{ marginBottom: 14 }}>
      <Seg>
        <Pill on={view === "shift"} onClick={() => setView("shift")}>Shift &amp; lines</Pill>
        <Pill on={view === "short"} onClick={() => setView("short")}>Shortfall</Pill>
        <Pill on={view === "qual"} onClick={() => setView("qual")}>Quality</Pill>
        <Pill on={view === "log"} onClick={() => setView("log")}>Logistics</Pill>
      </Seg>
    </div>

    {/* ================= SHIFT & LINES ================= */}
    {view === "shift" && <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Seg>
            <Pill on={scope === "shift"} onClick={() => setScope("shift")}>One shift</Pill>
            <Pill on={scope === "window"} onClick={() => setScope("window")}>Window</Pill>
          </Seg>
          {scope === "window" && <Seg>
            <Pill on={days === 1} onClick={() => setDays(1)}>24 h</Pill>
            <Pill on={days === 7} onClick={() => setDays(7)}>7 d</Pill>
            <Pill on={days === 30} onClick={() => setDays(30)}>30 d</Pill>
            <Pill on={days === 0} onClick={() => setDays(0)}>All</Pill>
          </Seg>}
        </div>
        {scope === "shift" && <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input type="date" value={slot.date} onChange={(e) => setSlot({ ...slot, date: e.target.value })} style={inp} />
          <Seg>{["A", "B", "C"].map((x) => <Pill key={x} on={slot.shift === x} onClick={() => setSlot({ ...slot, shift: x })}>{x}</Pill>)}</Seg>
          <button onClick={() => setSlot({ date: cur.date, shift: cur.shift })} style={{ ...inp, cursor: "pointer", background: "#fff" }}>now</button>
          <span style={{ fontSize: 12, color: C.muted }}>{SHIFT_HOURS[slot.shift]} IST</span>
        </div>}
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <Kpi label="Issued" val={n0(lineRows.reduce((a, l) => a + l.issued, 0))}
          sub={scope === "shift" ? `${slot.date} shift ${slot.shift}` : "in window"} />
        <Kpi label="Returned" val={n0(lineRows.reduce((a, l) => a + l.returned, 0))}
          sub={`${pct(lineRows.reduce((a, l) => a + l.returned, 0), lineRows.reduce((a, l) => a + l.issued, 0))}% of issued`}
          color={pct(lineRows.reduce((a, l) => a + l.returned, 0), lineRows.reduce((a, l) => a + l.issued, 0)) > 10 ? C.red : C.green} />
        <Kpi label="Lines active" val={lineRows.length} />
        <Kpi label="DPR rows" val={prodRows.rows.filter((r) => !r.flag).length} sub={prodRows.perLine ? "line-wise" : "no line column"} />
        <Kpi label="Packmat loss" val={`${t2(prodRows.lossT)} t`} sub="used − should have used" color={prodRows.lossT > 0 ? C.red : C.green} />
      </div>

      <Sec title={`Packmat issued by line — ${scope === "shift" ? `${slot.date} shift ${slot.shift}` : "selected window"}`}
        hint="Split by packmat. Click a line to see the SKUs behind it. Lines come from the tag put on the issue in the PM store.">
        {lineRows.length === 0 ? <div style={{ color: C.muted, padding: 8 }}>No line-tagged issues in this period. The PM store records the line when issuing.</div> :
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              <th style={th}>Line</th><th style={th}>Issued</th><th style={th}>Carton</th><th style={th}>CLD</th>
              <th style={th}>Laminate</th><th style={th}>Sac</th><th style={th}>Returned</th><th style={th}>Return rate</th><th style={th}></th>
            </tr></thead>
            <tbody>{lineRows.map((l) => (<React.Fragment key={l.line}>
              <tr>
                <td style={{ ...td, fontWeight: 700 }}>{l.line}</td>
                <td style={td}><Bar v={l.issued} max={maxIssued} color={C.slate} /> <b>{n0(l.issued)}</b></td>
                {["carton", "cld", "laminate", "sac"].map((pm) => (
                  <td key={pm} style={{ ...td, color: (l.pm[pm] || {}).issued ? C.ink : C.muted }}>{n0((l.pm[pm] || {}).issued)}</td>))}
                <td style={{ ...td, color: l.returned ? C.amber : C.muted }}>{n0(l.returned)}</td>
                <td style={{ ...td, fontWeight: 700, color: l.rate > 15 ? C.red : l.rate > 5 ? C.amber : C.green }}>{l.rate.toFixed(1)}%</td>
                <td style={td}><button onClick={() => setOpenLine(openLine === l.line ? null : l.line)}
                  style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 6, padding: "3px 9px", fontSize: 12, cursor: "pointer" }}>
                  {openLine === l.line ? "Hide" : `${Object.keys(l.skus).length} SKUs`}</button></td>
              </tr>
              {openLine === l.line && Object.entries(l.skus).sort((a, b) => b[1].issued - a[1].issued).map(([code, v]) => (
                <tr key={code} style={{ background: "#f8fafc" }}>
                  <td style={td}></td>
                  <td style={{ ...td, fontWeight: 600 }}>{code}</td>
                  {["carton", "cld", "laminate", "sac"].map((pm) => (
                    <td key={pm} style={{ ...td, fontSize: 13 }}>{n0((v.pm[pm] || {}).issued)}</td>))}
                  <td style={{ ...td, fontSize: 13, color: v.returned ? C.amber : C.muted }}>{n0(v.returned)}</td>
                  <td style={{ ...td, fontSize: 12, color: C.muted }} colSpan={2}>{(skuOf(code) || {}).description || ""}</td>
                </tr>))}
            </React.Fragment>))}</tbody>
          </table>}
      </Sec>

      <Sec title="Upload the DPR for this shift"
        hint="Daily production report: SKU code, tonnes produced, and optionally a line column. With a line column the loss is worked out per line; without it, per SKU across the shift. Re-uploading the same date+shift replaces it.">
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <input type="date" value={slot.date} onChange={(e) => setSlot({ ...slot, date: e.target.value })} style={inp} />
          <Seg>{["A", "B", "C"].map((x) => <Pill key={x} on={slot.shift === x} onClick={() => setSlot({ ...slot, shift: x })}>{x}</Pill>)}</Seg>
          <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => e.target.files[0] && onUploadProduction(e.target.files[0], slot.date, slot.shift)} />
        </div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>Books against <b>{slot.date} shift {slot.shift}</b> ({SHIFT_HOURS[slot.shift]} IST).</div>
        {uploadMsg && <div style={{ fontSize: 13, marginTop: 8, color: /error/i.test(uploadMsg) ? C.red : C.green }}>{uploadMsg}</div>}
      </Sec>

      {prodRows.perLine && prodRows.byLine.length > 0 && <Sec title="Packmat loss by line"
        hint="Loss in FG-tonne terms: what that line consumed versus what its output should have needed.">
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th style={th}>Line</th><th style={th}>FG produced</th><th style={th}>Packmat loss (t)</th><th style={th}>Loss %</th></tr></thead>
          <tbody>{prodRows.byLine.map((l) => (<tr key={l.line}>
            <td style={{ ...td, fontWeight: 700 }}>{l.line}</td>
            <td style={td}>{t2(l.t)} t</td>
            <td style={{ ...td, fontWeight: 700, color: l.lossT > 0 ? C.red : C.green }}>{t2(l.lossT)}</td>
            <td style={{ ...td, color: l.lossT > 0 ? C.red : C.green }}>{l.t ? ((l.lossT / l.t) * 100).toFixed(1) : "—"}%</td>
          </tr>))}</tbody>
        </table>
      </Sec>}

      <Sec title="FG produced vs packmat consumed"
        hint="Consumed = issued − returned. A positive variance means more packaging went out than the tonnage justifies.">
        {prodRows.rows.length === 0 ? <div style={{ color: C.muted, padding: 8 }}>No DPR uploaded for this shift.</div> :
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>{prodRows.perLine && <th style={th}>Line</th>}<th style={th}>SKU</th><th style={th}>Packmat</th><th style={th}>FG t</th><th style={th}>Should use</th><th style={th}>Actually used</th><th style={th}>Variance</th><th style={th}>= FG t</th></tr></thead>
            <tbody>{prodRows.rows.map((r, i2) => r.flag
              ? <tr key={i2}><td style={td} colSpan={prodRows.perLine ? 8 : 7}><b>{r.code}</b> <span style={{ color: C.amber }}>{r.flag}</span></td></tr>
              : <tr key={i2}>
                {prodRows.perLine && <td style={{ ...td, fontWeight: 600 }}>{r.line || "—"}</td>}
                <td style={{ ...td, fontWeight: 600 }}>{r.code}</td><td style={td}>{LBL[r.pm]}</td><td style={td}>{t2(r.t)}</td>
                <td style={td}>{n0(r.should)}</td><td style={td}>{n0(r.used)}</td>
                <td style={{ ...td, fontWeight: 700, color: r.varB > 0 ? C.red : C.green }}>{r.varB > 0 ? "+" : ""}{n0(r.varB)}</td>
                <td style={{ ...td, color: r.varT > 0 ? C.red : C.green }}>{t2(r.varT)}</td>
              </tr>)}</tbody>
          </table>}
      </Sec>
    </>}

    {/* ================= SHORTFALL ================= */}
    {view === "short" && <>
      <Sec title="Daily phasing — what the PM store must cover today"
        hint="Columns: SKU code, demand in tonnes, needed by shift (A/B/C). Pick the date it is for; today is filled in already. Re-uploading a date replaces that day's daily plan only.">
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ fontSize: 12, color: C.muted }}>For date&nbsp;
            <input type="date" value={dayDate} onChange={(e) => setDayDate(e.target.value)} style={inp} /></label>
          <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => e.target.files[0] && onUploadPhasing(e.target.files[0], dayDate, "day")} />
          <span style={{ fontSize: 13, color: C.muted }}>
            {dayRows.length ? `${dayRows.length} SKU(s) loaded for ${dayDate}` : `nothing loaded for ${dayDate}`}
          </span>
        </div>
        {uploadMsg && <div style={{ fontSize: 13, marginTop: 8, color: /error/i.test(uploadMsg) ? C.red : C.green }}>{uploadMsg}</div>}
      </Sec>

      <Sec title={`Today's shortfall — against PM store stock only (${dayDate})`}
        hint="Can pack = FG tonnes the store's own stock can make. The limiting packmat is whichever runs out first — that is what to pull from Kasani.">
        {dayRows.length === 0 ? <div style={{ color: C.muted, padding: 8 }}>No daily plan loaded for {dayDate}.</div> : <>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
            <Kpi label="Demand" val={`${t2(dayRows.reduce((a, r) => a + r.demand, 0))} t`} />
            <Kpi label="Store can pack" val={`${t2(dayRows.reduce((a, r) => a + Math.min(r.demand, r.can || 0), 0))} t`} color={C.green} />
            <Kpi label="Short" val={`${t2(dayRows.reduce((a, r) => a + r.gap, 0))} t`}
              color={dayRows.some((r) => r.gap > 0) ? C.red : C.green} sub={`${dayRows.filter((r) => r.gap > 0).length} SKU(s)`} />
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
              <thead><tr>
                <th style={th}>SKU</th><th style={th}>Description</th>
                <th style={th}>A</th><th style={th}>B</th><th style={th}>C</th>
                <th style={th}>Demand t</th><th style={th}>Store can pack</th><th style={th}>Limiting</th><th style={th}>Short t</th>
              </tr></thead>
              <tbody>{dayRows.map((r) => (<tr key={r.code}>
                <td style={{ ...td, fontWeight: 600 }}>{r.code}</td>
                <td style={{ ...td, color: C.muted, fontSize: 13 }}>{r.unknown ? <span style={{ color: C.amber }}>not in SKU master</span> : (r.s.description || "").slice(0, 24)}</td>
                {["A", "B", "C"].map((sh) => (<td key={sh} style={{ ...td, fontSize: 13 }}>{r.byShift[sh] ? t2(r.byShift[sh]) : "—"}</td>))}
                <td style={{ ...td, fontWeight: 600 }}>{t2(r.demand)}</td>
                <td style={{ ...td, color: (r.can || 0) >= r.demand ? C.green : C.red }}>{t2(r.can)}</td>
                <td style={{ ...td, fontSize: 12, color: C.muted }}>{r.limit ? LBL[r.limit] : "—"}</td>
                <td style={{ ...td, fontWeight: 700, color: r.gap > 0 ? C.red : C.green }}>{r.gap > 0 ? t2(r.gap) : "covered"}</td>
              </tr>))}</tbody>
            </table>
          </div>
        </>}
      </Sec>

      <Sec title="Weekly plan — what the site can cover"
        hint="Columns: SKU code and demand in tonnes. No shift column. Pick the week's start date.">
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ fontSize: 12, color: C.muted }}>Week starting&nbsp;
            <input type="date" value={weekDate} onChange={(e) => setWeekDate(e.target.value)} style={inp} /></label>
          <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => e.target.files[0] && onUploadPhasing(e.target.files[0], weekDate, "week")} />
          <span style={{ fontSize: 13, color: C.muted }}>
            {weekRows.length ? `${weekRows.length} SKU(s) loaded for w/c ${weekDate}` : `nothing loaded for w/c ${weekDate}`}
          </span>
        </div>
      </Sec>

      <Sec title={`Weekly shortfall — against PM store + Kasani (w/c ${weekDate})`}
        hint="Both stock positions added together: what the site as a whole can pack against the week's demand.">
        {weekRows.length === 0 ? <div style={{ color: C.muted, padding: 8 }}>No weekly plan loaded for w/c {weekDate}.</div> : <>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
            <Kpi label="Demand" val={`${t2(weekRows.reduce((a, r) => a + r.demand, 0))} t`} />
            <Kpi label="Site can pack" val={`${t2(weekRows.reduce((a, r) => a + Math.min(r.demand, r.can || 0), 0))} t`} color={C.green} />
            <Kpi label="Short" val={`${t2(weekRows.reduce((a, r) => a + r.gap, 0))} t`}
              color={weekRows.some((r) => r.gap > 0) ? C.red : C.green} sub={`${weekRows.filter((r) => r.gap > 0).length} SKU(s)`} />
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th style={th}>SKU</th><th style={th}>Description</th><th style={th}>Demand t</th><th style={th}>Store + Kasani can pack</th><th style={th}>Limiting</th><th style={th}>Short t</th></tr></thead>
            <tbody>{weekRows.map((r) => (<tr key={r.code}>
              <td style={{ ...td, fontWeight: 600 }}>{r.code}</td>
              <td style={{ ...td, color: C.muted, fontSize: 13 }}>{r.unknown ? <span style={{ color: C.amber }}>not in SKU master</span> : (r.s.description || "").slice(0, 26)}</td>
              <td style={{ ...td, fontWeight: 600 }}>{t2(r.demand)}</td>
              <td style={{ ...td, color: (r.can || 0) >= r.demand ? C.green : C.red }}>{t2(r.can)}</td>
              <td style={{ ...td, fontSize: 12, color: C.muted }}>{r.limit ? LBL[r.limit] : "—"}</td>
              <td style={{ ...td, fontWeight: 700, color: r.gap > 0 ? C.red : C.green }}>{r.gap > 0 ? t2(r.gap) : "covered"}</td>
            </tr>))}</tbody>
          </table>
        </>}
      </Sec>
    </>}

    {/* ================= QUALITY ================= */}
    {view === "qual" && <>
      <Sec title="PM store — blocked and written off" hint="Material pulled out of usable stock on quality grounds, and what happened next.">
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Kpi label="Blocked" val={n0(blocked)} color={blocked ? C.red : C.green} />
          <Kpi label="Released back" val={n0(released)} color={C.green} />
          <Kpi label="Scrapped" val={n0(scrapped)} color={scrapped ? C.red : C.green} />
          <Kpi label="Still blocked" val={n0(Math.max(0, blocked - released - scrapped))} color={C.amber} />
        </div>
      </Sec>

      <Sec title={`Kasani quality pending (${pendingQC.length}) — urgent first`}
        hint={`"Needed soon" means the SKU appears in the phasing for ${need3.want.map((w) => `${w.date} ${w.shift}`).join(", ")} or has an open store request. Those should be sampled first.`}>
        {pendingQC.length === 0 ? <div style={{ color: C.muted, padding: 8 }}>Nothing awaiting quality.</div> :
          <div style={{ maxHeight: 460, overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>
                <th style={th}>Priority</th><th style={th}>SKU</th><th style={th}>Packmat</th><th style={th}>Code</th>
                <th style={th}>Qty</th><th style={th}>Invoice</th><th style={th}>Waiting</th><th style={th}>Sample</th>
              </tr></thead>
              <tbody>{pendingQC.map((c) => (<tr key={c.id} style={{ background: c.urgent ? "#fff7ed" : "transparent" }}>
                <td style={td}>{c.urgent
                  ? <span style={{ background: C.red, color: "#fff", borderRadius: 10, padding: "1px 8px", fontSize: 11, fontWeight: 700 }}>NEEDED SOON</span>
                  : <span style={{ fontSize: 12, color: C.muted }}>routine</span>}</td>
                <td style={{ ...td, fontWeight: 600 }}>{c.sku_code || "—"}</td>
                <td style={td}>{LBL[c.packmat] || c.packmat}</td>
                <td style={{ ...td, fontFamily: "monospace", fontSize: 12 }}>{c.packmat_code || "—"}</td>
                <td style={td}>{n0(c.qty_base)} {BASE_UNIT[c.packmat]}</td>
                <td style={td}>{c.invoice || "—"}</td>
                <td style={{ ...td, fontWeight: 600, color: c.waited > 48 ? C.red : c.waited > 24 ? C.amber : C.ink }}>{fmtH(c.waited)}</td>
                <td style={td}>{c.sample_sent
                  ? <span style={{ color: C.amber, fontWeight: 600, fontSize: 13 }}>sent {c.sample_sent_at ? fmtH(hrs(c.sample_sent_at, new Date())) + " ago" : ""}</span>
                  : <span style={{ color: C.red, fontWeight: 600, fontSize: 13 }}>not sent</span>}</td>
              </tr>))}</tbody>
            </table>
          </div>}
      </Sec>

      <Sec title={`Rejected at Kasani (${rejectedK.length})`} hint="Blocked consignments and the reason given.">
        {rejectedK.length === 0 ? <div style={{ color: C.muted, padding: 8 }}>Nothing rejected.</div> :
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th style={th}>SKU</th><th style={th}>Packmat</th><th style={th}>Qty</th><th style={th}>Invoice</th><th style={th}>Supplier</th><th style={th}>Reason</th></tr></thead>
            <tbody>{rejectedK.map((c) => (<tr key={c.id}>
              <td style={{ ...td, fontWeight: 600 }}>{c.sku_code || "—"}</td>
              <td style={td}>{LBL[c.packmat] || c.packmat}</td>
              <td style={td}>{n0(c.qty_base)}</td>
              <td style={td}>{c.invoice || "—"}</td>
              <td style={{ ...td, fontSize: 13 }}>{c.supplier || "—"}</td>
              <td style={{ ...td, fontSize: 13, color: C.muted }}>{c.reject_reason || "—"}</td>
            </tr>))}</tbody>
          </table>}
      </Sec>
    </>}

    {/* ================= LOGISTICS ================= */}
    {view === "log" && <>
      <div style={{ marginBottom: 14 }}><Seg>
        <Pill on={days === 1} onClick={() => setDays(1)}>24 h</Pill>
        <Pill on={days === 7} onClick={() => setDays(7)}>7 d</Pill>
        <Pill on={days === 30} onClick={() => setDays(30)}>30 d</Pill>
        <Pill on={days === 90} onClick={() => setDays(90)}>90 d</Pill>
        <Pill on={days === 0} onClick={() => setDays(0)}>All</Pill>
      </Seg></div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <Kpi label="GR receipts" val={grs.length} sub={`${n0(grs.reduce((a, c) => a + (Number(c.qty_base) || 0), 0))} units in`} />
        <Kpi label="Trucks sent" val={sentTrucks.length} sub={`${trucks.filter((d) => d.status === "planned").length} still planned`} />
        <Kpi label="ILT signed off" val={trucks.filter((d) => d.ilt_done).length} color={C.green} />
        <Kpi label="Avg ILT lag" val={fmtH(avg(iltLag))} />
        <Kpi label="Stock ≥ 5 months" val={nearSixMonths.length} color={nearSixMonths.length ? C.red : C.green} sub="approaching 6 months" />
      </div>

      <Sec title={`Goods received (${grs.length})`} hint="Newest first, with the exact receipt time.">
        <div style={{ maxHeight: 320, overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th style={th}>Received</th><th style={th}>Shift</th><th style={th}>Invoice</th><th style={th}>SKU</th><th style={th}>Packmat</th><th style={th}>Qty</th><th style={th}>Supplier</th><th style={th}>Status</th></tr></thead>
            <tbody>{grs.length === 0 ? <tr><td style={td} colSpan={8}>Nothing in this window.</td></tr> :
              grs.slice(0, 100).map((c) => { const st = grStatus(c); const sh = shiftOf(c.received_at || c.ts); return (<tr key={c.id}>
                <td style={{ ...td, fontSize: 12 }}>{String(c.received_at || c.ts || "").slice(0, 16).replace("T", " ")}</td>
                <td style={{ ...td, fontSize: 12, fontWeight: 600 }}>{sh.shift}</td>
                <td style={td}>{c.invoice || "—"}</td>
                <td style={{ ...td, fontWeight: 600 }}>{c.sku_code || "—"}</td>
                <td style={td}>{LBL[c.packmat] || c.packmat}</td>
                <td style={td}>{n0(c.qty_base)}</td>
                <td style={{ ...td, fontSize: 13 }}>{c.supplier || "—"}</td>
                <td style={td}><span style={{ background: st.color, color: "#fff", borderRadius: 10, padding: "1px 8px", fontSize: 11, fontWeight: 700 }}>{st.label}</span></td>
              </tr>); })}</tbody>
          </table>
        </div>
      </Sec>

      <Sec title={`Trucks &amp; ILT (${trucks.length})`} hint="When each truck was planned, dispatched and signed off.">
        <div style={{ maxHeight: 320, overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th style={th}>Truck</th><th style={th}>Challan</th><th style={th}>Planned</th><th style={th}>Dispatched</th><th style={th}>Shift</th><th style={th}>Fill</th><th style={th}>Lines</th><th style={th}>ILT</th></tr></thead>
            <tbody>{trucks.length === 0 ? <tr><td style={td} colSpan={8}>No trucks in this window.</td></tr> :
              trucks.map((d) => (<tr key={d.id}>
                <td style={{ ...td, fontWeight: 600 }}>#{d.truck_no}</td>
                <td style={{ ...td, fontFamily: "monospace", fontSize: 12 }}>{d.challan || "—"}</td>
                <td style={{ ...td, fontSize: 12 }}>{String(d.ts || "").slice(0, 16).replace("T", " ")}</td>
                <td style={{ ...td, fontSize: 12 }}>{d.dispatched_at ? String(d.dispatched_at).slice(0, 16).replace("T", " ") : "—"}</td>
                <td style={td}>{d.shift || "—"}</td>
                <td style={{ ...td, color: d.fill_pct < 70 ? C.amber : C.ink }}>{d.fill_pct}%</td>
                <td style={td}>{(d.lines || []).length}</td>
                <td style={{ ...td, fontWeight: 600, color: d.ilt_done ? C.green : C.amber }}>{d.ilt_done ? "done" : d.dispatched_at ? "pending" : "not sent"}</td>
              </tr>))}</tbody>
          </table>
        </div>
      </Sec>

      <Sec title="Oldest stock at Kasani"
        hint="Red at 5 months and above — those are the ones approaching the 6-month limit and should be pulled next.">
        {ageing.length === 0 ? <div style={{ color: C.muted, padding: 8 }}>No cleared stock.</div> :
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th style={th}>Age</th><th style={th}>To 6 months</th><th style={th}>Material code</th><th style={th}>SKU</th><th style={th}>Packmat</th><th style={th}>Invoice</th><th style={th}>Qty left</th><th style={th}>Location</th></tr></thead>
            <tbody>{ageing.slice(0, 20).map((c) => { const left = 180 - c.age; return (<tr key={c.id} style={{ background: c.age >= 150 ? "#fef2f2" : "transparent" }}>
              <td style={{ ...td, fontWeight: 700, color: c.age >= 180 ? "#7f1d1d" : c.age >= 150 ? C.red : c.age >= 90 ? C.amber : C.ink }}>{Math.round(c.age)} d</td>
              <td style={{ ...td, fontSize: 12, fontWeight: 600, color: left <= 0 ? "#7f1d1d" : left <= 30 ? C.red : C.muted }}>{left <= 0 ? "OVERDUE" : `${Math.round(left)} d left`}</td>
              <td style={{ ...td, fontFamily: "monospace", fontSize: 12 }}>{c.packmat_code || "—"}</td>
              <td style={{ ...td, fontWeight: 600 }}>{c.sku_code || "—"}</td>
              <td style={td}>{LBL[c.packmat] || c.packmat}</td>
              <td style={td}>{c.invoice || "—"}</td>
              <td style={td}>{n0(remainingOf(c))} {BASE_UNIT[c.packmat]}</td>
              <td style={{ ...td, fontSize: 12 }}>{c.location || "—"}</td>
            </tr>); })}</tbody>
          </table>}
      </Sec>
    </>}

    <div style={{ marginTop: 12 }}>
      <button onClick={() => exportXlsx(`analytics_${istToday()}.xlsx`, lineRows.map((l) => ({
        line: l.line, issued: Math.round(l.issued), returned: Math.round(l.returned), return_pct: l.rate.toFixed(1),
        carton: Math.round((l.pm.carton || {}).issued || 0), cld: Math.round((l.pm.cld || {}).issued || 0),
        laminate: Math.round((l.pm.laminate || {}).issued || 0), sac: Math.round((l.pm.sac || {}).issued || 0),
      })))} style={{ padding: "8px 14px", background: C.slate, color: "#fff", border: 0, borderRadius: 8, fontWeight: 600, cursor: "pointer" }}>
        Export line summary
      </button>
    </div>
  </div>);
}
