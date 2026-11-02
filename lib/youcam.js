// YouCam AI Skin Analysis client (server-side only, the API key never reaches the browser).
//
// Flow (YouCam API v2, docs: https://docs.perfectcorp.com/reference/ai_skin_analysis):
//   1. POST /s2s/v2.0/file/skin-analysis  -> file_id + pre-signed PUT url
//   2. PUT the image bytes to that url (with the headers YouCam returns)
//   3. POST /s2s/v2.0/task/skin-analysis  { src_file_id, dst_actions, ... } -> task_id
//   4. GET  /s2s/v2.0/task/skin-analysis/{task_id} until task_status === "success"
// Units are only charged when a task succeeds.

// India-region accounts (yce.makeupar.com) use the makeupar server; global accounts use perfectcorp.
// verifyKey() picks whichever server accepts the key.
const CANDIDATE_BASES = [
  process.env.YOUCAM_API_BASE,
  "https://yce-api-01.makeupar.com",
  "https://yce-api-01.perfectcorp.com",
].filter(Boolean).map((b) => b.replace(/\/$/, ""));
let activeBase = CANDIDATE_BASES[0];
const BASE = () => activeBase;

// 12 SD concerns => 14 units per scan (1,000 units ~= 70 scans).
const DST_ACTIONS = [
  "acne",
  "wrinkle",
  "redness",
  "dark_circle_v2",
  "pore",
  "texture",
  "age_spot",
  "moisture",
  "eye_bag",
  "oiliness",
  "radiance",
  "firmness",
];

class YouCamError extends Error {
  constructor(message, { status = 502, code = null, raw = null } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.raw = raw;
  }
}

// Tolerates common paste mistakes: spaces, quotes, or a leading "Bearer ".
function getKey() {
  return String(process.env.YOUCAM_API_KEY || "").trim().replace(/^["']|["']$/g, "").replace(/^Bearer\s+/i, "").trim();
}

function headers() {
  const key = getKey();
  if (!key) throw new YouCamError("The analysis service is not configured.", { status: 503 });
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

/**
 * Checks the key without spending units: asks YouCam for an upload slot (free; units are only
 * charged when an analysis task succeeds). Tries each regional server and keeps the one that works.
 */
async function verifyKey() {
  if (!getKey()) return { ok: false, reason: "missing" };
  const results = [];
  for (const base of CANDIDATE_BASES) {
    try {
      const res = await fetch(`${base}/s2s/v2.0/file/skin-analysis`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ files: [{ content_type: "image/jpeg", file_name: "check.jpg", file_size: 1000 }] }),
      });
      const { json, text } = await readJson(res);
      if (res.ok && json?.data?.files?.[0]?.file_id) {
        activeBase = base;
        return { ok: true, base };
      }
      results.push(`${base} -> ${res.status} ${text.slice(0, 160)}`);
    } catch (e) {
      results.push(`${base} -> ${e.message}`);
    }
  }
  return { ok: false, reason: "rejected", details: results };
}

async function readJson(res) {
  const text = await res.text();
  try {
    return { json: JSON.parse(text), text };
  } catch {
    return { json: null, text };
  }
}

function findErrorCode(obj) {
  // YouCam returns codes like "error_src_face_too_small" in a few different fields.
  const s = JSON.stringify(obj || {});
  const m = s.match(/error_[a-z_]+/);
  return m ? m[0] : null;
}

async function initUpload(buffer, contentType, feature = "skin-analysis") {
  const body = JSON.stringify({
    files: [{ content_type: contentType, file_name: contentType === "image/png" ? "selfie.png" : "selfie.jpg", file_size: buffer.length }],
  });
  // Feature-scoped endpoint first, generic endpoint as a fallback (both appear in YouCam docs).
  const paths = [`/s2s/v2.0/file/${feature}`, "/s2s/v2.0/file"];
  let last;
  for (const p of paths) {
    const res = await fetch(BASE() + p, { method: "POST", headers: headers(), body });
    const { json, text } = await readJson(res);
    if (res.ok && json?.data?.files?.[0]?.file_id) return json.data.files[0];
    last = new YouCamError(`File upload init failed (${res.status}): ${text.slice(0, 300)}`, {
      status: res.status === 401 || res.status === 403 ? 401 : 502,
      raw: json || text,
    });
    if (res.status !== 404) break;
  }
  throw last;
}

async function uploadImage(buffer, contentType, feature = "skin-analysis") {
  const file = await initUpload(buffer, contentType, feature);
  const req = file.requests?.[0];
  if (!req?.url) throw new YouCamError("File upload init returned no upload URL.");
  const putHeaders = { ...(req.headers || {}) };
  if (!Object.keys(putHeaders).some((h) => h.toLowerCase() === "content-type")) putHeaders["Content-Type"] = contentType;
  const put = await fetch(req.url, { method: req.method || "PUT", headers: putHeaders, body: buffer });
  if (!put.ok) {
    const t = await put.text();
    throw new YouCamError(`Image upload failed (${put.status}): ${t.slice(0, 300)}`);
  }
  return file.file_id;
}

// YouCam's own skin-type classification (+2 units). If the account/version rejects it, we retry without it.
let skinTypeSupported = process.env.YOUCAM_SKIN_TYPE !== "false";
async function createTask(fileId) {
  try {
    return await createTaskWith(fileId, skinTypeSupported ? [...DST_ACTIONS, "skin_type"] : DST_ACTIONS);
  } catch (e) {
    if (skinTypeSupported && e.status === 400 && /skin_type|dst_action/i.test(JSON.stringify(e.raw || ""))) {
      skinTypeSupported = false;
      return createTaskWith(fileId, DST_ACTIONS);
    }
    throw e;
  }
}
async function createTaskWith(fileId, actions) {
  const res = await fetch(`${BASE()}/s2s/v2.0/task/skin-analysis`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      src_file_id: fileId,
      dst_actions: actions,
      miniserver_args: { enable_mask_overlay: false },
      format: "json",
    }),
  });
  const { json, text } = await readJson(res);
  const taskId = json?.data?.task_id || json?.task_id;
  if (!res.ok || !taskId) {
    throw new YouCamError(`Task create failed (${res.status}): ${text.slice(0, 300)}`, {
      status: res.status === 401 || res.status === 403 ? 401 : res.status === 400 ? 400 : 502,
      code: findErrorCode(json),
      raw: json || text,
    });
  }
  return taskId;
}

// ---------- Other YouCam features used by SkinVerdict ----------
// Facial Color Tones Analyzer (documented): skin/eye/lip/hair colours -> foundation shade match.
// Skin Simulation: "how your skin could look". Field names vary by API version, so we try known shapes.
async function postTask(feature, body) {
  const res = await fetch(`${BASE()}/s2s/v2.0/task/${feature}`, { method: "POST", headers: headers(), body: JSON.stringify(body) });
  const { json, text } = await readJson(res);
  const taskId = json?.data?.task_id || json?.task_id;
  if (!res.ok || !taskId) throw new YouCamError(`${feature} create failed (${res.status}): ${text.slice(0, 300)}`, { status: res.status === 401 || res.status === 403 ? 401 : res.status === 400 ? 400 : 502, code: findErrorCode(json), raw: json || text });
  return taskId;
}
async function startToneAnalysis(buffer, contentType) {
  const fileId = await uploadImage(buffer, contentType, "skin-tone-analysis");
  return postTask("skin-tone-analysis", { src_file_id: fileId });
}
const SIM_KEYS = { acne: "acne", pore: "pores", oiliness: "oiliness", redness: "redness", age_spot: "spots", texture: "texture", wrinkle: "wrinkle", radiance: "radiance", dark_circle_v2: "dark_circle", eye_bag: "eye_bags" };
async function startSkinSimulation(buffer, contentType, concerns, intensity = 0.6) {
  const fileId = await uploadImage(buffer, contentType, "skin-simulation");
  const params = {};
  for (const c of concerns) if (SIM_KEYS[c]) params[SIM_KEYS[c]] = intensity;
  if (!Object.keys(params).length) params.radiance = intensity;
  const shapes = [{ src_file_id: fileId, ...params }, { src_file_id: fileId, dst_actions: params }, { src_file_id: fileId, params }];
  let last;
  for (const body of shapes) {
    try { return await postTask("skin-simulation", body); } catch (e) { last = e; if (e.status !== 400) break; }
  }
  throw last;
}
async function checkTask(feature, taskId) {
  const res = await fetch(`${BASE()}/s2s/v2.0/task/${feature}/${encodeURIComponent(taskId)}`, { headers: headers() });
  const { json, text } = await readJson(res);
  if (!res.ok) throw new YouCamError(`${feature} poll failed (${res.status}): ${text.slice(0, 300)}`, { raw: json || text });
  const status = json?.data?.task_status || json?.data?.status || json?.task_status;
  if (status === "success") return { status: "success", raw: json };
  if (status === "error" || status === "failed") throw new YouCamError("Task failed.", { status: 422, code: findErrorCode(json), raw: json });
  return { status: "running" };
}
function findImageUrl(raw) {
  const r = raw?.data?.results ?? raw?.data ?? {};
  const cands = [r.url, r.image_url, r.result_url, r.output?.[0]?.url, r.output?.[0]?.mask_urls?.[0], Array.isArray(r) ? r[0]?.url : null, raw?.data?.result_url];
  const hit = cands.find((u) => typeof u === "string" && /^https?:\/\//.test(u));
  if (hit) return hit;
  const m = JSON.stringify(raw).match(/https:\/\/[^"]+\.(?:jpg|jpeg|png)[^"]*/i);
  return m ? m[0] : null;
}

/** Upload a selfie and start a Skin Analysis task. Returns the YouCam task_id. */
async function startSkinAnalysis(buffer, contentType) {
  const fileId = await uploadImage(buffer, contentType);
  return createTask(fileId);
}

/** Check a task once. Returns { status: "running" } | { status: "success", raw } | throws. */
async function checkSkinAnalysis(taskId) {
  if (!/^[A-Za-z0-9_\-+/=.]+$/.test(taskId)) throw new YouCamError("Invalid task id.", { status: 400 });
  const res = await fetch(`${BASE()}/s2s/v2.0/task/skin-analysis/${encodeURIComponent(taskId)}`, { headers: headers() });
  const { json, text } = await readJson(res);
  if (!res.ok) throw new YouCamError(`Task poll failed (${res.status}): ${text.slice(0, 300)}`, { raw: json || text });
  const status = json?.data?.task_status || json?.data?.status || json?.task_status;
  if (status === "success") return { status: "success", raw: json };
  if (status === "error" || status === "failed") {
    throw new YouCamError(json?.data?.error_message || json?.data?.error || "Skin analysis failed.", {
      status: 422,
      code: findErrorCode(json),
      raw: json,
    });
  }
  return { status: "running" };
}

module.exports = { startSkinAnalysis, checkSkinAnalysis, verifyKey, YouCamError, DST_ACTIONS, getKey, startToneAnalysis, startSkinSimulation, checkTask, findImageUrl };
