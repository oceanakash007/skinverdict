// One-off check that your YouCam key works: runs a real Skin Analysis on a photo and prints the raw JSON.
// Usage: node scripts/test-api.js path/to/selfie.jpg      (costs ~14 units, only if it succeeds)
require("dotenv").config();
const fs = require("fs");
const { startSkinAnalysis, checkSkinAnalysis } = require("../lib/youcam");
const { normalize } = require("../lib/normalize");

(async () => {
  const file = process.argv[2];
  if (!file) return console.log("Usage: node scripts/test-api.js path/to/selfie.jpg");
  const buf = fs.readFileSync(file);
  const type = /\.png$/i.test(file) ? "image/png" : "image/jpeg";
  console.log("Uploading + creating task…");
  const taskId = await startSkinAnalysis(buf, type);
  console.log("task_id:", taskId);
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const r = await checkSkinAnalysis(taskId);
    process.stdout.write(".");
    if (r.status === "success") {
      fs.writeFileSync("last-result.json", JSON.stringify(r.raw, null, 2));
      console.log("\nRaw result saved to last-result.json");
      console.log("Normalized:", JSON.stringify(normalize(r.raw), null, 2));
      return;
    }
  }
  console.log("\nTimed out.");
})().catch((e) => {
  console.error("\nFAILED:", e.message);
  if (e.raw) console.error(JSON.stringify(e.raw, null, 2));
  process.exit(1);
});
