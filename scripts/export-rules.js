// Exports every ingredient rule to a CSV for review by a dermatologist or cosmetic chemist.
// Usage: npm run export-rules  ->  rules-for-review.csv  (add columns "Reviewer verdict" / "Notes" and send back)
const fs = require("fs");
const { ACTIVES, WATCHOUTS, BASE, CONCENTRATIONS } = require("../public/js/ingredients.js");
const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
const rows = [["Type", "ID", "Name", "Matches (pattern)", "Helps / risk", "Notes", "Reviewer verdict", "Reviewer notes"]];
for (const a of ACTIVES) rows.push(["Active", a.id, a.name, a.match.source, Object.entries(a.helps).map(([k, w]) => `${k}:${w}`).join("; "), [a.note, a.strong ? "strong: " + a.strong : "", a.lowDoseOk ? "effective at low %" : ""].filter(Boolean).join(" · "), "", ""]);
for (const w of WATCHOUTS) rows.push(["Watch-out", w.id, w.name, w.match.source, Object.entries(w.risk).map(([k, v]) => `${k}: ${v}`).join(" | "), "", "", ""]);
for (const [re, role] of BASE) rows.push(["Functional", "", role, re.source, "", "", "", ""]);
for (const [id, c] of Object.entries(CONCENTRATIONS)) rows.push(["Concentration", id, c.name, c.re.source, `${c.range[0]}–${c.range[1]}%`, c.highNote, "", ""]);
fs.writeFileSync("rules-for-review.csv", rows.map((r) => r.map(q).join(",")).join("\n"));
console.log(`Wrote rules-for-review.csv (${rows.length - 1} rules).`);
