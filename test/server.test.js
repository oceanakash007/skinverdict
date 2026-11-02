// Server integration tests against the local mock YouCam API (no real units used): `npm test`
const assert = require("assert");
const path = require("path");
const { spawn } = require("child_process");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log("  ✓", name); };

const MOCK = 4519, LIVE = 4520, NOKEY = 4521, LIVE2 = 4522;
const fsx = require("fs"), os = require("os");
const SYNC_DIR = fsx.mkdtempSync(path.join(os.tmpdir(), "svsync-"));
const procs = [];
function run(file, env) {
  const p = spawn(process.execPath, [path.join(__dirname, "..", file)], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  p.out = "";
  p.stdout.on("data", (d) => (p.out += d));
  p.stderr.on("data", (d) => (p.out += d));
  procs.push(p);
  return p;
}
const get = (port, p, opts) => fetch(`http://localhost:${port}${p}`, opts).then(async (r) => ({ status: r.status, headers: r.headers, body: await r.json().catch(() => ({})) }));
const IMG = "data:image/jpeg;base64," + Buffer.alloc(2000, 7).toString("base64");

(async () => {
  run("test/mock-youcam.js", { MOCK_PORT: MOCK });
  await sleep(1500); // mock must be up before the app verifies its key
  const live = run("server.js", { PORT: LIVE, YOUCAM_API_KEY: "test", YOUCAM_API_BASE: `http://localhost:${MOCK}`, SCAN_LIMIT_PER_IP: "3" });
  run("server.js", { PORT: NOKEY, YOUCAM_API_KEY: "", YOUCAM_API_BASE: `http://localhost:${MOCK}` });
  run("server.js", { PORT: LIVE2, YOUCAM_API_KEY: "test", YOUCAM_API_BASE: `http://localhost:${MOCK}`, SYNC_DIR, STATS_TOKEN: "secret" });
  await sleep(4500);
  console.log("server");
  try {
    await t("health endpoint", async () => {
      const r = await get(LIVE, "/api/health");
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.body.analysis, "live");
    });
    await t("security headers present", async () => {
      const r = await fetch(`http://localhost:${LIVE}/`);
      assert.ok(r.headers.get("content-security-policy").includes("default-src 'self'"));
      assert.strictEqual(r.headers.get("x-content-type-options"), "nosniff");
      assert.ok(!r.headers.get("x-powered-by"));
    });
    await t("full scan flow: upload -> task -> poll -> scores", async () => {
      const s = await get(LIVE, "/api/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: IMG }) });
      assert.strictEqual(s.status, 200, JSON.stringify(s.body));
      let r;
      for (let i = 0; i < 10; i++) {
        await sleep(800);
        r = await get(LIVE, "/api/scan/" + s.body.taskId);
        if (r.body.status === "success") break;
      }
      assert.strictEqual(r.body.status, "success");
      assert.strictEqual(r.body.live, true);
      assert.strictEqual(Object.keys(r.body.result.scores).length, 12);
    });
    await t("rejects bad image payloads and bad task ids", async () => {
      assert.strictEqual((await get(LIVE, "/api/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: "data:text/html;base64,PHNjcmlwdD4=" }) })).status, 400);
      assert.strictEqual((await get(LIVE, "/api/scan/" + encodeURIComponent("../../etc"))).status, 400);
    });
    await t("no-key server: clear, key-free error message", async () => {
      const r = await get(NOKEY, "/api/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: IMG }) });
      assert.strictEqual(r.status, 503);
      assert.ok(!/YOUCAM|API_KEY|env|\.env/i.test(r.body.error), r.body.error);
      const c = await get(NOKEY, "/api/config");
      assert.strictEqual(c.body.live, false);
      assert.ok(!JSON.stringify(c.body).match(/YOUCAM|missing|rejected/i));
    });
    await t("barcode route validates input", async () => {
      assert.strictEqual((await get(LIVE, "/api/product/abc")).status, 400);
    });
    await t("per-visitor daily scan quota", async () => {
      let last;
      for (let i = 0; i < 4; i++) last = await get(LIVE, "/api/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: IMG }) });
      assert.strictEqual(last.status, 429);
    });
    await t("general API rate limit kicks in", async () => {
      let limited = false;
      for (let i = 0; i < 130 && !limited; i++) limited = (await get(NOKEY, "/api/config")).status === 429;
      assert.ok(limited);
    });
    await t("tone analysis + skin simulation flows (mock)", async () => {
      for (const [f, key] of [["tone", "skinColor"], ["simulate", "imageUrl"]]) {
        const s = await get(LIVE2, "/api/" + f, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: IMG, concerns: ["acne"] }) });
        assert.strictEqual(s.status, 200, f + " " + JSON.stringify(s.body));
        let r;
        for (let i = 0; i < 8; i++) { await sleep(700); r = await get(LIVE2, `/api/${f}/${s.body.taskId}`); if (r.body.status === "success") break; }
        assert.ok(r.body[key], f + " " + JSON.stringify(r.body));
      }
    });
    await t("encrypted sync: store, wrong token rejected, fetch", async () => {
      const id = "a".repeat(32), body = { iv: "aaaa", salt: "bbbb", data: "Y2lwaGVy", token: "dG9rZW4=" };
      assert.strictEqual((await get(LIVE2, "/api/sync/" + id, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).status, 200);
      assert.strictEqual((await get(LIVE2, "/api/sync/" + id, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, token: "b3RoZXI=" }) })).status, 403);
      const g = await get(LIVE2, `/api/sync/${id}/get`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: body.token }) });
      assert.strictEqual(g.body.data, body.data);
      assert.strictEqual((await get(LIVE2, "/api/sync/xyz", { method: "PUT", headers: { "Content-Type": "application/json" }, body: "{}" })).status, 400);
    });
    await t("analytics + client errors accepted; stats protected", async () => {
      assert.strictEqual((await fetch(`http://localhost:${LIVE2}/api/events`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "verdict", props: { verdict: "good" } }) })).status, 204);
      assert.strictEqual((await fetch(`http://localhost:${LIVE2}/api/events`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "evil" }) })).status, 400);
      assert.strictEqual((await fetch(`http://localhost:${LIVE2}/api/client-error`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: "x" }) })).status, 204);
      assert.strictEqual((await get(LIVE2, "/api/stats")).status, 404);
      const st = await get(LIVE2, "/api/stats?token=secret");
      assert.strictEqual(st.body.events.verdict, 1);
    });
    await t("logs are structured JSON", async () => {
      const line = live.out.split("\n").find((l) => l.includes("scan_done"));
      assert.ok(line && JSON.parse(line).event === "scan_done");
    });
    console.log(`\n${n} server tests passed.`);
  } catch (e) {
    console.error("FAILED:", e.message);
    process.exitCode = 1;
  } finally {
    procs.forEach((p) => p.kill());
  }
})();
