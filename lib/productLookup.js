// Barcode -> ingredient list, via Open Beauty Facts (free, open database of cosmetics).
const log = require("./log");

const cache = new Map(); // barcode -> { at, data }
const TTL = 24 * 3600 * 1000;

async function lookupBarcode(code) {
  const hit = cache.get(code);
  if (hit && Date.now() - hit.at < TTL) return hit.data;
  const url = `https://world.openbeautyfacts.org/api/v2/product/${code}.json?fields=product_name,brands,ingredients_text,ingredients_text_en`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "SkinVerdict/1.0 (hackathon project)" } });
    if (!res.ok) throw new Error("lookup status " + res.status);
    const j = await res.json();
    const p = j.product || {};
    const ingredients = String(p.ingredients_text_en || p.ingredients_text || "").slice(0, 6000);
    const data = j.status === 1 ? { found: true, name: [p.brands, p.product_name].filter(Boolean).join(" ").slice(0, 120), ingredients } : { found: false };
    cache.set(code, { at: Date.now(), data });
    return data;
  } catch (e) {
    log.warn("barcode_lookup_failed", { code, error: e.message });
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { lookupBarcode };
