// Dispatch. The work list comes straight from the PM store: every shortfall the store
// asked for (kasani_requests) arrives here with its packmat code and the shift it is
// needed in. Shift A is loaded first, then B, then C.
//
// Trucks are filled to 90% using the capacities in Kasani -> Truck & unit settings.
// Saving writes a `dispatches` row per truck, stamps the requests as sent, and hands
// the truck to ILT (ilt_done = false) for the leadership dashboard to pick up.
import React, { useEffect, useState } from "react";
import {
  loadConsignments, loadDispatches, addDispatchReturning, kasaniOnHand,
  loadSkusK, loadPackConfig, loadKasaniRequestsOpen, markRequestsDispatched,
} from "../dataKasani";
import { LBL, BASE_UNIT, codeFor, C, btn, ghost, card, th, td, todayStr } from "../shared";

const FILL = 0.9;   // never load a truck past 90%
const PRIO_COLOR = (p) => (p === 1 ? C.red : p === 2 ? C.amber : C.blue);

export default function KasaniDispatch() {
  const [skus, setSkus] = useState([]);
  const [cfg, setCfg] = useState([]);
  const [cons, setCons] = useState([]);
  const [disp, setDisp] = useState([]);
  const [reqs, setReqs] = useState([]);
  const [sel, setSel] = useState({});          // request id -> included
  const [seq, setSeq] = useState(null);        // planned trucks, before saving
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setSkus(await loadSkusK());
    setCfg(await loadPackConfig());
    setCons(await loadConsignments());
    setDisp(await loadDispatches());
    const r = await loadKasaniRequestsOpen();
    setReqs(r);
    const s = {}; r.forEach((x) => { if (x.status === "open") s[x.id] = true; });
    setSel(s);
  };
  useEffect(() => { refresh(); }, []);

  const avail = kasaniOnHand(cons);            // cleared Kasani stock, base units
  const skuOf = (code) => skus.find((x) => x.code === code);
  const codeOf = (r) => r.packmat_code || (skuOf(r.sku_code) ? codeFor(skuOf(r.sku_code), r.packmat) : "") || "—";

  // truck capacity expressed in BASE units, for the largest variant that has a capacity set
  const capBase = (pm) => {
    const rows = (cfg || []).filter((r) => r.packmat === pm && r.truck_full_qty != null && r.base_per_unit != null);
    if (!rows.length) return null;
    const r = rows[0];
    return Number(r.truck_full_qty) * Number(r.base_per_unit);
  };

  const chosen = reqs.filter((r) => sel[r.id]);
  const noCap = [...new Set(chosen.map((r) => r.packmat))].filter((pm) => !capBase(pm));

  // ---- build the truck sequence: priority 1 (shift A) first, splitting big asks ----
  const plan = () => {
    const ordered = [...chosen].sort((a, b) => (a.priority || 9) - (b.priority || 9) || String(a.ts).localeCompare(String(b.ts)));
    const built = [];
    let cur = { lines: [], frac: 0, shifts: new Set(), reqIds: new Set() };
    const close = () => { if (cur.lines.length) built.push(cur); cur = { lines: [], frac: 0, shifts: new Set(), reqIds: new Set() }; };

    for (const r of ordered) {
      const cap = capBase(r.packmat);
      if (!cap) continue;                                  // no capacity configured -> can't plan it
      const have = avail[`${r.sku_code}|${r.packmat}`] || 0;
      let need = Math.round(Number(r.qty_base) || 0);
      const short = Math.max(0, need - Math.round(have));   // Kasani itself doesn't have enough
      need = Math.min(need, Math.round(have));
      if (need <= 0) continue;
      while (need > 0) {
        const room = FILL - cur.frac;
        let fits = Math.floor(room * cap);
        // A part-loaded truck that has no room gets closed and we start a fresh one.
        if (fits <= 0 && cur.lines.length) { close(); continue; }
        // An EMPTY truck must always take something, otherwise a bad capacity in
        // settings (e.g. truck_full_qty = 1) would spin this loop forever.
        if (fits <= 0) fits = need;
        const take = Math.min(need, fits);
        cur.lines.push({
          request_id: r.id, sku_code: r.sku_code, packmat: r.packmat,
          packmat_code: codeOf(r), qty_base: take, shift: r.shift, priority: r.priority, short,
        });
        cur.frac += take / cap;
        cur.shifts.add(r.shift);
        cur.reqIds.add(r.id);
        need -= take;
        if (cur.frac >= FILL - 0.02) close();
      }
    }
    close();
    setSeq(built);
    setMsg(built.length ? "" : "Nothing could be planned — either no requests are selected, or Kasani has no cleared stock for them.");
  };

  // ---- save: one dispatches row per truck, then stamp the requests ----
  const commit = async () => {
    if (!seq || !seq.length) return;
    setBusy(true);
    let n = disp.length;
    for (const t of seq) {
      n++;
      const { data, error } = await addDispatchReturning({
        plan_date: todayStr(), truck_no: n, lines: t.lines,
        fill_pct: Math.round(t.frac * 100), shift: [...t.shifts].sort().join("/"),
        status: "planned", ilt_done: false,
      });
      if (error) { setBusy(false); setMsg(`Error: ${error.message || error}`); return; }
      await markRequestsDispatched([...t.reqIds], data ? data.id : null);
    }
    setBusy(false);
    setSeq(null);
    setMsg(`${seq.length} truck(s) planned and handed to ILT.`);
    refresh();
  };

  const openTrucks = disp.filter((d) => !d.ilt_done);

  return (<div>
    {/* ---- what the PM store is asking for ---- */}
    <div style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
        <b>Requests from PM store ({reqs.length})</b>
        <button onClick={refresh} style={ghost}>Refresh</button>
      </div>
      <div style={{ fontSize: 13, color: C.muted, marginBottom: 10 }}>
        These come straight from the store's shortfall. <b>Priority 1 = shift A</b> (needed now), then 2 = B, 3 = C. Untick anything you are not sending.
      </div>

      {reqs.length === 0 ? <div style={{ color: C.muted, padding: 10 }}>Nothing pending. When the PM store presses “Ask Kasani”, it appears here.</div> :
        <div style={{ maxHeight: 340, overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              <th style={th}></th><th style={th}>Priority</th><th style={th}>SKU</th><th style={th}>Packmat</th>
              <th style={th}>Code</th><th style={th}>Asked</th><th style={th}>Cleared here</th><th style={th}>Status</th>
            </tr></thead>
            <tbody>{reqs.map((r) => {
              const have = Math.round(avail[`${r.sku_code}|${r.packmat}`] || 0);
              const enough = have >= Math.round(r.qty_base);
              return (<tr key={r.id}>
                <td style={td}><input type="checkbox" checked={!!sel[r.id]} onChange={(e) => setSel({ ...sel, [r.id]: e.target.checked })} /></td>
                <td style={td}><span style={{ background: PRIO_COLOR(r.priority), color: "#fff", borderRadius: 10, padding: "1px 8px", fontSize: 12, fontWeight: 700 }}>{r.priority} · {r.shift}</span></td>
                <td style={{ ...td, fontWeight: 600 }}>{r.sku_code}</td>
                <td style={td}>{LBL[r.packmat] || r.packmat}</td>
                <td style={{ ...td, fontFamily: "monospace", fontSize: 12, color: C.muted }}>{codeOf(r)}</td>
                <td style={td}>{Math.round(r.qty_base)} {BASE_UNIT[r.packmat]}</td>
                <td style={{ ...td, fontWeight: 600, color: enough ? C.green : C.red }}>{have} {enough ? "" : "· short"}</td>
                <td style={{ ...td, fontSize: 12, color: r.status === "sent" ? C.amber : C.muted }}>{r.status}</td>
              </tr>);
            })}</tbody>
          </table>
        </div>}

      {noCap.length > 0 && <div style={{ fontSize: 13, color: C.amber, background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "8px 10px", marginTop: 10 }}>
        ⚠ No truck capacity set for {noCap.map((p) => LBL[p] || p).join(", ")}. Those lines will be skipped — set it in <b>Truck &amp; unit settings</b>.
      </div>}

      <button onClick={plan} disabled={!chosen.length} style={{ ...btn(chosen.length ? C.slate : "#94a3b8"), marginTop: 12, cursor: chosen.length ? "pointer" : "not-allowed" }}>
        Plan trucks for {chosen.length} request(s)
      </button>
      {msg && <div style={{ fontSize: 13, marginTop: 10, color: /error|Nothing/i.test(msg) ? C.red : C.green }}>{msg}</div>}
    </div>

    {/* ---- the proposed load ---- */}
    {seq && seq.length > 0 && <div style={card}>
      <b>Proposed load — {seq.length} truck(s)</b>
      <div style={{ fontSize: 12, color: C.muted, margin: "4px 0 12px" }}>
        Filled to at most {Math.round(FILL * 100)}%, shift A first. Anything Kasani does not have cleared stock for is left out.
      </div>
      {seq.map((t, i) => (<div key={i} style={{ border: `1px solid ${C.line}`, borderRadius: 10, padding: 12, marginBottom: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <b>Truck {i + 1}</b>
          <span style={{ fontSize: 13, color: C.muted }}>shift {[...t.shifts].sort().join("/")} · {Math.round(t.frac * 100)}% full</span>
        </div>
        <div style={{ height: 8, background: "#e2e8f0", borderRadius: 4, margin: "8px 0" }}>
          <div style={{ width: `${Math.min(100, Math.round(t.frac * 100))}%`, height: "100%", background: C.green, borderRadius: 4 }} />
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th style={th}>SKU</th><th style={th}>Packmat</th><th style={th}>Code</th><th style={th}>Qty</th><th style={th}>Shift</th></tr></thead>
          <tbody>{t.lines.map((l, j) => (<tr key={j}>
            <td style={{ ...td, fontWeight: 600 }}>{l.sku_code}</td>
            <td style={td}>{LBL[l.packmat]}</td>
            <td style={{ ...td, fontFamily: "monospace", fontSize: 12, color: C.muted }}>{l.packmat_code}</td>
            <td style={td}>{Math.round(l.qty_base)} {BASE_UNIT[l.packmat]}</td>
            <td style={td}>{l.shift}</td>
          </tr>))}</tbody>
        </table>
      </div>))}
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => setSeq(null)} style={{ ...ghost, flex: 1 }}>Discard</button>
        <button onClick={commit} disabled={busy} style={{ ...btn(C.green), flex: 2 }}>{busy ? "Saving…" : "Confirm dispatch → send to ILT"}</button>
      </div>
    </div>}

    {/* ---- trucks already planned, waiting on ILT ---- */}
    <div style={card}>
      <b>Trucks awaiting ILT ({openTrucks.length})</b>
      <div style={{ fontSize: 12, color: C.muted, margin: "4px 0 10px" }}>Confirmed loads. Leadership signs these off on the ILT dashboard.</div>
      {openTrucks.length === 0 ? <div style={{ color: C.muted, padding: 8 }}>None waiting.</div> :
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th style={th}>Truck</th><th style={th}>Date</th><th style={th}>Shift</th><th style={th}>Lines</th><th style={th}>Fill</th><th style={th}>Status</th></tr></thead>
          <tbody>{openTrucks.map((d) => (<tr key={d.id}>
            <td style={{ ...td, fontWeight: 600 }}>#{d.truck_no}</td>
            <td style={td}>{d.plan_date}</td>
            <td style={td}>{d.shift || "—"}</td>
            <td style={td}>{(d.lines || []).length}</td>
            <td style={td}>{d.fill_pct}%</td>
            <td style={{ ...td, color: C.amber, fontWeight: 600 }}>ILT pending</td>
          </tr>))}</tbody>
        </table>}
    </div>
  </div>);
}
