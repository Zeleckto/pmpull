// BCE call screen. Built for someone standing at a machine with one hand free.
//
// Step 1: type the machine name (k1a, K1A, whatever) or tap it from the grid.
// Step 2: only the SKUs that machine actually runs, then packmat, qty, Call.
//
// What a line can run comes from lines_map (type + weight). If line_materials has rows
// for that line, those exact material codes win instead. Either way there is a
// "show every SKU" escape hatch, because machines get re-set to other weights.
import React, { useEffect, useMemo, useState } from "react";
import { loadSkusK, loadLinesMap, loadLineMaterials, loadPackConfig, addRequestRow, loadRequestsForLine } from "../dataKasani";
import { LBL, BASE_UNIT, compsOf, codeFor, currentShift, SHIFT_HOURS, C } from "../shared";

const norm = (x) => String(x || "").trim().toUpperCase().replace(/[\s\-_.]/g, "");
// same canonical buckets compsOf uses, so line config and SKU master always agree
const canonPrimary = (t) => (String(t || "").toLowerCase().includes("lam") ? "laminate" : "carton");
const canonOuter = (t) => (/sac|wov/.test(String(t || "").toLowerCase()) ? "sac" : "cld");

export default function BCECall({ presetLine }) {
  const [skus, setSkus] = useState([]);
  const [lmap, setLmap] = useState([]);
  const [lmat, setLmat] = useState([]);
  const [pcfg, setPcfg] = useState([]);   // pack_config: entry units. `cfg` below is the LINE config.
  const [line, setLine] = useState(presetLine || "");
  const [typed, setTyped] = useState("");
  const [sku, setSku] = useState("");
  const [qtys, setQtys] = useState({});      // packmat -> qty; a line runs several at once
  const [uvar, setUvar] = useState({});      // packmat -> which unit they counted in
  const [showAll, setShowAll] = useState(false);
  const [q, setQ] = useState("");
  const [recent, setRecent] = useState([]);
  const [done, setDone] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { (async () => {
    setSkus(await loadSkusK()); setLmap(await loadLinesMap());
    setLmat(await loadLineMaterials()); setPcfg(await loadPackConfig());
  })(); }, []);
  useEffect(() => { if (line) loadRequestsForLine(line).then(setRecent); }, [line, done]);

  const cfg = lmap.find((l) => norm(l.line) === norm(line));
  const codesForLine = useMemo(() => new Set(lmat.filter((m) => norm(m.line) === norm(line)).map((m) => norm(m.packmat_code))), [lmat, line]);

  // ---- which SKUs this machine can run ----
  const fits = (s) => {
    if (codesForLine.size) {                       // explicit code map wins
      return [s.primary_code, s.outer_code].some((c) => c && codesForLine.has(norm(c)));
    }
    if (!cfg) return true;
    const ws = String(cfg.weights || "").split(/[ ,]+/).map(Number).filter(Boolean);
    if (ws.length && !ws.includes(Number(s.weight))) return false;
    // Canonicalise BOTH sides the same way compsOf does, so "woven" still counts as a
    // sac and "poly"/"laminate" as laminate — a plain substring test would drop those.
    if (cfg.primary_type && canonPrimary(s.primary_type) !== canonPrimary(cfg.primary_type)) return false;
    if (cfg.outer_type && canonOuter(s.outer_type) !== canonOuter(cfg.outer_type)) return false;
    return true;
  };
  const onLine = skus.filter(fits);
  const pool = showAll || !onLine.length ? skus : onLine;
  const list = pool.filter((s) => !q || `${s.code} ${s.description} ${s.primary_code} ${s.outer_code}`.toLowerCase().includes(q.toLowerCase()));

  const s = skus.find((x) => x.code === sku);
  // Everything this SKU needs. A divider is required at 1 kg and above even when the SKU
  // master does not carry the flag, so add it rather than let the line run short.
  const comps = (() => {
    if (!s) return [];
    const a = compsOf(s);
    if (Number(s.weight) >= 1000 && !a.includes("divider")) a.push("divider");
    return a;
  })();
  useEffect(() => { setQtys({}); setUvar({}); }, [sku]);

  // What this line counts in. A roll of laminate, a box of cartons, a bundle of CLD —
  // never kg or loose pieces. Only units with a real factor behind them are offered.
  const unitsFor = (pm) => {
    const rows = pcfg.filter((r) => r.packmat === pm && r.base_per_unit != null)
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    return rows.length ? rows : [{ variant: "default", unit_label: BASE_UNIT[pm] || "pcs", base_per_unit: 1 }];
  };
  const unitRow = (pm) => {
    const o = unitsFor(pm);
    return o.find((x) => x.variant === (uvar[pm] || o[0].variant)) || o[0];
  };
  const baseQty = (pm) => (Number(qtys[pm]) || 0) * Number(unitRow(pm).base_per_unit || 1);

  const machines = [...lmap].filter((l) => l.active !== false).sort((a, b) => (a.sort_order || 99) - (b.sort_order || 99));
  const groups = [...new Set(machines.map((m) => m.group_name || "MACHINES"))];

  const pickLine = (name) => {
    const hit = lmap.find((l) => norm(l.line) === norm(name));
    if (!hit) return false;
    setLine(hit.line); setTyped(""); setSku(""); setQtys({}); setQ(""); setShowAll(false);
    return true;
  };
  const submitTyped = () => { if (!pickLine(typed)) setDone(`No machine called "${typed}".`); };

  // Only the packmats with a number typed in are sent. Leaving CLD blank while asking
  // for cartons simply means no CLD request is raised.
  const wanted = comps.filter((pm) => Number(qtys[pm]) > 0);
  const call = async () => {
    if (!line || !sku || !wanted.length) return;
    setBusy(true);
    const now = currentShift();          // the clock decides the shift, nobody types it
    const failed = [];
    for (const pm of wanted) {
      const { error } = await addRequestRow({
        line, sku_code: sku, packmat: pm, qty_base: baseQty(pm), shift: now.shift, status: "open",
      });
      if (error) failed.push(LBL[pm]);
    }
    setBusy(false);
    if (failed.length) { setDone(`Could not send: ${failed.join(", ")}`); return; }
    setDone(`✓ Sent to PM store — ${wanted.map((pm) => `${Number(qtys[pm])} ${unitRow(pm).unit_label} ${LBL[pm]}`).join(" + ")} for ${sku}`);
    setQtys({}); setUvar({});
    setTimeout(() => setDone(""), 4000);
  };

  const big = { fontSize: 18, padding: 14, width: "100%", borderRadius: 10, border: `1px solid ${C.line}`, marginTop: 6, boxSizing: "border-box" };
  const lbl = { fontSize: 14, fontWeight: 700, color: C.muted, marginTop: 16, display: "block" };
  const wrap = { maxWidth: 520, margin: "0 auto", padding: 18, fontFamily: "system-ui,Arial", color: C.ink };

  // ---------------- step 1: which machine ----------------
  if (!line) return (<div style={wrap}>
    <h2 style={{ color: C.slate, marginBottom: 4 }}>Which machine?</h2>
    <div style={{ fontSize: 14, color: C.muted, marginBottom: 14 }}>Type the machine name or tap it below. Capitals don&apos;t matter.</div>
    <input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submitTyped()}
      placeholder="e.g. k1a" style={{ ...big, fontSize: 26, padding: 18, textAlign: "center", textTransform: "uppercase", fontWeight: 700 }} />
    {done && <div style={{ color: C.red, fontSize: 14, marginTop: 8, textAlign: "center" }}>{done}</div>}
    <button onClick={submitTyped} disabled={!typed.trim()} style={{ width: "100%", marginTop: 10, padding: 16, fontSize: 19, fontWeight: 700, borderRadius: 10, border: 0, cursor: "pointer", background: typed.trim() ? C.slate : "#94a3b8", color: "#fff" }}>Continue</button>

    {groups.map((g) => (<div key={g} style={{ marginTop: 18 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, marginBottom: 6 }}>{g === "EXTERNAL" ? "OTHER SITES" : g}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))", gap: 8 }}>
        {machines.filter((m) => (m.group_name || "MACHINES") === g).map((m) => (
          <button key={m.line} onClick={() => pickLine(m.line)} style={{
            padding: "16px 6px", fontSize: 19, fontWeight: 700, borderRadius: 10, cursor: "pointer",
            border: `1px solid ${C.line}`, background: "#fff", color: C.slate,
          }}>{m.line}</button>))}
      </div>
    </div>))}
    {machines.length === 0 && <div style={{ marginTop: 16, fontSize: 13, color: C.amber }}>
      No machines configured — run <code>sql/phase7.sql</code> in Supabase.
    </div>}
  </div>);

  // ---------------- step 2: the call ----------------
  const capability = cfg
    ? [cfg.primary_type && LBL[cfg.primary_type], cfg.outer_type && LBL[cfg.outer_type]].filter(Boolean).join(" + ")
      + (cfg.weights ? ` · ${cfg.weights} g` : "")
    : "";

  return (<div style={wrap}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
      <div>
        <h2 style={{ color: C.slate, margin: 0 }}>{cfg ? cfg.label || line : line}</h2>
        <div style={{ fontSize: 13, color: C.muted }}>{capability || "all materials"}{codesForLine.size ? ` · ${codesForLine.size} mapped codes` : ""}</div>
        <div style={{ fontSize: 12, color: C.green, marginTop: 2 }}>
          Shift {currentShift().shift} &middot; {SHIFT_HOURS[currentShift().shift]} — recorded automatically
        </div>
      </div>
      <button onClick={() => { setLine(""); setSku(""); setQtys({}); setDone(""); }} style={{ padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.line}`, background: "#fff", cursor: "pointer", fontWeight: 600 }}>Change</button>
    </div>

    <label style={lbl}>What do you need?</label>
    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="search SKU or code" style={{ ...big, marginTop: 6 }} />
    <div style={{ maxHeight: 260, overflowY: "auto", border: `1px solid ${C.line}`, borderRadius: 10, marginTop: 8 }}>
      {list.length === 0 ? <div style={{ padding: 14, color: C.muted }}>Nothing matches. Try “show every SKU”.</div> :
        list.map((x) => (<button key={x.code} onClick={() => setSku(x.code)} style={{
          display: "block", width: "100%", textAlign: "left", font: "inherit", cursor: "pointer",
          padding: 12, border: 0, borderBottom: `1px solid ${C.line}`,
          background: sku === x.code ? "#eafaf0" : "#fff",
        }}>
          <b style={{ fontSize: 16 }}>{x.code}</b>
          <div style={{ fontSize: 13, color: C.muted }}>{(x.description || "").slice(0, 40)} · {x.weight} g</div>
        </button>))}
    </div>
    <label style={{ fontSize: 14, color: C.muted, display: "block", marginTop: 10 }}>
      <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} style={{ width: 18, height: 18, verticalAlign: "-3px" }} />
      &nbsp;Show every SKU <span style={{ fontSize: 12 }}>(machine set to a different weight)</span>
    </label>
    {!showAll && onLine.length > 0 && <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>Showing {onLine.length} of {skus.length} SKUs this machine runs.</div>}

    {s && <>
      <label style={lbl}>How much of each?</label>
      <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>Fill in only what you need. Leave a box empty and it will not be asked for.</div>
      {comps.map((pm) => {
        const on = Number(qtys[pm]) > 0;
        const opts = unitsFor(pm);
        const row = unitRow(pm);
        const conv = Number(row.base_per_unit || 1);
        return (<div key={pm} style={{
          marginTop: 10, padding: 12,
          border: `2px solid ${on ? C.slate : C.line}`, borderRadius: 12, background: on ? "#f8fafc" : "#fff",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{LBL[pm]}</div>
              <div style={{ fontSize: 12, color: C.muted, fontFamily: "monospace" }}>
                {codeFor(s, pm) || (pm === "divider" ? "divider" : "—")}
              </div>
              {pm === "divider" && Number(s.weight) >= 1000 &&
                <div style={{ fontSize: 11, color: C.amber, fontWeight: 600 }}>needed at {s.weight} g</div>}
            </div>
            <input type="number" inputMode="numeric" placeholder="0" value={qtys[pm] ?? ""}
              onChange={(e) => setQtys({ ...qtys, [pm]: e.target.value })}
              style={{ width: 104, fontSize: 24, fontWeight: 700, textAlign: "center", padding: 12, borderRadius: 10, border: `1px solid ${C.line}` }} />
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
            {opts.map((o) => (<button key={o.variant} onClick={() => setUvar({ ...uvar, [pm]: o.variant })} style={{
              padding: "8px 14px", fontSize: 15, fontWeight: 700, borderRadius: 8, cursor: "pointer",
              border: `2px solid ${row.variant === o.variant ? C.slate : C.line}`,
              background: row.variant === o.variant ? C.slate : "#fff", color: row.variant === o.variant ? "#fff" : C.ink,
            }}>{o.unit_label}</button>))}
            {on && conv !== 1 && <span style={{ fontSize: 13, color: C.muted }}>= {baseQty(pm)} {BASE_UNIT[pm]}</span>}
          </div>
        </div>);
      })}

      <button onClick={call} disabled={busy || !wanted.length} style={{
        width: "100%", marginTop: 22, padding: 20, fontSize: 22, fontWeight: 700, borderRadius: 12, border: 0,
        cursor: wanted.length ? "pointer" : "not-allowed",
        background: wanted.length ? C.slate : "#94a3b8", color: "#fff",
      }}>{busy ? "Sending…" : wanted.length > 1 ? `Call ${wanted.length} items` : "Call packaging"}</button>
    </>}

    {done && <div style={{ marginTop: 14, padding: 14, background: done.startsWith("✓") ? "#eafaf0" : "#fef2f2", color: done.startsWith("✓") ? C.green : C.red, borderRadius: 10, textAlign: "center", fontWeight: 600 }}>{done}</div>}

    {recent.length > 0 && <div style={{ marginTop: 22 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, marginBottom: 6 }}>YOUR LAST CALLS</div>
      {recent.map((r) => (<div key={r.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 10px", borderBottom: `1px solid ${C.line}`, fontSize: 14 }}>
        <span><b>{r.sku_code}</b> · {LBL[r.packmat] || r.packmat} · {Math.round(r.qty_base)}</span>
        <span style={{ color: r.status === "open" ? C.amber : C.green, fontWeight: 600, fontSize: 13 }}>{r.status === "open" ? "waiting" : "given"}</span>
      </div>))}
    </div>}
  </div>);
}
