// Turns the raw YouCam Skin Analysis JSON into the compact shape the app uses.
// YouCam scores: higher ui_score = healthier skin for that concern (0-100).

const KNOWN = [
  "acne", "wrinkle", "redness", "dark_circle_v2", "pore", "texture",
  "age_spot", "moisture", "eye_bag", "oiliness", "radiance", "firmness",
];

function clamp(n) {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function pickOutput(raw) {
  const r = raw?.data?.results ?? raw?.results ?? raw?.data ?? {};
  if (Array.isArray(r)) return r;
  if (Array.isArray(r.output)) return r.output;
  if (Array.isArray(r.results)) return r.results;
  return [];
}

function normalize(raw) {
  const output = pickOutput(raw);
  const scores = {};
  const masks = {};
  let overall = null;
  let skinAge = null;
  let baseImage = null;
  let skinType = null;

  for (const o of output) {
    const t = o?.type;
    if (!t) continue;
    if (t === "all") {
      if (typeof o.score === "number") overall = clamp(o.score);
      else if (typeof o.ui_score === "number") overall = clamp(o.ui_score);
      continue;
    }
    if (t === "skin_age") {
      const v = o.score ?? o.ui_score;
      if (typeof v === "number") skinAge = Math.round(v);
      continue;
    }
    if (t === "skin_type" || t === "hd_skin_type") {
      // YouCam's own classification. Value field name varies; take the first string label we find.
      const label = [o.skin_type, o.value, o.result, o.label, o.type_name].find((v) => typeof v === "string" && v !== "skin_type");
      const region = o.region || o.sub_type || "whole";
      if (label && (!skinType || region === "whole")) skinType = label;
      continue;
    }
    if (t === "resize_image") {
      baseImage = o.mask_urls?.[0] || o.url || null;
      continue;
    }
    const key = t.replace(/^hd_/, "") === "dark_circle" ? "dark_circle_v2" : t.replace(/^hd_/, "");
    if (!KNOWN.includes(key) || scores[key] !== undefined) continue;
    const v = typeof o.ui_score === "number" ? o.ui_score : o.raw_score;
    if (typeof v !== "number") continue;
    scores[key] = clamp(v);
    if (Array.isArray(o.mask_urls) && o.mask_urls[0]) masks[key] = o.mask_urls[0];
  }

  const vals = Object.values(scores);
  if (overall === null && vals.length) overall = clamp(vals.reduce((a, b) => a + b, 0) / vals.length);

  return { scores, masks, overall, skinAge, baseImage, skinType };
}

module.exports = { normalize };
