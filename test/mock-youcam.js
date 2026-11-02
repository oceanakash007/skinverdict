// Local stand-in for the YouCam API, used to test the full upload -> task -> poll flow
// without spending units. Run `npm run mock`, then start the app with
// YOUCAM_API_BASE=http://localhost:4010 YOUCAM_API_KEY=test npm start
const express = require("express");
const demo = require("../fixtures/demo-result.json");
const app = express();
const PORT = Number(process.env.MOCK_PORT || 4010);
const tasks = new Map();
const files = new Set();

// 1x1 translucent red PNG as a stand-in detection mask.
const MASK = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFgwJ/l8cYBQAAAABJRU5ErkJggg==", "base64");

app.use((req, res, next) => {
  if (req.path.startsWith("/s2s") && req.headers.authorization !== "Bearer test") return res.status(401).json({ status: 401, error: "bad key" });
  next();
});
app.post("/s2s/v2.0/file/skin-analysis", express.json(), (req, res) => {
  const f = req.body.files?.[0];
  if (!f?.file_size) return res.status(400).json({ error: "files required" });
  const id = "file" + Date.now();
  res.json({ status: 200, data: { files: [{ file_id: id, requests: [{ method: "PUT", url: `http://localhost:${PORT}/upload/${id}`, headers: { "Content-Type": f.content_type, "Content-Length": String(f.file_size) } }] }] } });
});
app.put("/upload/:id", express.raw({ type: "*/*", limit: "20mb" }), (req, res) => {
  if (!req.body?.length) return res.status(400).send("empty");
  files.add(req.params.id);
  res.sendStatus(200);
});
app.post("/s2s/v2.0/task/skin-analysis", express.json(), (req, res) => {
  if (!files.has(req.body.src_file_id)) return res.status(404).json({ status: 404, error: "file not found" });
  if (!Array.isArray(req.body.dst_actions) || !req.body.dst_actions.length) return res.status(400).json({ error: "dst_actions" });
  const id = "task" + Date.now();
  tasks.set(id, { t: Date.now(), actions: req.body.dst_actions });
  res.json({ status: 200, data: { task_id: id } });
});
app.get("/s2s/v2.0/task/skin-analysis/:id", (req, res) => {
  const t = tasks.get(req.params.id);
  if (!t) return res.status(404).json({ error: "no task" });
  if (Date.now() - t.t < 3000) return res.json({ status: 200, data: { task_status: "running" } });
  const output = demo.data.results.output.map((o) => (o.ui_score !== undefined ? { ...o, mask_urls: [`http://localhost:${PORT}/mask.png`] } : o));
  res.json({ status: 200, data: { task_status: "success", results: { output } } });
});
app.post("/s2s/v2.0/file/:feature(skin-tone-analysis|skin-simulation)", express.json(), (req, res) => {
  const f = req.body.files?.[0];
  const id = "file" + Date.now() + Math.random().toString(16).slice(2, 6);
  res.json({ status: 200, data: { files: [{ file_id: id, requests: [{ method: "PUT", url: `http://localhost:${PORT}/upload/${id}`, headers: { "Content-Type": f.content_type } }] }] } });
});
app.post("/s2s/v2.0/task/:feature(skin-tone-analysis|skin-simulation)", express.json(), (req, res) => {
  if (!files.has(req.body.src_file_id)) return res.status(404).json({ error: "file not found" });
  const id = "x" + req.params.feature + Date.now();
  tasks.set(id, { t: Date.now(), feature: req.params.feature });
  res.json({ status: 200, data: { task_id: id } });
});
app.get("/s2s/v2.0/task/:feature(skin-tone-analysis|skin-simulation)/:id", (req, res) => {
  const t = tasks.get(req.params.id);
  if (!t) return res.status(404).json({ error: "no task" });
  if (Date.now() - t.t < 1500) return res.json({ status: 200, data: { task_status: "running" } });
  if (t.feature === "skin-tone-analysis") return res.json({ status: 200, data: { task_status: "success", results: { color: { skin_color: "#b9947c", eye_color_name: "Brown", hair_color: "#2b1d16" } } } });
  res.json({ status: 200, data: { task_status: "success", results: { url: `http://localhost:${PORT}/mask.png` } } });
});
app.get("/mask.png", (_req, res) => res.type("png").send(MASK));
app.listen(PORT, () => console.log("Mock YouCam API on http://localhost:" + PORT));
