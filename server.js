const path = require("path");
// Load .env from the project folder even if the server is started from another directory.
require("dotenv").config({ path: path.join(__dirname, ".env") });
const http = require("http");
const https = require("https");
const express = require("express");
const log = require("./lib/log");
const { rateLimit } = require("./lib/ratelimit");
const { startSkinAnalysis, checkSkinAnalysis, verifyKey, getKey, YouCamError, startToneAnalysis, startSkinSimulation, checkTask, findImageUrl } = require("./lib/youcam");
const fs = require("fs");
const crypto = require("crypto");
const { normalize } = require("./lib/normalize");
const { lookupBarcode } = require("./lib/productLookup");
const demo = require("./fixtures/demo-result.json");
const pkg = require("./package.json");

const app = express();
app.set("trust proxy", 1); // behind exactly one proxy (Render); prevents spoofed X-Forwarded-For
app.disable("x-powered-by");

// ---------- security headers ----------
app.use((_req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'wasm-unsafe-eval'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob: https:",
      "media-src 'self' blob:",
      "connect-src 'self' https://storage.googleapis.com",
      "worker-src 'self'",
      "manifest-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; ")
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(self), microphone=(), geolocation=()");
  next();
});

app.use(express.json({ limit: "12mb" }));
app.use(
  express.static(path.join(__dirname, "public"), {
    setHeaders: (res, file) => {
      if (file.endsWith("sw.js")) res.setHeader("Cache-Control", "no-cache");
    },
  })
);

// Face-tracking engine (MediaPipe, Apache-2.0), served from our own origin.
app.use("/vendor/mediapipe", express.static(path.join(__dirname, "node_modules/@mediapipe/tasks-vision"), { maxAge: "7d" }));
// Pack-label OCR (Tesseract.js, Apache-2.0) + English data, all served locally.
app.use("/vendor/tesseract", express.static(path.join(__dirname, "node_modules/tesseract.js/dist"), { maxAge: "7d" }));
app.use("/vendor/tesseract-core", express.static(path.join(__dirname, "node_modules/tesseract.js-core"), { maxAge: "7d" }));
app.use("/vendor/tessdata", express.static(path.join(__dirname, "node_modules/@tesseract.js-data/eng/4.0.0"), { maxAge: "7d" }));

// ---------- rate limits (all API routes) ----------
const apiLimiter = rateLimit({ windowMs: 60_000, max: 120, name: "api" }); // polling every 2s = 30/min
const scanLimiter = rateLimit({ windowMs: 60_000, max: 6, name: "scan" });
const lookupLimiter = rateLimit({ windowMs: 60_000, max: 20, name: "lookup" });
app.use("/api", apiLimiter);

const PER_IP_LIMIT = Number(process.env.SCAN_LIMIT_PER_IP || 10);
const DAILY_LIMIT = Number(process.env.SCAN_LIMIT_PER_DAY || 40);
const startedAt = Date.now();

// ---------- YouCam key status (checked at startup with a free call) ----------
let keyStatus = { ok: false, reason: getKey() ? "checking" : "missing" };
async function refreshKey() {
  keyStatus = await verifyKey();
  // Detailed key diagnostics go to the server log only, never to the browser.
  if (keyStatus.ok) log.info("youcam_key_ok", { server: keyStatus.base, msg: "Scans are LIVE" });
  else if (keyStatus.reason === "missing") log.warn("youcam_key_missing", { msg: "Set YOUCAM_API_KEY in .env (local) or Render > Environment. Only the sample scan works." });
  else log.error("youcam_key_rejected", { details: keyStatus.details });
  // Network hiccup at boot (or key fixed later)? Re-check in the background.
  if (!keyStatus.ok && keyStatus.reason !== "missing") setTimeout(refreshKey, 20000).unref();
  return keyStatus;
}

// ---------- daily scan quota (protects free API units) ----------
let day = new Date().toISOString().slice(0, 10);
let total = 0;
const perIp = new Map();
function rollDay() {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== day) {
    day = today;
    total = 0;
    perIp.clear();
  }
}
function allowScan(ip) {
  rollDay();
  const n = perIp.get(ip) || 0;
  if (n >= PER_IP_LIMIT || total >= DAILY_LIMIT) return false;
  perIp.set(ip, n + 1);
  total += 1;
  return true;
}
const scansLeft = (ip) => (rollDay(), Math.max(0, Math.min(PER_IP_LIMIT - (perIp.get(ip) || 0), DAILY_LIMIT - total)));

// ---------- client-safe error messages ----------
const FRIENDLY = {
  error_src_face_too_small: "Your face is too small in the photo. Move closer so your face fills most of the frame.",
  error_src_face_out_of_bound: "Part of your face is outside the photo. Center your whole face: forehead, cheeks and chin.",
  error_lighting_dark: "The lighting is too dark. Face a window or a bright light and try again.",
  error_below_min_image_size: "The photo is too small. Use a photo at least 480px on its short side.",
  error_exceed_max_image_size: "The photo is too large. Try a smaller photo.",
  error_no_face: "We couldn't find a face. Use a front-facing selfie with eyes open and mouth closed.",
  error_face_not_found: "We couldn't find a face. Use a front-facing selfie with eyes open and mouth closed.",
};
const SERVICE_DOWN = "The skin analysis service isn't available on this server right now. You can still explore with the sample scan.";

function sendError(res, err, ctx = {}) {
  const status = err instanceof YouCamError ? err.status : 500;
  let message = (err.code && FRIENDLY[err.code]) || null;
  if (!message) {
    if (status === 401 || status === 503) message = SERVICE_DOWN;
    else if (/insufficient|credit|unit/i.test(JSON.stringify(err.raw || ""))) message = "This demo has used up its analysis credits for now. Try the sample scan.";
    else if (status === 422) message = "The photo couldn't be analyzed. Try a well-lit, front-facing selfie.";
    else message = "Something went wrong while analyzing. Please try again.";
  }
  // Full details (including raw YouCam responses) stay in the server log.
  log.error("scan_error", { ...ctx, status, code: err.code || null, detail: err.message, raw: err.raw ? JSON.stringify(err.raw).slice(0, 800) : undefined });
  res.status(status === 401 ? 503 : status).json({ error: message, code: err.code || null });
}

// ---------- routes ----------
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, version: pkg.version, uptimeSec: Math.round((Date.now() - startedAt) / 1000), analysis: keyStatus.ok ? "live" : "unavailable", scansToday: total });
});

app.get("/api/config", (req, res) => {
  res.json({ live: keyStatus.ok, scansLeft: scansLeft(req.ip), perIpLimit: PER_IP_LIMIT });
});

// 1) Upload the selfie to YouCam and start a Skin Analysis task.
app.post("/api/scan", scanLimiter, async (req, res) => {
  try {
    if (!keyStatus.ok) {
      await refreshKey(); // maybe the key was fixed since startup
      if (!keyStatus.ok) return res.status(503).json({ error: SERVICE_DOWN, code: "unavailable" });
    }
    const m = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(req.body?.image || "");
    if (!m) return res.status(400).json({ error: "Send a JPG or PNG image." });
    const buffer = Buffer.from(m[2], "base64");
    if (buffer.length > 10 * 1024 * 1024) return res.status(400).json({ error: "Image must be under 10 MB." });
    if (!allowScan(req.ip)) return res.status(429).json({ error: "Daily scan limit reached for this demo. Try the sample scan instead.", code: "quota" });
    const taskId = await startSkinAnalysis(buffer, m[1]);
    log.info("scan_started", { taskId, kb: Math.round(buffer.length / 1024) });
    res.json({ taskId, scansLeft: scansLeft(req.ip) });
  } catch (err) {
    sendError(res, err, { route: "scan_start" });
  }
});

// 2) Poll the task. The browser calls this every ~2s until it's done.
app.get("/api/scan/:taskId", async (req, res) => {
  try {
    if (!/^[A-Za-z0-9_\-+/=.]{6,200}$/.test(req.params.taskId) || req.params.taskId.includes("..")) return res.status(400).json({ error: "Invalid scan id." });
    const r = await checkSkinAnalysis(req.params.taskId);
    if (r.status !== "success") return res.json({ status: "running" });
    const result = normalize(r.raw);
    if (!Object.keys(result.scores).length) {
      log.error("scan_no_scores", { taskId: req.params.taskId, raw: JSON.stringify(r.raw).slice(0, 1500) });
      return res.status(502).json({ error: "The analysis finished but returned no scores. Please try another photo." });
    }
    log.info("scan_done", { taskId: req.params.taskId, overall: result.overall, scores: result.scores });
    res.json({ status: "success", result, live: true });
  } catch (err) {
    sendError(res, err, { route: "scan_poll", taskId: req.params.taskId });
  }
});

// ---------- extra YouCam features (fail-safe: the UI hides them if they error) ----------
function parseImage(req, res) {
  const m = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(req.body?.image || "");
  if (!m) { res.status(400).json({ error: "Send a JPG or PNG image." }); return null; }
  const buffer = Buffer.from(m[2], "base64");
  if (buffer.length > 10 * 1024 * 1024) { res.status(400).json({ error: "Image must be under 10 MB." }); return null; }
  return { buffer, type: m[1] };
}
const FEATURES = { tone: "skin-tone-analysis", simulate: "skin-simulation" };
app.post("/api/:feature(tone|simulate)", scanLimiter, async (req, res) => {
  try {
    if (!keyStatus.ok) return res.status(503).json({ error: SERVICE_DOWN, code: "unavailable" });
    const img = parseImage(req, res);
    if (!img) return;
    if (!allowScan(req.ip)) return res.status(429).json({ error: "Daily limit reached for this demo.", code: "quota" });
    const concerns = Array.isArray(req.body.concerns) ? req.body.concerns.filter((c) => typeof c === "string").slice(0, 6) : [];
    const taskId = req.params.feature === "tone" ? await startToneAnalysis(img.buffer, img.type) : await startSkinSimulation(img.buffer, img.type, concerns);
    log.info(`${req.params.feature}_started`, { taskId });
    res.json({ taskId });
  } catch (err) {
    sendError(res, err, { route: req.params.feature });
  }
});
app.get("/api/:feature(tone|simulate)/:taskId", async (req, res) => {
  try {
    if (!/^[A-Za-z0-9_\-+/=.]{6,200}$/.test(req.params.taskId) || req.params.taskId.includes("..")) return res.status(400).json({ error: "Invalid id." });
    const r = await checkTask(FEATURES[req.params.feature], req.params.taskId);
    if (r.status !== "success") return res.json({ status: "running" });
    if (req.params.feature === "tone") {
      const c = r.raw?.data?.results?.color || r.raw?.data?.results || {};
      const hex = /^#?[0-9a-f]{6}$/i.test(c.skin_color || "") ? (c.skin_color.startsWith("#") ? c.skin_color : "#" + c.skin_color) : null;
      if (!hex) { log.error("tone_no_color", { raw: JSON.stringify(r.raw).slice(0, 800) }); return res.status(502).json({ error: "No skin colour returned." }); }
      log.info("tone_done", { skin: hex });
      return res.json({ status: "success", skinColor: hex, eyeColor: c.eye_color_name || null, hairColor: c.hair_color || null });
    }
    const url = findImageUrl(r.raw);
    if (!url) { log.error("simulate_no_image", { raw: JSON.stringify(r.raw).slice(0, 800) }); return res.status(502).json({ error: "No preview image returned." }); }
    log.info("simulate_done", {});
    res.json({ status: "success", imageUrl: url });
  } catch (err) {
    sendError(res, err, { route: req.params.feature + "_poll" });
  }
});

// ---------- cloud sync (end-to-end encrypted: the server only ever sees ciphertext) ----------
const SYNC_DIR = process.env.SYNC_DIR || path.join(__dirname, "data", "sync");
fs.mkdirSync(SYNC_DIR, { recursive: true });
const syncLimiter = rateLimit({ windowMs: 60_000, max: 20, name: "sync" });
const syncFile = (id) => path.join(SYNC_DIR, id + ".json");
app.put("/api/sync/:id", syncLimiter, express.json({ limit: "400kb" }), (req, res) => {
  const { id } = req.params;
  if (!/^[a-f0-9]{32}$/.test(id)) return res.status(400).json({ error: "Invalid sync id." });
  const { iv, salt, data, token } = req.body || {};
  if (![iv, salt, data, token].every((v) => typeof v === "string" && /^[A-Za-z0-9+/=]+$/.test(v)) || data.length > 350000) return res.status(400).json({ error: "Invalid payload." });
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const f = syncFile(id);
  if (fs.existsSync(f)) {
    const prev = JSON.parse(fs.readFileSync(f, "utf8"));
    if (prev.tokenHash !== tokenHash) return res.status(403).json({ error: "Wrong sync code." });
  }
  fs.writeFileSync(f, JSON.stringify({ iv, salt, data, tokenHash, updatedAt: new Date().toISOString() }));
  log.info("sync_saved", { bytes: data.length });
  res.json({ ok: true, updatedAt: new Date().toISOString() });
});
app.post("/api/sync/:id/get", syncLimiter, (req, res) => {
  const { id } = req.params;
  if (!/^[a-f0-9]{32}$/.test(id)) return res.status(400).json({ error: "Invalid sync id." });
  const f = syncFile(id);
  if (!fs.existsSync(f)) return res.status(404).json({ error: "No synced data for that code yet." });
  const rec = JSON.parse(fs.readFileSync(f, "utf8"));
  const token = String(req.body?.token || "");
  if (crypto.createHash("sha256").update(token).digest("hex") !== rec.tokenHash) return res.status(403).json({ error: "Wrong sync code." });
  res.json({ iv: rec.iv, salt: rec.salt, data: rec.data, updatedAt: rec.updatedAt });
});

// ---------- privacy-friendly analytics + client error monitoring (no IPs, no personal data stored) ----------
const EVENTS = new Set(["scan_start", "scan_done", "sample_scan", "verdict", "track_start", "share", "barcode", "ocr", "tone", "simulate", "sync", "reminder", "widget_open", "install"]);
const stats = { events: {}, clientErrors: 0, since: new Date().toISOString() };
app.post("/api/events", express.json({ limit: "4kb" }), (req, res) => {
  const name = String(req.body?.name || "");
  if (!EVENTS.has(name)) return res.status(400).end();
  stats.events[name] = (stats.events[name] || 0) + 1;
  const props = {};
  for (const [k, v] of Object.entries(req.body?.props || {}).slice(0, 5)) if (/^[a-z_]{1,20}$/.test(k) && ["string", "number", "boolean"].includes(typeof v)) props[k] = typeof v === "string" ? v.slice(0, 40) : v;
  log.info("event", { name, props });
  res.status(204).end();
});
app.post("/api/client-error", express.json({ limit: "8kb" }), (req, res) => {
  stats.clientErrors++;
  const b = req.body || {};
  log.error("client_error", { message: String(b.message || "").slice(0, 300), source: String(b.source || "").slice(0, 120), line: Number(b.line) || null, stack: String(b.stack || "").slice(0, 800), ua: String(req.headers["user-agent"] || "").slice(0, 120) });
  res.status(204).end();
});
app.get("/api/stats", (req, res) => {
  if (!process.env.STATS_TOKEN || req.query.token !== process.env.STATS_TOKEN) return res.status(404).json({ error: "Not found." });
  res.json({ ...stats, scansToday: total, uptimeSec: Math.round((Date.now() - startedAt) / 1000) });
});

// Sample result so anyone can explore the app without a camera or API units.
app.get("/api/demo", (_req, res) => res.json({ status: "success", result: normalize(demo), sample: true }));

// Barcode -> ingredients (Open Beauty Facts).
app.get("/api/product/:code", lookupLimiter, async (req, res) => {
  const code = req.params.code;
  if (!/^\d{8,14}$/.test(code)) return res.status(400).json({ error: "Barcodes are 8 to 14 digits." });
  try {
    const data = await lookupBarcode(code);
    if (!data.found) return res.status(404).json({ error: "Product not found in the open database. Paste its ingredient list instead." });
    if (!data.ingredients) return res.status(404).json({ error: `Found "${data.name}", but it has no ingredient list in the database. Paste it from the pack.`, name: data.name });
    res.json(data);
  } catch {
    res.status(502).json({ error: "Product lookup is unavailable right now. Paste the ingredient list instead." });
  }
});

app.use("/api", (_req, res) => res.status(404).json({ error: "Not found." }));

// ---------- start ----------
const PORT = Number(process.env.PORT || 3000);
if (require.main === module) {
  http.createServer(app).listen(PORT, () => {
    log.info("server_started", { url: `http://localhost:${PORT}`, version: pkg.version });
    refreshKey();
  });
  if (process.env.HTTPS === "true" || process.argv.includes("--https")) {
    const { getCert } = require("./lib/https");
    const HTTPS_PORT = Number(process.env.HTTPS_PORT || 3443);
    const { key, cert, ips } = getCert(__dirname);
    https.createServer({ key, cert }, app).listen(HTTPS_PORT, () => {
      log.info("https_started", {
        urls: [`https://localhost:${HTTPS_PORT}`, ...ips.map((ip) => `https://${ip}:${HTTPS_PORT}`)],
        phone: "Open the https://<LAN-IP> link on your phone, tap Advanced > Proceed (self-signed certificate), then allow the camera.",
      });
    });
  }
}
module.exports = { app, refreshKey };
