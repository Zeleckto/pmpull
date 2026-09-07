// The only router. Renders the right screen for the chosen role.
// Your existing PM-store App is used AS-IS for the 'store' role.
import React, { useState } from "react";
import Login from "./Login";
import App from "./App.jsx";                    // existing PM store — untouched
import KasaniHome from "./kasani/KasaniHome";
import BCECall from "./bce/BCECall";
import Commercial from "./Commercial";
import { C } from "./shared";

export default function AppShell() {
  const [role, setRole] = useState(null);
  if (!role) return <Login onPick={setRole} />;

  const Bar = ({ children }) => (<div style={{ background: C.slate, color: "#fff", padding: "8px 14px", display: "flex", gap: 12, alignItems: "center" }}>
    <b>PM Pull</b><span style={{ opacity: 0.8, fontSize: 13 }}>{role}</span><div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>{children}
      <button onClick={() => setRole(null)} style={{ background: "transparent", color: "#fff", border: "1px solid rgba(255,255,255,.4)", borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>Logout</button></div></div>);

  if (role === "store") return <><Bar /><App /></>;
  if (role === "bce") return <BCECall onExit={() => setRole(null)} />;
  if (role === "commercial") return <><Bar /><Commercial /></>;
  // Kasani gets its own plain home screen (Goods Received / Stock Status / Dispatch)
  if (role === "kasani") return <><Bar /><KasaniHome /></>;
  return null;
}
