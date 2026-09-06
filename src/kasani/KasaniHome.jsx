// Kasani warehouse shell. Deliberately plain: a home screen with three big choices,
// the way the PM store works, because the people using this are not desk workers.
// Home -> Goods Received | Stock Status | Dispatch.  Settings is tucked away.
import React, { useState } from "react";
import KasaniGR from "./KasaniGR";
import KasaniStock from "./KasaniStock";
import KasaniDispatch from "./KasaniDispatch";
import KasaniSettings from "./KasaniSettings";
import { C } from "../shared";

const TILES = [
  { id: "gr", title: "Goods Received", sub: "Log material arriving from the supplier", icon: "📦", color: "#2e7d46" },
  { id: "stock", title: "Stock Status", sub: "What is here, and its quality status", icon: "🏷️", color: "#2c5aa0" },
  { id: "dispatch", title: "Dispatch", sub: "Load trucks for the PM store", icon: "🚚", color: "#b26a00" },
];

export default function KasaniHome() {
  const [view, setView] = useState(null);
  const cur = TILES.find((t) => t.id === view);

  return (<div style={{ minHeight: "100vh", background: "#f1f5f9", fontFamily: "system-ui,Arial", color: C.ink }}>
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 20 }}>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
        <div style={{ width: 46, height: 46, borderRadius: 12, background: C.slate, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>🏭</div>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>Kasani Warehouse</div>
          <div style={{ fontSize: 13, color: C.muted }}>{cur ? cur.sub : "Choose what you want to do"}</div>
        </div>
      </div>

      {view && <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <button onClick={() => setView(null)} style={{ padding: "10px 16px", background: "#fff", border: `1px solid ${C.line}`, borderRadius: 10, fontWeight: 600, fontSize: 15, cursor: "pointer" }}>← Home</button>
        <b style={{ fontSize: 18 }}>{cur ? cur.title : "Truck &amp; unit settings"}</b>
      </div>}

      {!view && <>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
          {TILES.map((t) => (
            <button key={t.id} onClick={() => setView(t.id)} style={{
              textAlign: "left", background: "#fff", border: `1px solid ${C.line}`, borderLeft: `6px solid ${t.color}`,
              borderRadius: 14, padding: 22, cursor: "pointer", font: "inherit", color: "inherit",
              boxShadow: "0 1px 3px rgba(15,23,42,.06)",
            }}>
              <div style={{ fontSize: 34, lineHeight: 1, marginBottom: 10 }}>{t.icon}</div>
              <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>{t.title}</div>
              <div style={{ fontSize: 13, color: C.muted }}>{t.sub}</div>
            </button>
          ))}
        </div>
        <button onClick={() => setView("settings")} style={{ marginTop: 18, background: "transparent", border: 0, color: C.muted, fontSize: 13, cursor: "pointer", textDecoration: "underline" }}>
          ⚙ Truck &amp; unit settings
        </button>
      </>}

      {view === "gr" && <KasaniGR />}
      {view === "stock" && <KasaniStock />}
      {view === "dispatch" && <KasaniDispatch />}
      {view === "settings" && <KasaniSettings />}
    </div>
  </div>);
}
