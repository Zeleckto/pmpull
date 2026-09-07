// Commercial analytics. Everything here is computed from tables you already have —
// no new writes, no new schema. Pick a window (today / 7 / 30 days / all) and it recomputes.
//
//   Lines        — issued vs returned per machine line, and the return rate. A line that
//                  keeps sending material back is either over-drawing or has a quality issue.
//   Kasani GR    — receipts, quantity in, how much got rejected, and how long quality takes.
//   ILT / trucks — planned vs sent vs signed off, average fill, and how long sign-off takes.
//   Fulfilment   — shortfall asks the store raised, and how long Kasani took to send them.
//   Stock ageing — the oldest invoice still sitting on the shelf per material.
import React from "react";
import { LBL, BASE_UNIT, grStatus, C, card, th, td, exportXlsx } from "./shared";
import { remainingOf } from "./dataKasani";

const DAY = 86400000;
const hoursBetween = (a, b) => (new Date(b) - new Date(a)) / 3600000;
const fmtH = (h) => (h == null ? "—" : h < 24 ? `${h.toFixed(1)} h` : `${(h / 24).toFixed(1)} d`);
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);

export default function Analytics({ ledger, cons, disp, reqs, skus, days, setDays }) {
  const since = days === 0 ? null : new Date(Date.now() - days * DAY);
  const inWin = (ts) => !since || (ts && new Date(ts) >= since);

  const led = ledger.filter((e) => inWin(e.ts));
  const grs = cons.filter((c) => inWin(c.received_at || c.ts));
  const trucks = disp.filter((d) => inWin(d.ts));
  const asks = reqs.filter((r) => inWin(r.ts));

  // ---------- per line ----------
  const lineMap = {};
  led.forEach((e) => {
    const ln = (e.line || "").trim();
    if (!ln) return;                                  // receives/adjusts carry no line
    const k = ln.toUpperCase();
    if (!lineMap[k]) lineMap[k] = { line: k, issued: 0, returned: 0, issues: 0, returns: 0, packmats: new Set() };
    const q = Math.abs(Number(e.qty_base) || 0);
    if (e.direction === "issue") { lineMap[k].issued += q; lineMap[k].issues++; lineMap[k].packmats.add(e.packmat); }
    if (e.direction === "return") { lineMap[k].returned += q; lineMap[k].returns++; lineMap[k].packmats.add(e.packmat); }
  });
  const lines = Object.values(lineMap)
    .map((l) => ({ ...l, net: l.issued - l.returned, rate: l.issued ? (l.returned / l.issued) * 100 : 0 }))
    .sort((a, b) => b.rate - a.rate || b.issued - a.issued);
  const totIssued = lines.reduce((a, l) => a + l.issued, 0);
  const totReturned = lines.reduce((a, l) => a + l.returned, 0);

  // ---------- PM store movements ----------
  const dirTotal = (d) => led.filter((e) => e.direction === d).reduce((a, e) => a + Math.abs(Number(e.qty_base) || 0), 0);
  const blocked = dirTotal("block"), scrapped = dirTotal("scrap"), released = dirTotal("unblock");

  // ---------- Kasani GR ----------
  const grQty = grs.reduce((a, c) => a + (Number(c.qty_base) || 0), 0);
  const rejected = grs.filter((c) => c.status === "rejected");
  const rejQty = rejected.reduce((a, c) => a + (Number(c.qty_base) || 0), 0);
  const qcHours = grs.filter((c) => c.sample_sent_at && c.cleared_at).map((c) => hoursBetween(c.sample_sent_at, c.cleared_at));
  const waitHours = grs.filter((c) => c.status === "pending").map((c) => hoursBetween(c.received_at || c.ts, new Date()));
  const bySupplier = {};
  grs.forEach((c) => {
    const k = (c.supplier || "unknown").trim() || "unknown";
    if (!bySupplier[k]) bySupplier[k] = { supplier: k, n: 0, qty: 0, rej: 0 };
    bySupplier[k].n++; bySupplier[k].qty += Number(c.qty_base) || 0;
    if (c.status === "rejected") bySupplier[k].rej++;
  });
  const suppliers = Object.values(bySupplier).sort((a, b) => b.n - a.n).slice(0, 8);

  // ---------- trucks / ILT ----------
  const planned = trucks.filter((d) => d.status === "planned");
  const sent = trucks.filter((d) => d.dispatched_at);
  const signed = trucks.filter((d) => d.ilt_done);
  const fills = trucks.filter((d) => d.fill_pct != null).map((d) => Number(d.fill_pct));
  const iltHours = trucks.filter((d) => d.dispatched_at && d.ilt_sent_at).map((d) => hoursBetween(d.dispatched_at, d.ilt_sent_at));

  // ---------- fulfilment ----------
  const askQty = asks.reduce((a, r) => a + (Number(r.qty_base) || 0), 0);
  const sentAsks = asks.filter((r) => r.dispatched_at);
  const openAsks = asks.filter((r) => r.status === "open");
  const fulfilHours = sentAsks.map((r) => hoursBetween(r.ts, r.dispatched_at));
  const byPrio = [1, 2, 3].map((p) => {
    const g = asks.filter((r) => r.priority === p);
    const done = g.filter((r) => r.dispatched_at);
    return { p, shift: "ABC"[p - 1], n: g.length, done: done.length, h: avg(done.map((r) => hoursBetween(r.ts, r.dispatched_at))) };
  });

  // ---------- stock ageing ----------
  const ageing = cons
    .filter((c) => c.status === "cleared" && remainingOf(c) > 0)
    .map((c) => ({ ...c, age: (Date.now() - new Date(c.received_at || c.ts)) / DAY }))
    .sort((a, b) => b.age - a.age).slice(0, 10);

  const exportAll = () => exportXlsx(`analytics_${new Date().toISOString().slice(0, 10)}.xlsx`, [
    ...lines.map((l) => ({ section: "line", key: l.line, issued: Math.round(l.issued), returned: Math.round(l.returned), return_pct: l.rate.toFixed(1) })),
    ...suppliers.map((s) => ({ section: "supplier", key: s.supplier, receipts: s.n, qty: Math.round(s.qty), rejected: s.rej })),
    { section: "trucks", key: "planned/sent/signed", issued: planned.length, returned: sent.length, return_pct: signed.length },
  ]);

  const Kpi = ({ label, val, sub, color }) => (<div style={{ ...card, marginBottom: 0, minWidth: 148, flex: "1 1 148px" }}>
    <div style={{ fontSize: 12, color: C.muted }}>{label}</div>
    <div style={{ fontSize: 23, fontWeight: 700, color: color || C.ink }}>{val}</div>
    {sub && <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{sub}</div>}
  </div>);
  const Section = ({ title, hint, children }) => (<div style={card}>
    <b>{title}</b>
    {hint && <div style={{ fontSize: 12, color: C.muted, margin: "4px 0 10px" }}>{hint}</div>}
    {children}
  </div>);
  const Win = ({ d, children }) => (<button onClick={() => setDays(d)} style={{
    padding: "6px 13px", borderRadius: 8, marginRight: 6, fontWeight: 600, fontSize: 13, cursor: "pointer",
    border: `1px solid ${C.line}`, background: days === d ? C.slate : "#fff", color: days === d ? "#fff" : "#334155",
  }}>{children}</button>);

  return (<div>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
      <div><Win d={1}>Today</Win><Win d={7}>7 days</Win><Win d={30}>30 days</Win><Win d={0}>All time</Win></div>
      <button onClick={exportAll} style={{ padding: "8px 14px", background: C.slate, color: "#fff", border: 0, borderRadius: 8, fontWeight: 600, cursor: "pointer" }}>Export analytics</button>
    </div>

    {/* ---------- headline ---------- */}
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
      <Kpi label="Issued to lines" val={Math.round(totIssued).toLocaleString()} sub="base units" />
      <Kpi label="Returned by lines" val={Math.round(totReturned).toLocaleString()} sub={`${pct(totReturned, totIssued)}% of issued`} color={pct(totReturned, totIssued) > 10 ? C.red : C.green} />
      <Kpi label="GR receipts" val={grs.length} sub={`${Math.round(grQty).toLocaleString()} units in`} />
      <Kpi label="Rejected at GR" val={`${pct(rejQty, grQty)}%`} sub={`${rejected.length} consignment(s)`} color={rejQty ? C.red : C.green} />
      <Kpi label="Trucks sent" val={sent.length} sub={`${planned.length} still to go`} />
      <Kpi label="ILT signed off" val={signed.length} sub={`${sent.length - signed.length} pending`} color={sent.length - signed.length ? C.amber : C.green} />
    </div>

    {/* ---------- per line ---------- */}
    <Section title={`Lines — issued vs returned (${lines.length})`}
      hint="Return rate is the headline: material going back to the store means it was over-drawn or rejected at the line. Returns only appear here once the store records the line on the return.">
      {lines.length === 0 ? <div style={{ color: C.muted, padding: 8 }}>No line-tagged movements in this window.</div> :
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th style={th}>Line</th><th style={th}>Issued</th><th style={th}>Returned</th><th style={th}>Net used</th><th style={th}>Return rate</th><th style={th}>Trips</th><th style={th}>Packmats</th></tr></thead>
          <tbody>{lines.map((l) => (<tr key={l.line}>
            <td style={{ ...td, fontWeight: 600 }}>{l.line}</td>
            <td style={td}>{Math.round(l.issued).toLocaleString()}</td>
            <td style={td}>{Math.round(l.returned).toLocaleString()}</td>
            <td style={td}>{Math.round(l.net).toLocaleString()}</td>
            <td style={td}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 90, height: 7, background: "#e2e8f0", borderRadius: 4 }}>
                  <div style={{ width: `${Math.min(100, l.rate)}%`, height: "100%", background: l.rate > 15 ? C.red : l.rate > 5 ? C.amber : C.green, borderRadius: 4 }} />
                </div>
                <b style={{ color: l.rate > 15 ? C.red : l.rate > 5 ? C.amber : C.green }}>{l.rate.toFixed(1)}%</b>
              </div>
            </td>
            <td style={{ ...td, fontSize: 12, color: C.muted }}>{l.issues} out / {l.returns} back</td>
            <td style={{ ...td, fontSize: 12, color: C.muted }}>{[...l.packmats].map((p) => LBL[p] || p).join(", ")}</td>
          </tr>))}</tbody>
        </table>}
    </Section>

    {/* ---------- fulfilment ---------- */}
    <Section title="Shortfall fulfilment — store asks vs Kasani dispatch"
      hint="How long a request waits between the store raising it and a truck leaving. Priority 1 is shift A, the urgent one.">
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <Kpi label="Asks raised" val={asks.length} sub={`${Math.round(askQty).toLocaleString()} units`} />
        <Kpi label="Dispatched" val={sentAsks.length} sub={`${pct(sentAsks.length, asks.length)}% of asks`} color={C.green} />
        <Kpi label="Still open" val={openAsks.length} color={openAsks.length ? C.amber : C.green} />
        <Kpi label="Avg time to dispatch" val={fmtH(avg(fulfilHours))} />
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr><th style={th}>Priority</th><th style={th}>Asks</th><th style={th}>Dispatched</th><th style={th}>Still open</th><th style={th}>Avg time to dispatch</th></tr></thead>
        <tbody>{byPrio.map((r) => (<tr key={r.p}>
          <td style={td}><span style={{ background: r.p === 1 ? C.red : r.p === 2 ? C.amber : C.blue, color: "#fff", borderRadius: 10, padding: "1px 8px", fontSize: 12, fontWeight: 700 }}>{r.p} · {r.shift}</span></td>
          <td style={td}>{r.n}</td><td style={td}>{r.done}</td><td style={td}>{r.n - r.done}</td>
          <td style={{ ...td, fontWeight: 600 }}>{fmtH(r.h)}</td>
        </tr>))}</tbody>
      </table>
    </Section>

    {/* ---------- GR / quality ---------- */}
    <Section title="Kasani goods received &amp; quality"
      hint="Rejection rate by supplier, and how long material sits before quality clears it.">
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <Kpi label="Receipts" val={grs.length} />
        <Kpi label="Quantity in" val={Math.round(grQty).toLocaleString()} />
        <Kpi label="Awaiting quality" val={grs.filter((c) => c.status === "pending").length} color={waitHours.length ? C.amber : C.green} sub={waitHours.length ? `oldest ${fmtH(Math.max(...waitHours))}` : null} />
        <Kpi label="Avg sample → clear" val={fmtH(avg(qcHours))} />
        <Kpi label="Rejected qty" val={Math.round(rejQty).toLocaleString()} sub={`${pct(rejQty, grQty)}% of intake`} color={rejQty ? C.red : C.green} />
      </div>
      {suppliers.length > 0 && <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr><th style={th}>Supplier</th><th style={th}>Receipts</th><th style={th}>Qty</th><th style={th}>Rejected</th><th style={th}>Reject rate</th></tr></thead>
        <tbody>{suppliers.map((s) => (<tr key={s.supplier}>
          <td style={{ ...td, fontWeight: 600 }}>{s.supplier}</td>
          <td style={td}>{s.n}</td><td style={td}>{Math.round(s.qty).toLocaleString()}</td><td style={td}>{s.rej}</td>
          <td style={{ ...td, fontWeight: 600, color: s.rej ? C.red : C.green }}>{pct(s.rej, s.n)}%</td>
        </tr>))}</tbody>
      </table>}
    </Section>

    {/* ---------- trucks ---------- */}
    <Section title="Trucks &amp; ILT"
      hint="Average fill tells you whether trucks are being used properly; sign-off lag is how long paperwork sits with Commercial.">
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Kpi label="Planned" val={planned.length} />
        <Kpi label="Sent" val={sent.length} />
        <Kpi label="Signed off" val={signed.length} color={C.green} />
        <Kpi label="Avg fill" val={avg(fills) == null ? "—" : `${Math.round(avg(fills))}%`} color={avg(fills) != null && avg(fills) < 70 ? C.amber : C.green} sub={avg(fills) != null && avg(fills) < 70 ? "under-loaded" : null} />
        <Kpi label="Avg sign-off lag" val={fmtH(avg(iltHours))} />
      </div>
    </Section>

    {/* ---------- PM store blocked / scrapped ---------- */}
    <Section title="Blocked &amp; written off at the PM store"
      hint="Material taken out of usable stock on quality grounds, and what happened to it since.">
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Kpi label="Blocked" val={Math.round(blocked).toLocaleString()} color={blocked ? C.red : C.green} />
        <Kpi label="Released back" val={Math.round(released).toLocaleString()} color={C.green} />
        <Kpi label="Scrapped" val={Math.round(scrapped).toLocaleString()} color={scrapped ? C.red : C.green} />
        <Kpi label="Still blocked" val={Math.round(Math.max(0, blocked - released - scrapped)).toLocaleString()} color={C.amber} />
      </div>
    </Section>

    {/* ---------- ageing ---------- */}
    <Section title="Oldest stock still at Kasani"
      hint="Longest-sitting cleared invoices. These are the ones FIFO should be pushing out first.">
      {ageing.length === 0 ? <div style={{ color: C.muted, padding: 8 }}>No cleared stock.</div> :
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th style={th}>Age</th><th style={th}>Material code</th><th style={th}>SKU</th><th style={th}>Packmat</th><th style={th}>Invoice</th><th style={th}>Qty left</th><th style={th}>Location</th></tr></thead>
          <tbody>{ageing.map((c) => (<tr key={c.id}>
            <td style={{ ...td, fontWeight: 700, color: c.age > 60 ? C.red : c.age > 30 ? C.amber : C.ink }}>{Math.round(c.age)} d</td>
            <td style={{ ...td, fontFamily: "monospace", fontSize: 12 }}>{c.packmat_code || "—"}</td>
            <td style={{ ...td, fontWeight: 600 }}>{c.sku_code || "—"}</td>
            <td style={td}>{LBL[c.packmat] || c.packmat}</td>
            <td style={td}>{c.invoice || "—"}</td>
            <td style={td}>{Math.round(remainingOf(c))} {BASE_UNIT[c.packmat]}</td>
            <td style={{ ...td, fontSize: 12 }}>{c.location || "—"}</td>
          </tr>))}</tbody>
        </table>}
    </Section>
  </div>);
}
