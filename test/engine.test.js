// Decision-engine tests: `npm test`
const assert = require("assert");
const E = require("../public/js/engine.js");
global.window = {};
require("../public/js/products.js");
const P = Object.fromEntries(window.SAMPLE_PRODUCTS.map((p) => [p.name, p.ingredients]));
let n = 0;
const t = (name, fn) => { fn(); n++; console.log("  ✓", name); };

const oily = { acne: 58, wrinkle: 84, redness: 63, dark_circle_v2: 71, pore: 61, texture: 69, age_spot: 77, moisture: 66, eye_bag: 80, oiliness: 55, radiance: 72, firmness: 88 };
const dry = { ...oily, acne: 85, oiliness: 88, pore: 80, redness: 55, moisture: 50 };
const healthy = Object.fromEntries(Object.keys(oily).map((k) => [k, 90]));

console.log("engine");
t("database is substantial", () => {
  assert.ok(E.ACTIVES.length >= 55, "actives: " + E.ACTIVES.length);
  assert.ok(E.WATCHOUTS.length >= 8);
  assert.ok(E.BASE.length >= 20);
});
t("BHA toner targets oily/acne needs", () => {
  const r = E.evaluateProduct(oily, P["2% BHA Clarifying Toner"]);
  assert.ok(["good", "caution"].includes(r.verdict));
  assert.ok(r.targets.includes("acne") && r.targets.includes("oiliness"));
});
t("niacinamide serum is a good match for oily skin", () => {
  assert.strictEqual(E.evaluateProduct(oily, P["10% Niacinamide + Zinc Serum"]).verdict, "good");
});
t("coconut balm is skipped for acne-prone skin, with a pore-clogging caution", () => {
  const r = E.evaluateProduct(oily, P["Rich Coconut Night Balm"]);
  assert.strictEqual(r.verdict, "skip");
  assert.ok(r.cautions.some((c) => c.id === "comedogenic"));
});
t("barrier cream is good for dry, red skin", () => {
  assert.strictEqual(E.evaluateProduct(dry, P["Barrier Repair Cream"]).verdict, "good");
});
t("fragraced alcohol vitamin C is not good for dry, red skin; fragrance warnings merged", () => {
  const r = E.evaluateProduct(dry, P["Glow Vitamin C Serum"]);
  assert.notStrictEqual(r.verdict, "good");
  assert.strictEqual(r.cautions.filter((c) => /fragrance|allergen|essential/i.test(c.name)).length, 1);
});
t("healthy skin gets a neutral verdict", () => {
  assert.strictEqual(E.evaluateProduct(healthy, P["Retinol 0.3% Night Serum"]).verdict, "neutral");
});
t("actives after the preservative are flagged as low-dose (except retinoids/peptides)", () => {
  const r = E.evaluateProduct(oily, "Aqua, Glycerin, Phenoxyethanol, Niacinamide, Retinol");
  assert.ok(r.found.find((f) => f.id === "niacinamide").late);
  assert.ok(!r.found.find((f) => f.id === "retinol").late);
});
t("fatty alcohols are not treated as drying alcohol", () => {
  const r = E.evaluateProduct(dry, "Aqua, Cetearyl Alcohol, Cetyl Alcohol, Glycerin, Ceramide NP");
  assert.ok(!r.cautions.some((c) => c.id === "alcohol"));
  assert.ok(r.breakdown.find((b) => b.name === "cetearyl alcohol").status === "base");
});
t("drying alcohol is flagged for low hydration", () => {
  assert.ok(E.evaluateProduct(dry, "Alcohol Denat., Aqua, Glycerin, Sodium Hyaluronate").cautions.some((c) => c.id === "alcohol"));
});
t("most ingredients in a typical list are recognised", () => {
  const r = E.evaluateProduct(oily, P["Barrier Repair Cream"]);
  assert.ok(r.recognised / r.parsedCount >= 0.9, `${r.recognised}/${r.parsedCount}`);
});
t("stacked exfoliants trigger a caution", () => {
  const r = E.evaluateProduct({ ...oily, redness: 80, moisture: 80 }, "Aqua, Glycolic Acid, Salicylic Acid, Retinol, Glycerin");
  assert.ok(r.cautions.some((c) => c.id === "stacking"));
});

t("stated concentrations are parsed and judged against typical ranges", () => {
  const c = E.parseConcentrations("Niacinamide 20% Serum, Aqua");
  assert.strictEqual(c[0].pct, 20);
  assert.strictEqual(c[0].level, "high");
  const r = E.evaluateProduct(dry, "Aqua, Niacinamide, Glycerin, Ceramide NP", "20% Niacinamide booster");
  assert.ok(r.cautions.some((x) => x.id === "high-pct"));
});

console.log("sanitising");
t("strips HTML, scripts and entities", () => {
  const list = E.parseIngredients('<script>alert(1)</script><b>Aqua</b>, <img src=x onerror=alert(1)>Niacinamide, Glycerin &amp; more');
  assert.ok(list.every((i) => !/[<>]/.test(i) && !/alert/.test(i)), JSON.stringify(list));
  assert.ok(list.includes("aqua") && list.includes("niacinamide"));
});
t("strips control/bidi characters and caps length and item count", () => {
  assert.ok(!/[‮\u0000]/.test(E.sanitizeText("Aqua‮, Gly\u0000cerin")));
  assert.ok(E.sanitizeText("x".repeat(50000)).length <= 6000);
  assert.ok(E.parseIngredients(Array(500).fill("Aqua").join(",")).length <= 150);
});
t("drops marketing text before 'Ingredients:'", () => {
  const list = E.parseIngredients("Best serum ever! Ingredients: Aqua, Niacinamide, Zinc PCA");
  assert.deepStrictEqual(list, ["aqua", "niacinamide", "zinc pca"]);
});

console.log("progress");
const base = { scores: oily };
t("improvement => keep", () => assert.strictEqual(E.evaluateProgress(base, { scores: { ...oily, acne: 66, pore: 65, oiliness: 60 } }, ["acne", "pore", "oiliness"], 30).verdict, "keep"));
t("too early => wait", () => assert.strictEqual(E.evaluateProgress(base, { scores: { ...oily, acne: 59 } }, ["acne"], 10).verdict, "wait"));
t("redness drop => stop", () => assert.strictEqual(E.evaluateProgress(base, { scores: { ...oily, redness: 52 } }, ["acne"], 20).verdict, "stop"));
t("flat after 6 weeks => switch", () => assert.strictEqual(E.evaluateProgress(base, { scores: { ...oily } }, ["acne"], 45).verdict, "switch"));
t("compareScans returns all shared concerns", () => assert.strictEqual(E.compareScans(base, { scores: dry }).length, 12));
t("shopping list gives 3 priorities", () => assert.strictEqual(E.shoppingList(oily).length, 3));

console.log(`\n${n} engine tests passed.`);
