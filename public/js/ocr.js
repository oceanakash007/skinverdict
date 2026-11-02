// Lazy-loaded: reads an ingredient list from a photo of the pack (Tesseract.js, runs on-device; served locally).
(function (root) {
  let workerP = null;
  async function getWorker(onProgress) {
    if (!workerP) {
      workerP = (async () => {
        await new Promise((ok, fail) => {
          const s = document.createElement("script");
          s.src = "/vendor/tesseract/tesseract.min.js";
          s.onload = ok; s.onerror = () => fail(new Error("Couldn't load the text reader."));
          document.head.appendChild(s);
        });
        return root.Tesseract.createWorker("eng", 1, {
          workerPath: "/vendor/tesseract/worker.min.js",
          corePath: "/vendor/tesseract-core",
          langPath: "/vendor/tessdata",
          workerBlobURL: false,
          logger: (m) => onProgress && m.status === "recognizing text" && onProgress(Math.round(m.progress * 100)),
        });
      })().catch((e) => { workerP = null; throw e; });
    }
    return workerP;
  }

  // Pre-process: greyscale + contrast stretch + upscale small images; labels are often tiny and glossy.
  async function prep(file) {
    const img = await createImageBitmap(file);
    const scale = Math.min(2.5, Math.max(1, 1800 / Math.max(img.width, img.height)));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
    const x = c.getContext("2d", { willReadFrequently: true });
    x.drawImage(img, 0, 0, c.width, c.height);
    const d = x.getImageData(0, 0, c.width, c.height);
    let min = 255, max = 0;
    for (let i = 0; i < d.data.length; i += 4) {
      const l = 0.299 * d.data[i] + 0.587 * d.data[i + 1] + 0.114 * d.data[i + 2];
      d.data[i] = d.data[i + 1] = d.data[i + 2] = l;
      if (l < min) min = l; if (l > max) max = l;
    }
    const k = 255 / Math.max(1, max - min);
    for (let i = 0; i < d.data.length; i += 4) d.data[i] = d.data[i + 1] = d.data[i + 2] = (d.data[i] - min) * k;
    x.putImageData(d, 0, 0);
    return c;
  }

  function clean(text) {
    let t = text.replace(/\r/g, "").replace(/-\n(?=[a-z])/gi, "").replace(/\n+/g, " ");
    const i = t.search(/ingr[eé]dients?\s*[:;.]?/i);
    if (i >= 0) t = t.slice(i).replace(/^ingr[eé]dients?\s*[:;.]?\s*/i, "");
    t = t.replace(/\s*[|]\s*/g, ", ").replace(/\s{2,}/g, " ").replace(/[^\w\s,.()\/%+&'-]/g, " ");
    return t.trim().slice(0, 6000);
  }

  async function read(file, onProgress) {
    const [worker, canvas] = await Promise.all([getWorker(onProgress), prep(file)]);
    const { data } = await worker.recognize(canvas);
    return { text: clean(data.text || ""), confidence: Math.round(data.confidence || 0) };
  }

  root.SkinOCR = { read, clean };
})(window);
