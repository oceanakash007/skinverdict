// SkinVerdict decision engine. Pure functions, runs in the browser and in Node (tests).
// Input: YouCam Skin Analysis scores (0-100, higher = healthier).
(function (root) {
  const DB = typeof module !== "undefined" && module.exports ? require("./ingredients.js") : root.SkinIngredients;
  const { ACTIVES, WATCHOUTS, BASE, CONCENTRATIONS } = DB;

  const CONCERNS = {
    acne: { label: "Breakouts" },
    wrinkle: { label: "Fine lines" },
    redness: { label: "Redness" },
    dark_circle_v2: { label: "Dark circles" },
    pore: { label: "Visible pores" },
    texture: { label: "Texture" },
    age_spot: { label: "Dark spots" },
    moisture: { label: "Hydration" },
    eye_bag: { label: "Eye puffiness" },
    oiliness: { label: "Oil balance" },
    radiance: { label: "Radiance" },
    firmness: { label: "Firmness" },
  };

  const ATTENTION = 65; // below: needs attention
  const WATCH = 78; // below: worth watching
  const BAND_LABEL = { attention: "Needs attention", watch: "Watch", good: "Good" };

  function band(score) {
    if (score < ATTENTION) return "attention";
    if (score < WATCH) return "watch";
    return "good";
  }

  // ---- Input hardening: the ingredient box accepts anything users paste from web pages. ----
  const MAX_CHARS = 6000;
  const MAX_ITEMS = 150;
  const CONTROL_CHARS = new RegExp("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F\\u200B-\\u200F\\u2028-\\u202E\\uFEFF]", "g");
  function sanitizeText(text) {
    return String(text ?? "")
      .slice(0, MAX_CHARS * 2)
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]*>/g, " ") // strip any HTML tags
      .replace(/&[a-z]+;|&#\d+;/gi, " ") // strip HTML entities
      .replace(CONTROL_CHARS, "") // control & bidi chars
      .slice(0, MAX_CHARS);
  }

  function parseIngredients(text) {
    return sanitizeText(text)
      .toLowerCase()
      .replace(/^[\s\S]*?ingredients?\s*[:：]/, "") // drop marketing text before "Ingredients:"
      .replace(/\b(may contain|\+\/-)\b[\s\S]*$/, "") // drop "may contain" colourant tails
      .replace(/\([^)]*\)/g, (m) => m.replace(/[,;]/g, " ")) // keep "(and)" groups intact
      .split(/,|\n|•|·|;|\|/)
      .map((s) => s.replace(/^[\s.*\-–]+|[\s.*]+$/g, "").replace(/\s+/g, " ").slice(0, 120))
      .filter((s) => s.length > 1 && /[a-z]/.test(s))
      .slice(0, MAX_ITEMS);
  }

  function joinList(arr) {
    return arr.length <= 1 ? arr.join("") : arr.slice(0, -1).join(", ") + " and " + arr[arr.length - 1];
  }

  function priorities(scores) {
    return Object.keys(scores)
      .filter((k) => CONCERNS[k] && typeof scores[k] === "number")
      .map((k) => ({ key: k, score: scores[k], band: band(scores[k]), label: CONCERNS[k].label }))
      .sort((a, b) => a.score - b.score);
  }

  function need(score) {
    return Math.max(0, Math.min(1, (WATCH - score) / 40));
  }

  // Preservatives are almost always used at <= 1%, so anything listed after them is a small amount.
  const ONE_PERCENT_MARKERS = /phenoxyethanol|ethylhexylglycerin|chlorphenesin|sodium benzoate|potassium sorbate|methylparaben|dehydroacetic acid|benzyl alcohol|disodium edta|xanthan gum/;

  function classify(ing) {
    const actives = ACTIVES.filter((a) => a.match.test(ing));
    const watch = WATCHOUTS.filter((w) => w.match.test(ing));
    const base = !actives.length && !watch.length ? BASE.find(([re]) => re.test(ing)) : null;
    return { actives, watch, role: base ? base[1] : null };
  }

  // Finds stated percentages ("10% Niacinamide", "Niacinamide 10%", "Retinol (0.3%)") in the name or list.
  function parseConcentrations(text) {
    const t = sanitizeText(text).toLowerCase();
    const out = [];
    for (const c of Object.values(CONCENTRATIONS)) {
      const src = c.re.source;
      const m = new RegExp("(\\d+(?:[.,]\\d+)?)\\s*%\\s*(?:[a-z+\\s]{0,12}?)(?:" + src + ")|(?:" + src + ")[^,%\\d]{0,12}?(\\d+(?:[.,]\\d+)?)\\s*%").exec(t);
      if (!m) continue;
      const pct = parseFloat((m[1] || m[2]).replace(",", "."));
      if (!(pct > 0 && pct <= 100)) continue;
      const [lo, hi] = c.range;
      out.push({ name: c.name, pct, range: c.range, level: pct < lo ? "low" : pct > hi ? "high" : "typical", note: pct < lo ? `below the usual ${lo}–${hi}% range, so effects may be mild` : pct > hi ? c.highNote || `above the usual ${lo}–${hi}% range` : `within the usual ${lo}–${hi}% range` });
    }
    return out;
  }

  function evaluateProduct(scores, ingredientText, productName = "") {
    const list = parseIngredients(ingredientText);
    const onePct = list.findIndex((i) => ONE_PERCENT_MARKERS.test(i));

    const pri = priorities(scores);
    const top = pri.filter((p) => p.band !== "good").slice(0, 3);
    const weak = new Set(pri.filter((p) => p.band !== "good").map((p) => p.key));

    const found = [];
    const breakdown = [];
    const seenActive = new Set();
    list.forEach((ing, idx) => {
      const c = classify(ing);
      let status = "unknown";
      let detail = "";
      for (const a of c.actives) {
        if (seenActive.has(a.id)) continue;
        seenActive.add(a.id);
        const late = !a.lowDoseOk && (onePct >= 0 ? idx > onePct : idx >= 12);
        found.push({ ...a, position: idx + 1, late, factor: late ? 0.5 : 1 });
      }
      if (c.actives.length) {
        const a = c.actives[0];
        const forYou = Object.keys(a.helps).some((k) => weak.has(k));
        status = forYou ? "helps" : "active";
        detail = a.note;
      } else if (c.role) {
        status = "base";
        detail = c.role;
      }
      if (c.watch.length) {
        const w = c.watch[0];
        const relevant = Object.keys(w.risk).some((k) => scores[k] !== undefined && scores[k] < WATCH);
        status = relevant ? "caution" : status === "unknown" ? "watch" : status;
        detail = w.name + (detail ? " · " + detail : "");
      }
      breakdown.push({ name: ing, status, detail, position: idx + 1 });
    });

    const helps = [];
    for (const p of top) {
      const hitters = found.filter((a) => a.helps[p.key]);
      if (!hitters.length) continue;
      const strength = Math.max(...hitters.map((a) => a.helps[p.key] * a.factor));
      helps.push({ concern: p.key, label: p.label, score: p.score, strength, by: hitters.map((a) => a.name), late: hitters.every((a) => a.late) });
    }

    const cautions = [];
    for (const w of WATCHOUTS) {
      const idx = list.findIndex((ing) => w.match.test(ing));
      if (idx === -1) continue;
      for (const [concern, why] of Object.entries(w.risk)) {
        if (scores[concern] !== undefined && scores[concern] < WATCH) {
          cautions.push({ id: w.id, name: w.name, ingredient: list[idx], concern, score: scores[concern], why, severity: scores[concern] < ATTENTION ? 2 : 1 });
          break;
        }
      }
    }
    // De-duplicate overlapping fragrance warnings (fragrance + allergens + essential oils count once, worst wins).
    const fragranceIds = ["fragrance", "allergens", "essential-oils"];
    const frag = cautions.filter((c) => fragranceIds.includes(c.id));
    if (frag.length > 1) {
      const worst = frag.sort((a, b) => b.severity - a.severity)[0];
      worst.name = frag.map((f) => f.name).join(" + ");
      for (const f of frag) if (f !== worst) cautions.splice(cautions.indexOf(f), 1);
    }

    const strongs = found.filter((a) => a.strong && !a.late);
    const reactive = (scores.redness ?? 100) < ATTENTION || (scores.moisture ?? 100) < ATTENTION;
    if (strongs.length && reactive) {
      const which = (scores.redness ?? 100) < (scores.moisture ?? 100) ? "redness" : "moisture";
      cautions.push({
        id: "strong-on-reactive",
        name: strongs.map((s) => s.name).join(" + "),
        concern: which,
        score: scores[which],
        why: `strong actives can sting when ${which === "redness" ? "redness is high" : "hydration is low"}. Start 2-3 nights a week and moisturise after`,
        severity: strongs.length > 1 ? 2 : 1,
      });
    }
    const exfoliants = strongs.filter((a) => a.strong === "exfoliant" || a.strong === "retinoid");
    if (exfoliants.length >= 2 && !cautions.find((c) => c.id === "strong-on-reactive")) {
      cautions.push({ id: "stacking", name: exfoliants.map((s) => s.name).join(" + "), concern: "redness", score: scores.redness, why: "several strong exfoliants or retinoids in one product raise the risk of irritation. Introduce slowly", severity: 1 });
    }

    const concentrations = parseConcentrations(productName + " , " + ingredientText);
    const sensitive = (scores.redness ?? 100) < WATCH || (scores.moisture ?? 100) < ATTENTION;
    for (const c of concentrations.filter((x) => x.level === "high" && sensitive)) {
      cautions.push({ id: "high-pct", name: `${c.pct}% ${c.name}`, concern: (scores.redness ?? 100) < (scores.moisture ?? 100) ? "redness" : "moisture", score: Math.min(scores.redness ?? 100, scores.moisture ?? 100), why: c.note + ", which is risky for your skin right now", severity: 1 });
    }

    const benefit = helps.reduce((s, h) => s + h.strength * (1 + need(h.score)), 0);
    const risk = cautions.reduce((s, c) => s + c.severity, 0);

    let verdict, headline;
    if (!top.length) {
      verdict = "neutral";
      headline = "Your skin is in good shape. This is a nice-to-have, not a need.";
    } else if (benefit === 0) {
      verdict = "skip";
      headline = `It doesn't target your top concerns (${top.map((t) => t.label.toLowerCase()).join(", ")}).`;
    } else if (risk >= 3 || (risk >= 2 && benefit < 2)) {
      verdict = "skip";
      headline = "It might help, but the risks outweigh the benefits for your skin right now.";
    } else if (risk > 0 || benefit < 1.5) {
      verdict = "caution";
      headline = risk > 0 ? "It targets your skin's needs, but it comes with a catch." : "It helps a little: a partial match.";
    } else {
      verdict = "good";
      headline = `A strong match for your ${joinList(helps.map((h) => h.label.toLowerCase()))}.`;
    }

    const recognised = breakdown.filter((b) => b.status !== "unknown").length;
    return {
      verdict,
      headline,
      helps,
      cautions,
      found: found.map(({ id, name, position, late, note }) => ({ id, name, position, late, note })),
      missing: top.filter((t) => !helps.find((h) => h.concern === t.key)),
      targets: helps.map((h) => h.concern),
      breakdown,
      parsedCount: list.length,
      recognised,
      onePercentAt: onePct >= 0 ? onePct + 1 : null,
      concentrations,
    };
  }

  function shoppingList(scores) {
    return priorities(scores)
      .filter((p) => p.band !== "good")
      .slice(0, 3)
      .map((p) => ({
        ...p,
        lookFor: ACTIVES.filter((a) => a.helps[p.key] === 1).map((a) => a.name).slice(0, 4),
        avoid: WATCHOUTS.filter((w) => w.risk[p.key]).map((w) => w.name).slice(0, 3),
      }));
  }

  const NOISE = 3;
  function evaluateProgress(baseline, followup, targets, days) {
    const keys = targets && targets.length ? targets : Object.keys(followup.scores);
    const deltas = keys
      .filter((k) => baseline.scores[k] !== undefined && followup.scores[k] !== undefined)
      .map((k) => ({ key: k, label: CONCERNS[k]?.label || k, before: baseline.scores[k], after: followup.scores[k], delta: followup.scores[k] - baseline.scores[k] }));
    const avg = deltas.length ? deltas.reduce((s, d) => s + d.delta, 0) / deltas.length : 0;
    const irritation = ["redness", "acne"]
      .filter((k) => baseline.scores[k] !== undefined && followup.scores[k] !== undefined)
      .map((k) => ({ key: k, label: CONCERNS[k].label, delta: followup.scores[k] - baseline.scores[k] }))
      .filter((d) => d.delta <= -8);

    let verdict, headline, detail;
    if (irritation.length) {
      verdict = "stop";
      headline = "Pause it: possible reaction";
      detail = `${irritation.map((i) => `${i.label} dropped ${Math.abs(i.delta)} pts`).join(", ")} since you started. Stop for a week and rescan. If it recovers, the product was the likely cause.`;
    } else if (avg >= NOISE) {
      verdict = "keep";
      headline = "It's working, so keep going";
      detail = `Your target concerns improved by an average of ${avg.toFixed(1)} pts in ${days} days.`;
    } else if (avg <= -NOISE) {
      verdict = "stop";
      headline = "Getting worse, so reconsider it";
      detail = `Your target concerns fell by ${Math.abs(avg).toFixed(1)} pts on average. Check that you're scanning in the same light, then consider switching.`;
    } else if (days < 28) {
      verdict = "wait";
      headline = "Too early to tell, so give it time";
      detail = `${days} day${days === 1 ? "" : "s"} in. Most actives need 4 to 8 weeks (retinoids 8 to 12) before skin visibly changes. Rescan around day 28.`;
    } else {
      verdict = "switch";
      headline = "Not doing much, so consider switching";
      detail = `After ${days} days your target concerns are flat (${avg >= 0 ? "+" : ""}${avg.toFixed(1)} pts). Your money may be better spent elsewhere.`;
    }
    return { verdict, headline, detail, deltas, avg, irritation };
  }

  function compareScans(a, b) {
    return Object.keys(CONCERNS)
      .filter((k) => a.scores[k] !== undefined && b.scores[k] !== undefined)
      .map((k) => ({ key: k, label: CONCERNS[k].label, before: a.scores[k], after: b.scores[k], delta: b.scores[k] - a.scores[k] }))
      .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
  }

  const api = { CONCERNS, ACTIVES, WATCHOUTS, BASE, CONCENTRATIONS, parseConcentrations, BAND_LABEL, band, priorities, sanitizeText, parseIngredients, classify, evaluateProduct, shoppingList, evaluateProgress, compareScans, ATTENTION, WATCH, NOISE };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SkinEngine = api;
})(typeof window !== "undefined" ? window : globalThis);
