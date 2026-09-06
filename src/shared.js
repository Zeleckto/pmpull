// Shared helpers used by phase-2 screens (kept tiny; mirrors App.jsx conventions).
export const LBL = { carton: "Carton", cld: "CLD", sac: "Sac", laminate: "Laminate", divider: "Divider" };
export const UNIT = { carton: "pcs", cld: "cases", sac: "bags", laminate: "kg", divider: "pcs" };
export const compsOf = (s) => {
  const p = String(s.primary_type || "").toLowerCase();
  const o = String(s.outer_type || "").toLowerCase();
  const a = [];
  if (p) a.push(p.includes("lam") ? "laminate" : "carton");
  if (o) a.push(o.includes("sac") || o.includes("wov") ? "sac" : "cld");
  if (s.divider) a.push("divider");
  return a;
};
export const codeFor = (s, pm) =>
  (pm === "carton" || pm === "laminate") ? s.primary_code
  : (pm === "cld" || pm === "sac") ? s.outer_code : "";
// per-tonne factor from the conversion table (base units per tonne)
export const perT = (pm, s, conv) => {
  const c = conv[s.weight] || {};
  return { carton: c.cartons_per_t, cld: c.cld_per_t, sac: c.sac_per_t,
           laminate: c.lam_per_t, divider: c.inner_per_t }[pm] || null;
};
export const theo = (pm, s, t, conv) => { const p = perT(pm, s, conv); return p ? t * p : 0; };
export const fgEquiv = (pm, qty, s, conv) => { const p = perT(pm, s, conv); return p ? qty / p : 0; };
export const KGRID_ROWS = ["A", "B", "C", "D", "E"];
export const C = { slate: "#1f3a5f", ink: "#1b2a41", muted: "#64748b", line: "#e2e8f0", green: "#2e7d46", red: "#c1442e", amber: "#b26a00", blue: "#2c5aa0" };
export const btn = (bg) => ({ padding: "8px 14px", background: bg, color: "#fff", border: 0, borderRadius: 8, fontWeight: 600, cursor: "pointer" });
export const card = { background: "#fff", border: `1px solid ${C.line}`, borderRadius: 10, padding: 14, marginBottom: 16 };
export const inp = { padding: 8, border: `1px solid ${C.line}`, borderRadius: 6, fontSize: 14 };
export const th = { textAlign: "left", padding: "6px 8px", borderBottom: `1px solid ${C.line}`, color: C.muted, fontSize: 13, position: "sticky", top: 0, background: "#fff" };
export const td = { padding: "6px 8px", borderBottom: "1px solid #f1f5f9", fontSize: 14 };
export function readSheet(file, cb) {
  import("xlsx").then((XLSX) => {
    const r = new FileReader();
    r.onload = () => { const wb = XLSX.read(new Uint8Array(r.result), { type: "array" }); cb(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, blankrows: false })); };
    r.readAsArrayBuffer(file);
  });
}
export function exportXlsx(filename, rows) {
  import("xlsx").then((XLSX) => {
    const ws = XLSX.utils.json_to_sheet(rows); const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "data"); XLSX.writeFile(wb, filename);
  });
}
export const norm = (h) => String(h || "").trim().toLowerCase();

// ---- base units (what actually gets stored in qty_base) ----
export const BASE_UNIT = { carton: "pcs", cld: "pcs", sac: "pcs", laminate: "kg", divider: "pcs" };

// Entry units for a packmat, from pack_config rows. Falls back to the base unit alone
// so the screens still work before anyone fills the settings in.
export const unitsFor = (cfg, pm) => {
  const rows = (cfg || []).filter((r) => r.packmat === pm);
  if (!rows.length) return [{ variant: "default", unit_label: BASE_UNIT[pm] || "pcs", base_per_unit: 1 }];
  return rows;
};
export const cfgRow = (cfg, pm, variant) =>
  (cfg || []).find((r) => r.packmat === pm && r.variant === (variant || "default")) || null;

// how many base units one entry unit is worth; null when nobody has set it yet
export const baseFactor = (cfg, pm, variant) => {
  const r = cfgRow(cfg, pm, variant);
  const f = r && r.base_per_unit;
  return f == null || f === "" ? null : Number(f);
};

// ---- quality status of a consignment: one place, so colours never drift ----
export function grStatus(c) {
  if (c.status === "cleared") return { key: "cleared", label: "Cleared", color: C.green };
  if (c.status === "rejected") return { key: "rejected", label: "Blocked / rejected", color: "#7f1d1d" };
  if (c.sample_sent) return { key: "sample", label: "Sample sent", color: C.amber };
  return { key: "pending", label: "Quality pending", color: C.red };
}

// Reverse lookup: material code -> the SKUs/packmats that use it.
// Lets a worker type the code off the box and have SKU + packmat fill themselves in.
export function findByCode(skus, code) {
  const q = String(code || "").trim().toLowerCase();
  if (!q) return [];
  const hits = [];
  skus.forEach((s) => {
    if (String(s.primary_code || "").trim().toLowerCase() === q)
      hits.push({ sku: s, packmat: String(s.primary_type || "").toLowerCase().includes("lam") ? "laminate" : "carton" });
    if (String(s.outer_code || "").trim().toLowerCase() === q)
      hits.push({ sku: s, packmat: /sac|wov/.test(String(s.outer_type || "").toLowerCase()) ? "sac" : "cld" });
  });
  return hits;
}
export const nowStamp = () => new Date().toISOString();
export const todayStr = () => new Date().toISOString().slice(0, 10);
export const ghost = { padding: "8px 14px", background: "#fff", color: C.slate, border: `1px solid ${C.line}`, borderRadius: 8, fontWeight: 600, cursor: "pointer" };
