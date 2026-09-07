// Dispatch. Work list comes straight from the PM store (kasani_requests): SKU, description,
// material code, and the shift it is needed in. Not-yet-sent sit on top, already-sent drop
// to the bottom greyed out.
//
// Flow:  plan trucks  ->  edit each truck (change qty, remove a line, add material)
//        ->  Save plan (a reservation only, no stock moves)
//        ->  Send ILT per truck: raises a challan, stamps the time, draws stock down FIFO
//            and closes the requests on that truck.
import React, { useEffect, useState } from "react";
import {
  loadConsignments, loadDispatches, addDispatchReturning, setDispatch, kasaniOnHand,
  loadSkusK, loadPackConfig, loadKasaniRequestsOpen, stockByMaterial, sendIlt,
} from "../dataKasani";
import { LBL, BASE_UNIT, codeFor, C, btn, ghost, card, inp, th, td, todayStr } from "../shared";

const FILL = 0.9;   // never load a truck past 90%
const PRIO_COLOR = (p) => (p === 1 ? C.red : p === 2 ? C.amber : C.blue);
const challanFor = (d) => `ILT-${String(d.plan_date || todayStr()).replace(/-/g, "")}-${String(d.truck_no).padStart(3, "0")}`;

export default function KasaniDispatch() {
  const [skus, setSkus] = useState([]);
  const [cfg, setCfg] = useState([]);
  const [cons, setCons] = useState([]);
  const [disp, setDisp] = useState([]);
  const [reqs, setReqs] = useState([]);
  const [sel, setSel] = useState({});
  const [expand, setExpand] = useState({});    // request id -> show detail
  const [seq, setSeq] = useState(null);        // editable plan, before saving
  const [addTo, setAddTo] = useState(null);    // {truck index} while adding a line
  const [draft, setDraft] = useState({ key: "", qty: "", q: "" });
  const [ilt, setIlt] = useState(null);        // truck being sent
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

  const avail = kasaniOnHand(cons);
  const materials = stockByMaterial(cons);
  const skuOf = (code) => skus.find((x) => x.code === code);
  const descOf = (r) => r.sku_desc || (skuOf(r.sku_code) || {}).description || "";
  const codeOf = (r) => r.packmat_code || (skuOf(r.sku_code) ? codeFor(skuOf(r.sku_code), r.packmat) : "") || "—";
  const matOf = (sku, pm) => materials.find((m) => m.sku_code === sku && m.packmat === pm);

  // truck capacity in BASE units, from the first variant that has both numbers set
  const capBase = (pm) => {
    const r = (cfg || []).find((x) => x.packmat === pm && x.truck_full_qty != null && x.base_per_unit != null);
    return r ? Number(r.truck_full_qty) * Number(r.base_per_unit) : null;
  };
  const fracOf = (lines) => (lines || []).reduce((a, l) => {
    const cap = capBase(l.packmat);
    return a + (cap ? (Number(l.qty_base) || 0) / cap : 0);
  }, 0);

  // not-sent first, sent to the bottom
  const openReqs = reqs.filter((r) => r.status !== "sent");
  const sentReqs = reqs.filter((r) => r.status === "sent");
  const chosen = openReqs.filter((r) => sel[r.id]);
  const noCap = [...new Set(chosen.map((r) => r.packmat))].filter((pm) => !capBase(pm));

  // ---------- planning ----------
  const plan = () => {
    const ordered = [...chosen].sort((a, b) => (a.priority || 9) - (b.priority || 9) || String(a.ts).localeCompare(String(b.ts)));
    const built = []; let cur = [];
    const close = () => { if (cur.length) built.push(cur); cur = []; };
    for (const r of ordered) {
      const cap = capBase(r.packmat);
      if (!cap) continue;
      // PILOT: plan the full ask even when Kasani is short — stock may go negative.
      let need = Math.round(Number(r.qty_base) || 0);
      const short = Math.max(0, need - Math.round(avail[`${r.sku_code}|${r.packmat}`] || 0));
      if (need <= 0) continue;
      while (need > 0) {
        const room = FILL - fracOf(cur);
        let fits = Math.floor(room * cap);
        if (fits <= 0 && cur.length) { close(); continue; }
        if (fits <= 0) fits = need;
        const take = Math.min(need, fits);
        cur.push({ request_id: r.id, sku_code: r.sku_code, sku_desc: descOf(r), packmat: r.packmat, packmat_code: codeOf(r), qty_base: take, shift: r.shift, priority: r.priority, short });
        need -= take;
        if (fracOf(cur) >= FILL - 0.02) close();
      }
    }
    close();
    setSeq(built);
    setMsg(built.length ? "" : "Nothing to plan — select some requests, and make sure their packmats have a truck capacity set.");
  };

  // ---------- editing the plan ----------
  const editLine = (ti, li, qty) => setSeq(seq.map((t, i) => i !== ti ? t : t.map((l, j) => j !== li ? l : { ...l, qty_base: Number(qty) || 0 })));
  const dropLine = (ti, li) => setSeq(seq.map((t, i) => i !== ti ? t : t.filter((_, j) => j !== li)));
  // Move a line to another truck. Real trucks fill up before our maths says they should,
  // so the loader needs to be able to shunt a line onto the next one.
  const moveLine = (ti, li, to) => {
    const target = to === "new" ? seq.length : Number(to);
    if (target === ti) return;
    const line = seq[ti][li];
    const next = seq.map((t, i) => i !== ti ? t.slice() : t.filter((_, j) => j !== li));
    if (to === "new") next.push([line]); else next[target] = [...next[target], line];
    setSeq(next);
  };
  const dropTruck = (ti) => setSeq(seq.filter((_, i) => i !== ti));
  const addTruck = () => setSeq([...(seq || []), []]);
  const addLine = () => {
    const m = materials.find((x) => `${x.sku_code}|${x.packmat}` === draft.key);
    const qty = Number(draft.qty) || 0;
    if (!m || !qty) { setMsg("Pick a material and a quantity."); return; }
    const req = openReqs.find((r) => r.sku_code === m.sku_code && r.packmat === m.packmat);
    setSeq(seq.map((t, i) => i !== addTo ? t : [...t, {
      request_id: req ? req.id : null, sku_code: m.sku_code, sku_desc: m.sku_desc || descOf({ sku_code: m.sku_code }),
      packmat: m.packmat, packmat_code: m.packmat_code || "—", qty_base: qty,
      shift: req ? req.shift : "A", priority: req ? req.priority : 9,
      short: Math.max(0, qty - Math.round(m.qty)),
    }]));
    setAddTo(null); setDraft({ key: "", qty: "", q: "" }); setMsg("");
  };

  // ---------- save (reservation only) ----------
  const savePlan = async () => {
    if (!seq || !seq.length) return;
    setBusy(true);
    let n = disp.length;
    for (const lines of seq) {
      if (!lines.length) continue;
      n++;
      const { error } = await addDispatchReturning({
        plan_date: todayStr(), truck_no: n, lines,
        fill_pct: Math.round(fracOf(lines) * 100),
        shift: [...new Set(lines.map((l) => l.shift))].sort().join("/"),
        status: "planned", ilt_done: false,
      });
      if (error) { setBusy(false); setMsg(`Error: ${error.message || error}`); return; }
    }
    setBusy(false); setSeq(null);
    setMsg(`${seq.filter((t) => t.length).length} truck(s) saved. Send each one for ILT when it is loaded.`);
    refresh();
  };

  // ---------- send one truck for ILT ----------
  const doSendIlt = async () => {
    if (!ilt) return;
    setBusy(true);
    const { error, challan } = await sendIlt(ilt, challanFor(ilt));
    setBusy(false);
    if (error) { setMsg(`Error: ${error.message || error}`); return; }
    setMsg(`Truck #${ilt.truck_no} sent — challan ${challan}. Stock drawn down and requests closed.`);
    setIlt(null); refresh();
  };

  const planned = disp.filter((d) => d.status === "planned");
  // only trucks still waiting on Commercial — once ILT is signed off they leave this screen
  const sentTrucks = disp.filter((d) => d.status === "dispatched" && !d.ilt_done);

  const ReqRow = ({ r, dim }) => {
    const have = Math.round(avail[`${r.sku_code}|${r.packmat}`] || 0);
    const asked = Math.round(r.qty_base);
    const m = matOf(r.sku_code, r.packmat);
    return (<React.Fragment>
      <tr style={{ opacity: dim ? 0.55 : 1, background: dim ? "#f8fafc" : "transparent" }}>
        <td style={td}>{!dim && <input type="checkbox" checked={!!sel[r.id]} onChange={(e) => setSel({ ...sel, [r.id]: e.target.checked })} />}</td>
        <td style={td}><span style={{ background: PRIO_COLOR(r.priority), color: "#fff", borderRadius: 10, padding: "1px 8px", fontSize: 12, fontWeight: 700 }}>{r.priority} · {r.shift}</span></td>
        <td style={{ ...td, fontWeight: 600 }}>{r.sku_code}</td>
        <td style={{ ...td, color: C.muted, fontSize: 13 }}>{descOf(r).slice(0, 30) || "—"}</td>
        <td style={td}>{LBL[r.packmat] || r.packmat}</td>
        <td style={{ ...td, fontFamily: "monospace", fontSize: 12 }}>{codeOf(r)}</td>
        <td style={td}>{asked} {BASE_UNIT[r.packmat]}</td>
        <td style={{ ...td, fontWeight: 600, color: have >= asked ? C.green : C.red }}>{have}{have >= asked ? "" : ` · short ${asked - have}`}</td>
        <td style={td}><button onClick={() => setExpand({ ...expand, [r.id]: !expand[r.id] })} style={{ ...ghost, padding: "3px 9px", fontSize: 12 }}>{expand[r.id] ? "Hide" : "Details"}</button></td>
      </tr>
      {expand[r.id] && <tr><td colSpan={9} style={{ ...td, background: "#f8fafc" }}>
        <div style={{ display: "flex", gap: 22, flexWrap: "wrap", fontSize: 13, marginBottom: 8 }}>
          <span><b>SKU</b> {r.sku_code}</span>
          <span><b>Description</b> {descOf(r) || "—"}</span>
          <span><b>Packmat</b> {LBL[r.packmat]}</span>
          <span><b>Material code</b> <code>{codeOf(r)}</code></span>
          <span><b>Asked</b> {asked} {BASE_UNIT[r.packmat]}</span>
          <span><b>Needed in</b> shift {r.shift}</span>
          <span><b>Asked on</b> {String(r.ts || "").slice(0, 16).replace("T", " ")}</span>
          {r.plan_date && <span><b>For</b> {r.plan_date}</span>}
        </div>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, marginBottom: 4 }}>WHERE THIS STOCK IS — oldest invoice first</div>
        {!m || !m.invoices.length ? <div style={{ fontSize: 13, color: C.red }}>No cleared stock at Kasani for this material.</div> :
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th style={th}>Pick order</th><th style={th}>Invoice</th><th style={th}>Received</th><th style={th}>Qty left</th><th style={th}>Location</th></tr></thead>
            <tbody>{m.invoices.map((iv, n) => (<tr key={iv.id}>
              <td style={{ ...td, fontWeight: n === 0 ? 700 : 400, color: n === 0 ? C.green : C.muted }}>{n === 0 ? "→ pick now" : `${n + 1}`}</td>
              <td style={td}>{iv.invoice || "—"}</td>
              <td style={{ ...td, fontSize: 12 }}>{String(iv.received_at || "").slice(0, 10)}</td>
              <td style={td}>{Math.round(iv.qty)} {BASE_UNIT[r.packmat]}</td>
              <td style={{ ...td, fontWeight: n === 0 ? 700 : 400 }}>{iv.location || "—"}</td>
            </tr>))}</tbody>
          </table>}
      </td></tr>}
    </React.Fragment>);
  };

  return (<div>
    {/* ---------- requests ---------- */}
    <div style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
        <b>Requests from PM store — {openReqs.length} to send{sentReqs.length ? `, ${sentReqs.length} already sent` : ""}</b>
        <button onClick={refresh} style={ghost}>Refresh</button>
      </div>
      <div style={{ fontSize: 13, color: C.muted, marginBottom: 10 }}>
        <b>Priority 1 = shift A</b> (needed now), then 2 = B, 3 = C. Open <b>Details</b> to see the description and which invoice to pick from.
      </div>
      {reqs.length === 0 ? <div style={{ color: C.muted, padding: 10 }}>Nothing pending. When the PM store presses “Ask Kasani”, it appears here.</div> :
        <div style={{ maxHeight: 420, overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              <th style={th}></th><th style={th}>Priority</th><th style={th}>SKU</th><th style={th}>Description</th>
              <th style={th}>Packmat</th><th style={th}>Code</th><th style={th}>Asked</th><th style={th}>Cleared here</th><th style={th}></th>
            </tr></thead>
            <tbody>
              {openReqs.map((r) => <ReqRow key={r.id} r={r} />)}
              {sentReqs.length > 0 && <tr><td colSpan={9} style={{ ...td, background: "#f1f5f9", fontSize: 12, fontWeight: 700, color: C.muted }}>ALREADY SENT</td></tr>}
              {sentReqs.map((r) => <ReqRow key={r.id} r={r} dim />)}
            </tbody>
          </table>
        </div>}

      {noCap.length > 0 && <div style={{ fontSize: 13, color: C.amber, background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "8px 10px", marginTop: 10 }}>
        ⚠ No truck capacity set for {noCap.map((p) => LBL[p] || p).join(", ")} — those lines are skipped. Set it in <b>Truck &amp; unit settings</b>.
      </div>}

      <button onClick={plan} disabled={!chosen.length} style={{ ...btn(chosen.length ? C.slate : "#94a3b8"), marginTop: 12, cursor: chosen.length ? "pointer" : "not-allowed" }}>
        Plan trucks for {chosen.length} request(s)
      </button>
      {msg && <div style={{ fontSize: 13, marginTop: 10, padding: "8px 10px", borderRadius: 8, background: /error|Nothing|Pick a/i.test(msg) ? "#fef2f2" : "#f0fdf4", color: /error|Nothing|Pick a/i.test(msg) ? C.red : C.green }}>{msg}</div>}
    </div>

    {/* ---------- editable plan ---------- */}
    {seq && <div style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <b>Proposed load — {seq.filter((t) => t.length).length} truck(s)</b>
        <button onClick={addTruck} style={ghost}>+ Add empty truck</button>
      </div>
      <div style={{ fontSize: 12, color: C.muted, margin: "4px 0 12px" }}>
        Change any quantity, drop a line, or add material to a truck before saving. Filled to at most {Math.round(FILL * 100)}%, shift A first.
        The full ask is planned even where Kasani is short — those lines show <b>short</b> and will push stock negative.
      </div>
      {seq.map((lines, ti) => {
        const frac = fracOf(lines);
        return (<div key={ti} style={{ border: `1px solid ${C.line}`, borderRadius: 10, padding: 12, marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <b>Truck {ti + 1}</b>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 13, color: frac > FILL ? C.red : C.muted }}>
                {[...new Set(lines.map((l) => l.shift))].sort().join("/") || "—"} · {Math.round(frac * 100)}% full{frac > FILL ? " — over" : ""}
              </span>
              <button onClick={() => setAddTo(ti)} style={{ ...ghost, padding: "4px 10px", fontSize: 13 }}>+ Add material</button>
              <button onClick={() => dropTruck(ti)} style={{ ...ghost, padding: "4px 10px", fontSize: 13, color: C.red }}>Remove truck</button>
            </div>
          </div>
          <div style={{ height: 8, background: "#e2e8f0", borderRadius: 4, margin: "8px 0" }}>
            <div style={{ width: `${Math.min(100, Math.round(frac * 100))}%`, height: "100%", background: frac > FILL ? C.red : C.green, borderRadius: 4 }} />
          </div>
          {lines.length === 0 ? <div style={{ fontSize: 13, color: C.muted, padding: 6 }}>Empty — add material or remove the truck.</div> :
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr><th style={th}>SKU</th><th style={th}>Description</th><th style={th}>Packmat</th><th style={th}>Code</th><th style={th}>Qty</th><th style={th}>Shift</th><th style={th}>Stock</th><th style={th}>Move / remove</th></tr></thead>
              <tbody>{lines.map((l, li) => (<tr key={li}>
                <td style={{ ...td, fontWeight: 600 }}>{l.sku_code}</td>
                <td style={{ ...td, color: C.muted, fontSize: 13 }}>{(l.sku_desc || "").slice(0, 24) || "—"}</td>
                <td style={td}>{LBL[l.packmat]}</td>
                <td style={{ ...td, fontFamily: "monospace", fontSize: 12 }}>{l.packmat_code}</td>
                <td style={td}><input type="number" value={l.qty_base} onChange={(e) => editLine(ti, li, e.target.value)} style={{ ...inp, width: 110 }} /> <span style={{ fontSize: 12, color: C.muted }}>{BASE_UNIT[l.packmat]}</span></td>
                <td style={td}>{l.shift}</td>
                <td style={{ ...td, fontSize: 12, color: l.short > 0 ? C.red : C.muted }}>{l.short > 0 ? `short ${l.short}` : "covered"}</td>
                <td style={{ ...td, whiteSpace: "nowrap" }}>
                  <select value="" onChange={(e) => { if (e.target.value !== "") moveLine(ti, li, e.target.value); }}
                    title="Move this line to another truck" style={{ ...inp, width: 104, marginRight: 6, fontSize: 12 }}>
                    <option value="">move to…</option>
                    {seq.map((_, k) => k !== ti && <option key={k} value={k}>Truck {k + 1}</option>)}
                    <option value="new">＋ new truck</option>
                  </select>
                  <button onClick={() => dropLine(ti, li)} title="Remove this line" style={{ ...ghost, padding: "3px 9px", fontSize: 12, color: C.red }}>✕</button>
                </td>
              </tr>))}</tbody>
            </table>}
        </div>);
      })}
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => setSeq(null)} style={{ ...ghost, flex: 1 }}>Discard plan</button>
        <button onClick={savePlan} disabled={busy || !seq.some((t) => t.length)} style={{ ...btn(C.green), flex: 2 }}>{busy ? "Saving…" : "Save plan"}</button>
      </div>
    </div>}

    {/* ---------- trucks waiting to go ---------- */}
    <div style={card}>
      <b>Trucks ready to send ({planned.length})</b>
      <div style={{ fontSize: 12, color: C.muted, margin: "4px 0 10px" }}>
        Send them one at a time. Sending raises the challan, stamps the dispatch time, draws the stock off the oldest invoice and closes those requests.
      </div>
      {planned.length === 0 ? <div style={{ color: C.muted, padding: 8 }}>None waiting. Plan and save some above.</div> :
        planned.map((d) => (<div key={d.id} style={{ border: `1px solid ${C.line}`, borderLeft: `5px solid ${C.amber}`, borderRadius: 10, padding: 12, marginBottom: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div><b>Truck #{d.truck_no}</b>
              <span style={{ color: C.muted, fontSize: 13, marginLeft: 8 }}>{d.plan_date} · shift {d.shift || "—"} · {(d.lines || []).length} line(s) · {d.fill_pct}% full</span></div>
            <button onClick={() => setIlt(d)} style={btn(C.green)}>Send ILT →</button>
          </div>
        </div>))}
    </div>

    {/* ---------- already sent ---------- */}
    {sentTrucks.length > 0 && <div style={card}>
      <b>Sent — awaiting Commercial ({sentTrucks.length})</b>
      <div style={{ fontSize: 12, color: C.muted, margin: "4px 0 6px" }}>These drop off this screen as soon as Commercial signs the ILT off.</div>
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
        <thead><tr><th style={th}>Truck</th><th style={th}>Challan</th><th style={th}>Dispatched</th><th style={th}>Shift</th><th style={th}>Lines</th><th style={th}>Status</th></tr></thead>
        <tbody>{sentTrucks.map((d) => (<tr key={d.id} style={{ opacity: 0.75 }}>
          <td style={{ ...td, fontWeight: 600 }}>#{d.truck_no}</td>
          <td style={{ ...td, fontFamily: "monospace", fontSize: 12 }}>{d.challan || "—"}</td>
          <td style={{ ...td, fontSize: 12 }}>{String(d.dispatched_at || "").slice(0, 16).replace("T", " ")}</td>
          <td style={td}>{d.shift || "—"}</td>
          <td style={td}>{(d.lines || []).length}</td>
          <td style={{ ...td, fontWeight: 600, color: C.amber }}>awaiting commercial</td>
        </tr>))}</tbody>
      </table>
    </div>}

    {/* ---------- add material to a truck: search on code / SKU / description / type ---------- */}
    {addTo !== null && <div onClick={() => { setAddTo(null); setDraft({ key: "", qty: "", q: "" }); }} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 50 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 12, padding: 20, width: "100%", maxWidth: 760, maxHeight: "88vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <b style={{ fontSize: 16 }}>Add material to Truck {addTo + 1}</b>
          <input autoFocus placeholder="search code / SKU / description / type" value={draft.q || ""}
            onChange={(e) => setDraft({ ...draft, q: e.target.value })} style={{ ...inp, width: 300 }} />
        </div>
        <div style={{ fontSize: 12, color: C.muted, margin: "6px 0 10px" }}>
          Cleared Kasani stock. You can load more than the store asked for — type any quantity; going past what is on the shelf just shows a warning.
        </div>
        <div style={{ maxHeight: "44vh", overflowY: "auto", marginBottom: 12 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th style={th}></th><th style={th}>Material code</th><th style={th}>SKU</th><th style={th}>Description</th><th style={th}>Type</th><th style={th}>Available</th><th style={th}>Location</th></tr></thead>
            <tbody>{materials
              .filter((m) => {
                const q = String(draft.q || "").toLowerCase();
                if (!q) return true;
                return `${m.packmat_code} ${m.sku_code} ${m.sku_desc || descOf({ sku_code: m.sku_code })} ${LBL[m.packmat]} ${m.packmat}`.toLowerCase().includes(q);
              })
              .map((m) => {
                const k = `${m.sku_code}|${m.packmat}`;
                const on = draft.key === k;
                return (<tr key={k} onClick={() => setDraft({ ...draft, key: k })} style={{ cursor: "pointer", background: on ? "#f0fdf4" : "transparent" }}>
                  <td style={td}><input type="radio" readOnly checked={on} /></td>
                  <td style={{ ...td, fontFamily: "monospace", fontWeight: 600 }}>{m.packmat_code || "—"}</td>
                  <td style={{ ...td, fontWeight: 600 }}>{m.sku_code || "—"}</td>
                  <td style={{ ...td, color: C.muted, fontSize: 13 }}>{(m.sku_desc || descOf({ sku_code: m.sku_code }) || "").slice(0, 30) || "—"}</td>
                  <td style={td}>{LBL[m.packmat] || m.packmat}</td>
                  <td style={td}>{Math.round(m.qty)} {BASE_UNIT[m.packmat]}</td>
                  <td style={{ ...td, fontSize: 12 }}>{(m.oldest || {}).location || "—"}</td>
                </tr>);
              })}
              {materials.length === 0 && <tr><td style={td} colSpan={7}>No cleared stock at Kasani.</td></tr>}
            </tbody>
          </table>
        </div>
        {draft.key && (() => {
          const m = materials.find((x) => `${x.sku_code}|${x.packmat}` === draft.key);
          const over = Number(draft.qty) > Math.round(m.qty);
          return (<div style={{ border: `1px solid ${over ? C.amber : C.green}`, background: over ? "#fffbeb" : "#f0fdf4", borderRadius: 10, padding: 12 }}>
            <div style={{ display: "flex", gap: 14, alignItems: "flex-end", flexWrap: "wrap" }}>
              <div style={{ fontSize: 13 }}>
                <b>{m.packmat_code || "—"}</b> · {m.sku_code} · {LBL[m.packmat]}
                <div style={{ color: C.muted, fontSize: 12 }}>{Math.round(m.qty)} {BASE_UNIT[m.packmat]} available at {(m.oldest || {}).location || "—"}</div>
              </div>
              <label style={{ fontSize: 12, color: C.muted }}>Qty to load<br />
                <input type="number" value={draft.qty} onChange={(e) => setDraft({ ...draft, qty: e.target.value })} style={{ ...inp, width: 130 }} /></label>
              <span style={{ fontSize: 13, color: C.muted }}>{BASE_UNIT[m.packmat]}</span>
            </div>
            {over && <div style={{ fontSize: 12, color: C.amber, marginTop: 8 }}>
              ⚠ {Number(draft.qty) - Math.round(m.qty)} {BASE_UNIT[m.packmat]} more than Kasani has cleared — allowed, but it will push this material negative.
            </div>}
          </div>);
        })()}
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <button onClick={() => { setAddTo(null); setDraft({ key: "", qty: "", q: "" }); }} style={{ ...ghost, flex: 1 }}>Cancel</button>
          <button onClick={addLine} disabled={!draft.key || !Number(draft.qty)} style={{ ...btn(draft.key && Number(draft.qty) ? C.slate : "#94a3b8"), flex: 2 }}>Add to Truck {addTo + 1}</button>
        </div>
      </div>
    </div>}

    {/* ---------- ILT challan preview ---------- */}
    {ilt && <div onClick={() => setIlt(null)} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 50 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 12, padding: 20, width: "100%", maxWidth: 760, maxHeight: "88vh", overflowY: "auto" }}>
        <b style={{ fontSize: 17 }}>ILT challan — Truck #{ilt.truck_no}</b>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", fontSize: 13, margin: "10px 0 14px", padding: 10, background: "#f8fafc", borderRadius: 8 }}>
          <span><b>Challan</b> <code>{challanFor(ilt)}</code></span>
          <span><b>Dispatch time</b> {new Date().toISOString().slice(0, 16).replace("T", " ")}</span>
          <span><b>Plan date</b> {ilt.plan_date}</span>
          <span><b>Shift</b> {ilt.shift || "—"}</span>
          <span><b>Fill</b> {ilt.fill_pct}%</span>
        </div>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, marginBottom: 4 }}>WHAT GOES ON THE CHALLAN</div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th style={th}>SKU</th><th style={th}>Description</th><th style={th}>Packmat</th><th style={th}>Material code</th><th style={th}>Qty</th><th style={th}>For shift</th></tr></thead>
          <tbody>{(ilt.lines || []).map((l, i) => (<tr key={i}>
            <td style={{ ...td, fontWeight: 600 }}>{l.sku_code}</td>
            <td style={{ ...td, color: C.muted, fontSize: 13 }}>{(l.sku_desc || "").slice(0, 28) || "—"}</td>
            <td style={td}>{LBL[l.packmat]}</td>
            <td style={{ ...td, fontFamily: "monospace", fontSize: 12 }}>{l.packmat_code || "—"}</td>
            <td style={td}>{Math.round(l.qty_base)} {BASE_UNIT[l.packmat]}</td>
            <td style={td}>{l.shift}</td>
          </tr>))}</tbody>
        </table>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 10 }}>
          Sending draws this off the oldest invoice for each material, closes the PM-store requests on this truck, and puts it in front of Commercial for ILT sign-off.
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <button onClick={() => setIlt(null)} style={{ ...ghost, flex: 1 }}>Cancel</button>
          <button onClick={doSendIlt} disabled={busy} style={{ ...btn(C.green), flex: 2 }}>{busy ? "Sending…" : "Confirm & send ILT"}</button>
        </div>
      </div>
    </div>}
  </div>);
}
