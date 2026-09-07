// Simple pilot-grade role gate. NOT real security (anon key is public; RLS protects data).
// Replace PINS with your own, or wire Supabase Auth later.
import React, { useState } from "react";
import { C, btn, card } from "./shared";

const PINS = { store: "1111", kasani: "2222", commercial: "3333", bce: "" }; // bce: no pin (shop floor)

export default function Login({ onPick }) {
  const [pin, setPin] = useState(""); const [role, setRole] = useState(null); const [err, setErr] = useState("");
  const roles = [["store", "PM Store"], ["kasani", "Kasani"], ["bce", "Line (BCE)"], ["commercial", "Commercial"]];
  const choose = (r) => { if (!PINS[r]) return onPick(r); setRole(r); setPin(""); setErr(""); };
  const submit = () => { if (pin === PINS[role]) onPick(role); else setErr("Wrong PIN"); };
  return (<div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f1f5f9", fontFamily: "system-ui,Arial" }}>
    <div style={{ ...card, width: 340 }}>
      <h2 style={{ color: C.slate, marginTop: 0 }}>PM Pull</h2>
      {!role ? <>
        <div style={{ fontSize: 13, color: C.muted, marginBottom: 10 }}>Choose your screen</div>
        {roles.map(([r, lbl]) => <button key={r} onClick={() => choose(r)} style={{ ...btn(C.slate), width: "100%", marginBottom: 8 }}>{lbl}</button>)}
      </> : <>
        <div style={{ fontSize: 13, color: C.muted, marginBottom: 6 }}>Enter PIN for {role}</div>
        <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} autoFocus style={{ width: "100%", padding: 12, fontSize: 18, borderRadius: 8, border: `1px solid ${C.line}`, boxSizing: "border-box" }} />
        {err && <div style={{ color: C.red, fontSize: 13, marginTop: 6 }}>{err}</div>}
        <button onClick={submit} style={{ ...btn(C.slate), width: "100%", marginTop: 10 }}>Enter</button>
        <button onClick={() => setRole(null)} style={{ ...btn("#fff"), color: C.muted, border: `1px solid ${C.line}`, width: "100%", marginTop: 6 }}>Back</button>
      </>}
    </div>
  </div>);
}
