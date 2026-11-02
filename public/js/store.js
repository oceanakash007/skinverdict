// Local data layer: scores and tracked products live on the user's device (privacy by design).
// Adds: persistent-storage request, schema validation, and backup export/import so data survives
// a browser clear or moves to another phone.
(function (root) {
  const PREFIX = "sv_";
  const VERSION = 2;

  function get(k, d) {
    try {
      const v = JSON.parse(localStorage.getItem(PREFIX + k));
      return v ?? d;
    } catch {
      return d;
    }
  }
  function set(k, v) {
    try {
      localStorage.setItem(PREFIX + k, JSON.stringify(v));
      return true;
    } catch {
      return false;
    }
  }

  // Ask the browser not to evict our data under storage pressure (supported in Chrome/Edge/Firefox; Safari ignores).
  async function requestPersistence() {
    try {
      if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
    } catch {
      /* not supported */
    }
  }

  const num = (v) => typeof v === "number" && isFinite(v);
  const str = (v, max = 200) => (typeof v === "string" ? v.slice(0, max) : "");

  function validScan(s) {
    if (!s || typeof s !== "object" || !s.scores || typeof s.scores !== "object") return null;
    const scores = {};
    for (const [k, v] of Object.entries(s.scores)) if (/^[a-z_0-9]{2,30}$/.test(k) && num(v)) scores[k] = Math.max(0, Math.min(100, Math.round(v)));
    if (!Object.keys(scores).length || isNaN(Date.parse(s.date))) return null;
    return { id: str(s.id, 40) || "s" + Date.parse(s.date), date: new Date(s.date).toISOString(), scores, overall: num(s.overall) ? Math.round(s.overall) : null, skinAge: num(s.skinAge) ? Math.round(s.skinAge) : null, sample: !!s.sample, skinType: str(s.skinType, 40) || null, skinColor: /^#[0-9a-f]{6}$/i.test(s.skinColor || "") ? s.skinColor : null };
  }
  function validTrial(t) {
    if (!t || typeof t !== "object" || !Array.isArray(t.targets)) return null;
    return {
      id: str(t.id, 40) || "t" + Date.now(),
      name: str(t.name, 120) || "Product",
      ingredients: str(t.ingredients, 6000),
      targets: t.targets.filter((x) => typeof x === "string" && /^[a-z_0-9]{2,30}$/.test(x)),
      verdict: str(t.verdict, 20),
      baselineScanId: str(t.baselineScanId, 40),
      followupScanId: str(t.followupScanId, 40) || undefined,
      startDate: /^\d{4}-\d{2}-\d{2}$/.test(t.startDate) ? t.startDate : new Date().toISOString().slice(0, 10),
    };
  }

  function exportBackup(scans, trials) {
    const data = { app: "SkinVerdict", version: VERSION, exportedAt: new Date().toISOString(), scans, trials };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `skinverdict-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // Merges a backup into existing data (never deletes); returns counts.
  async function importBackup(file, scans, trials) {
    if (file.size > 2 * 1024 * 1024) throw new Error("That file is too large to be a SkinVerdict backup.");
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      throw new Error("That file isn't a valid backup (not JSON).");
    }
    if (!data || data.app !== "SkinVerdict" || !Array.isArray(data.scans)) throw new Error("That file isn't a SkinVerdict backup.");
    const haveS = new Set(scans.map((s) => s.id));
    const haveT = new Set(trials.map((t) => t.id));
    let addedS = 0, addedT = 0;
    for (const raw of data.scans.slice(0, 500)) {
      const s = validScan(raw);
      if (s && !haveS.has(s.id)) { scans.push(s); haveS.add(s.id); addedS++; }
    }
    for (const raw of (data.trials || []).slice(0, 200)) {
      const t = validTrial(raw);
      if (t && !haveT.has(t.id)) { trials.push(t); haveT.add(t.id); addedT++; }
    }
    scans.sort((a, b) => new Date(a.date) - new Date(b.date));
    return { addedS, addedT };
  }

  root.SkinStore = { get, set, requestPersistence, exportBackup, importBackup, validScan, validTrial };
})(typeof window !== "undefined" ? window : globalThis);
