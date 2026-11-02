/* SkinVerdict front end: scan -> decide -> track. Vanilla JS, no build step. */
(() => {
  const E = window.SkinEngine;
  const S = window.SkinStore;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const SYM = { attention: "!", watch: "~", good: "✓" };

  // ---------- state ----------
  let scans = S.get("scans", []).map(S.validScan).filter(Boolean);
  let trials = S.get("trials", []).map(S.validTrial).filter(Boolean);
  let current = scans[scans.length - 1] || null;
  let photoURL = null; // this session's photo only, never persisted
  let masks = {};
  let config = { live: false, scansLeft: null };
  const saveScans = () => (S.set("scans", scans) || toast("Couldn't save. Your browser storage may be full or disabled."), autoSync());
  const saveTrials = () => (S.set("trials", trials) || toast("Couldn't save. Your browser storage may be full or disabled."), autoSync());

  // ---------- privacy-friendly analytics + error monitoring (event names only, no personal data) ----------
  function track(name, props) {
    try {
      const body = JSON.stringify({ name, props: props || {} });
      if (!(navigator.sendBeacon && navigator.sendBeacon("/api/events", new Blob([body], { type: "application/json" })))) fetch("/api/events", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
    } catch { /* never break the app for analytics */ }
  }
  let errCount = 0;
  function reportError(message, source, line, stack) {
    if (++errCount > 5) return; // cap per page view
    try { fetch("/api/client-error", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: String(message).slice(0, 300), source: String(source || "").replace(location.origin, "").slice(0, 120), line, stack: String(stack || "").slice(0, 800) }), keepalive: true }).catch(() => {}); } catch { /* ignore */ }
  }
  window.addEventListener("error", (e) => reportError(e.message, e.filename, e.lineno, e.error && e.error.stack));
  window.addEventListener("unhandledrejection", (e) => reportError(e.reason && e.reason.message || e.reason, "promise", null, e.reason && e.reason.stack));
  window.addEventListener("appinstalled", () => track("install"));

  const toast = (msg) => {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove("show"), 3200);
  };
  const daysBetween = (a, b) => Math.max(0, Math.round((new Date(b) - new Date(a)) / 86400000));
  const fmtDate = (d) => new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

  // ---------- network: JSON fetch with retry + backoff (idempotent requests only) ----------
  async function fetchJSON(url, opts = {}, { retries = 0, onRetry } = {}) {
    let attempt = 0;
    for (;;) {
      try {
        if (!navigator.onLine) throw Object.assign(new Error("You're offline. Check your connection."), { offline: true });
        const res = await fetch(url, opts);
        let body = {};
        try { body = await res.json(); } catch { /* empty body */ }
        if (res.ok) return body;
        const err = Object.assign(new Error(body.error || `Request failed (${res.status})`), { status: res.status, code: body.code });
        const retryable = res.status >= 500 || res.status === 429;
        if (!retryable || attempt >= retries) throw err;
        const ra = Number(res.headers.get("Retry-After"));
        await backoff(attempt++, onRetry, ra ? ra * 1000 : 0);
      } catch (e) {
        if (e.status || attempt >= retries) throw e;
        await backoff(attempt++, onRetry); // network error / offline
      }
    }
  }
  async function backoff(attempt, onRetry, min = 0) {
    const wait = Math.max(min, Math.min(8000, 800 * 2 ** attempt)) + Math.random() * 300;
    onRetry && onRetry(attempt + 1, wait);
    await sleep(wait);
  }

  // Lazy-load optional modules (code splitting: barcode + share only load when used).
  const loaded = {};
  const loadScript = (src) =>
    (loaded[src] ||= new Promise((ok, fail) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = ok;
      s.onerror = () => { delete loaded[src]; fail(new Error("Couldn't load " + src)); };
      document.head.appendChild(s);
    }));

  // ---------- theme ----------
  function syncThemeButton() {
    const dark = document.documentElement.getAttribute("data-theme") === "dark";
    $("#theme-toggle").setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
    $("#theme-toggle").textContent = dark ? "☀" : "☾";
  }
  $("#theme-toggle").addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("sv_theme", next); } catch { /* ignore */ }
    syncThemeButton();
  });
  syncThemeButton();

  // ---------- navigation ----------
  function go(view, { focus = true } = {}) {
    $$(".view").forEach((v) => (v.hidden = v.id !== "view-" + view));
    $$("#steps button").forEach((b) => (b.dataset.go === view ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current")));
    if (view === "decide") $("#view-decide .needs-scan").hidden = !!current;
    if (view === "results") { $("#results-empty").hidden = !!current; $("#results").hidden = !current; }
    if (view === "scan") $("#btn-last").hidden = !current;
    if (view === "track") renderTrack();
    document.body.dataset.view = view;
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (focus) $(`#view-${view} h1, #view-${view} h2`)?.focus({ preventScroll: true });
    if (location.hash !== "#" + view) history.replaceState(null, "", "#" + view);
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-go]");
    if (b) go(b.dataset.go);
  });

  // ---------- camera & photo input ----------
  let lastSource = "camera";
  let lastAngles = [];
  const pickFile = (id) => $("#" + id).click(); // must run synchronously inside a tap/click

  function openCamera() {
    lastSource = "camera";
    hidePreview();
    $("#scan-error").hidden = true;
    const canLive = window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia;
    // On plain http (e.g. http://192.168.x.x) browsers block in-page cameras, so we open the phone's
    // own front camera app instead of the gallery. `npm run https` or the HTTPS deploy gives the live scanner.
    if (!canLive) return pickFile("file-cam");
    loadScript("js/scanner.js?v=5")
      .then(() =>
        window.SkinScanner.open({
          onDone: (front, angles) => { lastAngles = angles; showPreview(front); },
          onCancel: () => $("#btn-camera").focus(),
          onError: (e) => {
            const denied = e && (e.name === "NotAllowedError" || e.name === "SecurityError");
            showError(
              denied
                ? "Camera permission was blocked. Allow it from the 🔒 / ⓘ icon next to the address bar (Site settings → Camera → Allow), then try again. Or use your phone's camera app."
                : "Couldn't start the camera on this device. Use your phone's camera app or upload a photo instead.",
              [
                { label: "Try again", primary: true, onClick: openCamera },
                { label: "Use camera app", onClick: () => pickFile("file-cam") },
                { label: "Upload a photo", onClick: () => pickFile("file") },
              ]
            );
          },
        })
      )
      .catch(() => pickFile("file-cam"));
  }
  function fromFile(file) {
    if (!file) return;
    lastAngles = [];
    if (!/^image\//.test(file.type) && !/\.(jpe?g|png|heic|heif|webp)$/i.test(file.name)) return showError("That file isn't an image. Choose a JPG or PNG photo.");
    if (file.size > 25 * 1024 * 1024) return showError("That photo is very large. Choose one under 25 MB.");
    const img = new Image();
    img.onload = () => {
      const max = 2048;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
      const c = $("#canvas");
      c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(img.src);
      showPreview(c.toDataURL("image/jpeg", 0.92));
    };
    img.onerror = () => showError("Couldn't read that image. Try a JPG or PNG (on iPhone, Settings → Camera → Formats → Most Compatible).");
    img.src = URL.createObjectURL(file);
  }

  // ---------- review step: quality checks before spending an API unit ----------
  function analyzeImage(dataURL) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const W = 120, H = Math.round((img.height / img.width) * 120);
        const c = document.createElement("canvas");
        c.width = W; c.height = H;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, W, H);
        const d = ctx.getImageData(0, 0, W, H).data;
        const g = new Float32Array(W * H);
        let sum = 0, clipped = 0;
        for (let i = 0, j = 0; i < d.length; i += 4, j++) {
          g[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          sum += g[j];
          if (g[j] > 250) clipped++;
        }
        let n = 0, m = 0, m2 = 0;
        for (let y = Math.floor(H * 0.2); y < Math.floor(H * 0.8); y++)
          for (let x = Math.floor(W * 0.2); x < Math.floor(W * 0.8); x++) {
            const i = y * W + x;
            const lap = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - W] - g[i + W];
            n++; const dl = lap - m; m += dl / n; m2 += dl * (lap - m);
          }
        resolve({ w: img.width, h: img.height, brightness: sum / (W * H), clippedPct: (clipped / (W * H)) * 100, sharpness: n > 1 ? m2 / (n - 1) : 0 });
      };
      img.onerror = () => resolve(null);
      img.src = dataURL;
    });
  }

  let pending = null;
  async function showPreview(dataURL) {
    $("#scan-error").hidden = true;
    pending = dataURL;
    const q = await analyzeImage(dataURL);
    const checks = [];
    let blocking = false;
    if (lastAngles.length >= 3) checks.push(["ok", "3-angle sweep complete (front, left, right)"]);
    if (q) {
      const shortSide = Math.min(q.w, q.h);
      if (shortSide < 480) { checks.push(["warn", `Resolution too low (${q.w}×${q.h}). YouCam needs at least 480px.`]); blocking = true; }
      else checks.push(["ok", `Resolution ${q.w}×${q.h}`]);
      if (q.brightness < 60) checks.push(["warn", "Looks dark. Face a window or a lamp for accurate scores."]);
      else if (q.clippedPct > 18) checks.push(["warn", "Very bright patches. Avoid direct flash or harsh sun."]);
      else checks.push(["ok", "Lighting looks good"]);
      if (q.sharpness < 25) checks.push(["warn", "Looks blurry. Hold still or tap to focus."]);
      else checks.push(["ok", "Sharp enough"]);
      if (q.w > q.h * 1.1) checks.push(["warn", "Landscape photo. A close portrait selfie works best."]);
    }
    $("#checks").innerHTML = checks.map(([c, t]) => `<li class="${c}">${esc(t)}</li>`).join("");
    $("#preview-img").src = dataURL;
    $("#angles").innerHTML = lastAngles.length ? lastAngles.map((u, i) => `<img src="${u}" alt="${["Left", "Front", "Right"][i] || "Angle"} view" />`).join("") : "";
    $("#review-ready").hidden = false;
    $("#loading").hidden = true;
    $("#review").classList.remove("analyzing");
    $("#review").hidden = false;
    document.body.classList.add("modal-open");
    $("#btn-analyze").disabled = blocking;
    $("#btn-analyze").textContent = checks.some(([c]) => c === "warn") && !blocking ? "Analyze anyway" : "Analyze my skin ✨";
    $("#units-note").textContent = !config.live
      ? "Live analysis is unavailable on this server right now. Use the sample scan."
      : config.scansLeft != null
        ? `Each analysis uses 1 of ${config.scansLeft} scans left today on this demo.`
        : "";
    $("#btn-analyze").focus({ preventScroll: true });
  }
  function hidePreview() {
    $("#review").hidden = true;
    $("#review").classList.remove("analyzing");
    document.body.classList.remove("modal-open");
  }

  // ---------- scanning (YouCam AI Skin Analysis via our server) ----------
  const STAGES = ["Uploading securely to YouCam AI…", "Mapping 12 skin zones…", "Scoring breakouts, pores, redness…", "Reading hydration, texture, tone…", "Building your skin report…"];
  function setLoading(on, title) {
    if (on) {
      $("#scan-error").hidden = true;
      $("#review").hidden = false;
      $("#review").classList.add("analyzing");
      document.body.classList.add("modal-open");
      $("#review-ready").hidden = true;
      $("#loading").hidden = false;
      if (title) $("#loading-title").textContent = title;
    } else {
      hidePreview();
    }
  }
  function showError(msg, actions) {
    setLoading(false);
    if ($("#view-scan").hidden) go("scan", { focus: false });
    const el = $("#scan-error");
    const acts = actions || [{ label: "Use a sample scan instead", onClick: () => runSample() }];
    el.innerHTML = `<b>Scan didn't work.</b> ${esc(msg)}<div class="actions"></div>`;
    const box = $(".actions", el);
    acts.forEach((a) => {
      const b = document.createElement("button");
      b.className = "btn sm " + (a.primary ? "primary" : "ghost");
      b.textContent = a.label;
      b.onclick = a.onClick;
      box.appendChild(b);
    });
    el.hidden = false;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function runScan(dataURL) {
    photoURL = dataURL;
    hidePreview();
    setLoading(true, "Analyzing your skin…");
    let stage = 0;
    $("#loading-sub").textContent = STAGES[0];
    const ticker = setInterval(() => ($("#loading-sub").textContent = STAGES[Math.min(++stage, STAGES.length - 1)]), 2500);
    try {
      // Not retried automatically: creating a task twice could use two API units.
      track("scan_start", { angles: lastAngles.length });
      const sj = await fetchJSON("/api/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: dataURL }) });
      if (sj.scansLeft != null) config.scansLeft = sj.scansLeft;
      try { sessionStorage.setItem("sv_pending_task", sj.taskId); } catch { /* ignore */ }
      await pollTask(sj.taskId);
    } catch (e) {
      if (e.code === "unavailable" || e.code === "quota") showError(e.message, [{ label: "Use a sample scan instead", primary: true, onClick: () => runSample() }]);
      else showError(e.message, [{ label: "Try again", primary: true, onClick: () => runScan(dataURL) }, { label: "Retake photo", onClick: openCamera }]);
    } finally {
      clearInterval(ticker);
    }
  }

  // Polling is safe to retry: network blips or a server restart won't lose the scan.
  async function pollTask(taskId) {
    const t0 = Date.now();
    while (Date.now() - t0 < 150000) {
      await sleep(2000);
      const j = await fetchJSON("/api/scan/" + encodeURIComponent(taskId), {}, {
        retries: 4,
        onRetry: (n) => ($("#loading-sub").textContent = `Connection hiccup, retrying (${n}/4)…`),
      });
      if (j.status === "success") {
        try { sessionStorage.removeItem("sv_pending_task"); } catch { /* ignore */ }
        return finishScan(j.result, !j.live);
      }
    }
    throw new Error("The analysis is taking too long. Please try again.");
  }

  async function runSample() {
    hidePreview();
    photoURL = null;
    lastAngles = [];
    $("#preview-img").removeAttribute("src");
    $("#angles").innerHTML = "";
    setLoading(true, "Loading sample scan…");
    try {
      const j = await fetchJSON("/api/demo", {}, { retries: 2 });
      await sleep(500);
      finishScan(j.result, true);
    } catch (e) {
      showError(e.message, [{ label: "Try again", primary: true, onClick: runSample }]);
    }
  }

  function finishScan(result, sample) {
    setLoading(false);
    masks = result.masks || {};
    const scan = S.validScan({ id: "s" + Date.now(), date: new Date().toISOString(), scores: result.scores, overall: result.overall, skinAge: result.skinAge, sample, skinType: result.skinType });
    track(sample ? "sample_scan" : "scan_done", { overall: result.overall || 0, yc_type: !!result.skinType });
    scans.push(scan);
    saveScans();
    current = scan;
    renderResults(scan, result.baseImage);
    go("results");
    const waiting = trials.filter((t) => t.baselineScanId !== scan.id);
    toast(waiting.length ? `Scan saved. See "Is it working?" for ${waiting.length} tracked product${waiting.length > 1 ? "s" : ""}.` : "Scan complete.");
  }

  // ---------- results ----------
  const GROUPS = [
    ["Clarity", ["acne", "pore", "oiliness"]],
    ["Hydration & glow", ["moisture", "radiance", "texture"]],
    ["Even tone", ["redness", "age_spot"]],
    ["Firmness & lines", ["wrinkle", "firmness"]],
    ["Eye area", ["dark_circle_v2", "eye_bag"]],
  ];
  // [what a low score means, what a good score means]
  const MEANING = {
    acne: ["Active breakouts or congestion detected", "Clear, few active spots"],
    pore: ["Pores look enlarged, often from oil or congestion", "Pores look refined"],
    oiliness: ["Excess shine, especially in the T-zone", "Oil levels look balanced"],
    moisture: ["Skin looks dehydrated", "Well hydrated"],
    radiance: ["Skin looks dull or tired", "Healthy glow"],
    texture: ["Uneven or rough surface", "Smooth surface"],
    redness: ["Visible redness or irritation", "Calm, even colour"],
    age_spot: ["Dark spots or pigmentation", "Even pigmentation"],
    wrinkle: ["Visible fine lines", "Few visible lines"],
    firmness: ["Some loss of firmness", "Firm, bouncy skin"],
    dark_circle_v2: ["Noticeable dark circles", "Bright under-eyes"],
    eye_bag: ["Some puffiness under the eyes", "Little puffiness"],
  };
  function skinType(sc) {
    const oily = (sc.oiliness ?? 100) < E.ATTENTION || (sc.pore ?? 100) < E.ATTENTION - 5;
    const dry = (sc.moisture ?? 100) < E.ATTENTION;
    const base = oily && dry ? "Combination" : oily ? "Oily" : dry ? "Dry" : "Normal";
    return base + ((sc.redness ?? 100) < E.ATTENTION ? " · sensitive-leaning" : "");
  }
  function renderResults(scan, baseImage) {
    $("#results").hidden = false;
    $("#sample-tag").hidden = !scan.sample;
    $("#live-tag").hidden = !!scan.sample;
    $("#overall").textContent = scan.overall ?? "--";
    $("#ring").style.setProperty("--p", scan.overall ?? 0);
    $("#ring").setAttribute("aria-label", `Skin score ${scan.overall ?? "unknown"} out of 100`);
    const pri = E.priorities(scan.scores);
    const att = pri.filter((p) => p.band === "attention");
    const watch = pri.filter((p) => p.band === "watch");
    const bal = att.length === 0 ? ["balanced", "✓ Balanced"] : att.length <= 2 ? ["mostly", "~ Mostly balanced"] : ["care", "! Needs some care"];
    $("#balance").className = "balance " + bal[0];
    $("#balance").textContent = bal[1];
    $("#summary-title").textContent = att.length ? `Focus on ${att.slice(0, 2).map((p) => p.label.toLowerCase()).join(" & ")}` : watch.length ? `Keep an eye on ${watch[0].label.toLowerCase()}` : "Your skin is in great shape";
    $("#summary-sub").textContent = [scan.skinAge ? `Estimated skin age ${scan.skinAge}.` : "", `${att.length} concern${att.length === 1 ? "" : "s"} need${att.length === 1 ? "s" : ""} attention, ${watch.length} to watch, ${pri.length - att.length - watch.length} looking good.`].join(" ");
    $("#type-tag").textContent = scan.skinType ? `Skin type: ${scan.skinType} (YouCam)` : "Skin type: " + skinType(scan.scores) + " (estimated)";
    $("#shade-out").innerHTML = "";
    $("#tone-note").textContent = !photoURL ? "Available right after a live scan (we never store your photo)." : !config.live ? "Live analysis is unavailable on this server." : "Uses 1 scan from today's demo allowance.";
    $("#btn-tone").disabled = !photoURL || !config.live;
    if (scan.skinColor) setTimeout(() => renderShades(scan.skinColor), 0);

    $("#groups").innerHTML = GROUPS.map(([title, keys]) => {
      const items = keys.filter((k) => scan.scores[k] !== undefined).map((k) => pri.find((p) => p.key === k));
      if (!items.length) return "";
      const avg = Math.round(items.reduce((s2, p) => s2 + p.score, 0) / items.length);
      return `<div class="group"><div class="group-h"><span>${esc(title)}</span><b class="${E.band(avg)}">${avg}</b></div><ul class="bars">${items
        .map((p) => `<li class="bar" aria-label="${esc(p.label)}: ${p.score} out of 100, ${E.BAND_LABEL[p.band]}. ${esc(MEANING[p.key][p.band === "good" ? 1 : 0])}">
          <i class="sym ${p.band}" aria-hidden="true">${SYM[p.band]}</i><span aria-hidden="true">${esc(p.label)}</span>
          <div class="track" aria-hidden="true"><div class="fill ${p.band}" style="width:${p.score}%"></div></div><span class="num" aria-hidden="true">${p.score}</span>
          <small class="meaning" aria-hidden="true">${esc(MEANING[p.key][p.band === "good" ? 1 : 0])}</small></li>`)
        .join("")}</ul></div>`;
    }).join("");

    const img = $("#photo-img"), mask = $("#photo-mask");
    const base = baseImage || photoURL;
    $(".photo-card").hidden = !base;
    if (base) img.src = base;
    mask.classList.remove("on");
    const keys = pri.map((p) => p.key).filter((k) => masks[k]);
    $("#mask-hint").textContent = keys.length ? "Tap a concern to see where YouCam detected it on your face." : "";
    $("#mask-chips").innerHTML = keys.map((k) => `<button class="chip" aria-pressed="false" data-mask="${k}">${esc(E.CONCERNS[k].label)}</button>`).join("");
    $$("#mask-chips .chip").forEach((c) =>
      c.addEventListener("click", () => {
        const on = c.getAttribute("aria-pressed") !== "true";
        $$("#mask-chips .chip").forEach((x) => x.setAttribute("aria-pressed", "false"));
        if (on) { c.setAttribute("aria-pressed", "true"); mask.src = masks[c.dataset.mask]; mask.classList.add("on"); }
        else mask.classList.remove("on");
      })
    );

    const list = E.shoppingList(scan.scores);
    $("#shop").innerHTML = list.length
      ? list.map((s) => `<div class="shop-item"><h3>${esc(s.label)} <span>${s.score}</span></h3>
          <div class="lbl">Look for</div>${s.lookFor.map((x) => `<span class="pill yes">${esc(x)}</span>`).join("")}
          ${s.avoid.length ? `<div class="lbl">Avoid</div>${s.avoid.map((x) => `<span class="pill no">${esc(x)}</span>`).join("")}` : ""}</div>`).join("")
      : `<p class="muted">Nothing urgent. A gentle cleanser, moisturiser and daily SPF will keep you here.</p>`;
  }

  // ---------- decide ----------
  let lastVerdict = null;
  let prefillSource = null;
  $("#db-size").textContent = `${E.ACTIVES.length} actives, ${E.WATCHOUTS.length} watch-out groups, ${E.BASE.length} functional ingredient families`;
  $("#samples").innerHTML = window.SAMPLE_PRODUCTS.map((p, i) => `<button class="chip" aria-pressed="false" data-sample="${i}">${esc(p.name)}</button>`).join("");
  $("#samples").addEventListener("click", (e) => {
    const c = e.target.closest("[data-sample]");
    if (!c) return;
    const p = window.SAMPLE_PRODUCTS[c.dataset.sample];
    $("#p-name").value = p.name;
    $("#p-ing").value = p.ingredients;
    $$("#samples .chip").forEach((x) => x.setAttribute("aria-pressed", String(x === c)));
    check();
  });

  async function lookup(code) {
    code = String(code || $("#barcode").value).replace(/\D/g, "");
    $("#barcode").value = code;
    if (!/^\d{8,14}$/.test(code)) return toast("Enter an 8 to 14 digit barcode.");
    $("#btn-lookup").disabled = true;
    try {
      const j = await fetchJSON("/api/product/" + code, {}, { retries: 1 });
      $("#p-name").value = j.name || "Scanned product";
      $("#p-ing").value = j.ingredients;
      toast("Found it. Checking against your skin…");
      check();
    } catch (e) {
      toast(e.message);
      $("#p-ing").focus();
    } finally {
      $("#btn-lookup").disabled = false;
    }
  }
  $("#btn-lookup").addEventListener("click", () => lookup());
  $("#barcode").addEventListener("keydown", (e) => e.key === "Enter" && lookup());
  if ("BarcodeDetector" in window && window.isSecureContext) {
    $("#btn-scan-barcode").hidden = false;
    $("#btn-scan-barcode").addEventListener("click", async () => {
      try {
        await loadScript("js/barcode.js?v=5");
        window.SkinBarcode.start($("#barcode-video"), $("#barcode-cam"), (code) => lookup(code), (msg) => toast(msg));
      } catch (e) { toast(e.message); }
    });
    $("#btn-barcode-stop").addEventListener("click", () => window.SkinBarcode?.stop());
  }

  const BADGE = { good: "✓ Good match: buy it", caution: "! Use with caution", skip: "× Skip it", neutral: "○ Optional" };
  const STATUS = { helps: "helps your skin", caution: "watch-out for your skin", active: "active (not your priority)", watch: "watch-out (not an issue for you)", base: "functional", unknown: "not in our database" };
  function check() {
    if (!current) { go("scan"); return toast("Scan your skin first."); }
    const ing = E.sanitizeText($("#p-ing").value).trim();
    if (E.parseIngredients(ing).length < 3) return toast("Paste the full ingredient list (at least a few ingredients).");
    const name = E.sanitizeText($("#p-name").value).trim().slice(0, 120) || "This product";
    const r = E.evaluateProduct(current.scores, ing, name);
    track("verdict", { verdict: r.verdict, src: prefillSource || "app" });
    prefillSource = null;
    lastVerdict = { name, ingredients: ing, ...r };
    const el = $("#verdict");
    el.className = "card verdict-card v-" + r.verdict;
    const counts = r.breakdown.reduce((m, b) => ((m[b.status] = (m[b.status] || 0) + 1), m), {});
    el.innerHTML = `
      <span class="verdict-badge">${BADGE[r.verdict]}</span>
      <h2 tabindex="-1">${esc(name)}</h2>
      <p>${esc(r.headline)}</p>
      <ul class="reasons">
        ${r.helps.map((h) => `<li class="plus"><span class="ico" aria-hidden="true">+</span><span><b>${esc(h.by.join(" + "))}</b> targets your <b>${esc(h.label.toLowerCase())}</b> (score ${h.score})${h.late ? ", but it's listed after the preservatives, so probably a small amount" : ""}.</span></li>`).join("")}
        ${r.cautions.map((c) => `<li class="minus"><span class="ico" aria-hidden="true">!</span><span><b>${esc(c.name)}</b>: ${esc(c.why)} (your ${esc(E.CONCERNS[c.concern]?.label.toLowerCase() || c.concern)}: ${c.score}).</span></li>`).join("")}
        ${r.missing.map((m) => `<li class="gap"><span class="ico" aria-hidden="true">–</span><span>Won't help your <b>${esc(m.label.toLowerCase())}</b> (${m.score}). Look for ${esc(E.shoppingList({ [m.key]: m.score })[0]?.lookFor.slice(0, 2).join(" or ") || "a targeted active")}.</span></li>`).join("")}
      </ul>
      ${r.concentrations.length ? `<p class="conc">${r.concentrations.map((c) => `<span class="pill ${c.level === "high" ? "no" : "yes"}">${esc(c.pct + "% " + c.name)}: ${esc(c.note)}</span>`).join(" ")}</p>` : ""}
      ${photoURL && config.live && r.targets.length && r.verdict !== "skip" ? `<div class="sim" id="sim"><button class="btn ghost" id="btn-sim">✨ Preview my skin after 8 weeks</button><p class="fine">YouCam AI Skin Simulation on your scan photo. An illustration, not a promise.</p></div>` : ""}
      <p class="found">${r.recognised} of ${r.parsedCount} ingredients recognised${r.onePercentAt ? ` · roughly the 1% line at #${r.onePercentAt}` : ""}.</p>
      <details class="breakdown"><summary>See every ingredient (${r.parsedCount})</summary>
        <ul class="ing-list">${r.breakdown.map((b) => `<li class="ing ${b.status}" title="${esc(STATUS[b.status] + (b.detail ? " · " + b.detail : ""))}">${esc(b.name)}<span class="sr-only">, ${esc(STATUS[b.status])}</span></li>`).join("")}</ul>
        <p class="ing-legend">+ helps your skin (${counts.helps || 0}) · ! watch-out for you (${counts.caution || 0}) · • other actives (${counts.active || 0}) · plain = functional (${counts.base || 0}) · dashed = not in database (${counts.unknown || 0})</p>
      </details>
      <div class="actions">
        ${r.verdict !== "skip" && r.targets.length ? `<button class="btn primary" id="btn-track">I bought it: track if it works</button>` : ""}
        <button class="btn ghost" id="btn-share">Share verdict</button>
        <button class="btn ghost" id="btn-clear-p">Check another</button>
      </div>`;
    el.hidden = false;
    $("#verdict-empty").hidden = true;
    $("#btn-track") && ($("#btn-track").onclick = startTrial);
    $("#btn-sim") && ($("#btn-sim").onclick = () => runSimulation(r.targets));
    $("#btn-share").onclick = async () => {
      try {
        await loadScript("js/share.js?v=5");
        await window.SkinShare.shareVerdict(lastVerdict, current);
      } catch (e) { if (e.name !== "AbortError") toast(e.message || "Couldn't share."); }
    };
    $("#btn-clear-p").onclick = () => { $("#p-name").value = ""; $("#p-ing").value = ""; $("#barcode").value = ""; $$("#samples .chip").forEach((x) => x.setAttribute("aria-pressed", "false")); $("#p-ing").focus(); };
    if (window.innerWidth < 820) el.scrollIntoView({ behavior: "smooth" });
    $("h2", el).focus({ preventScroll: window.innerWidth >= 820 });
  }
  $("#btn-check").addEventListener("click", check);

  function startTrial() {
    const v = lastVerdict;
    track("track_start");
    trials.push(S.validTrial({ id: "t" + Date.now(), name: v.name, ingredients: v.ingredients, targets: v.targets, verdict: v.verdict, baselineScanId: current.id, startDate: current.date.slice(0, 10) }));
    saveTrials();
    toast("Tracking started. Rescan in 2 to 4 weeks.");
    go("track");
  }

  // ---------- track ----------
  function deltaRows(deltas) {
    return deltas
      .map((d) => {
        const cls = d.delta >= E.NOISE ? "up" : d.delta <= -E.NOISE ? "down" : "flat";
        const sign = d.delta > 0 ? "+" : "";
        const lo = Math.min(d.before, d.after), hi = Math.max(d.before, d.after);
        return `<div class="delta-row" role="listitem" aria-label="${esc(d.label)}: ${d.before} to ${d.after}, ${sign}${d.delta}">
          <span aria-hidden="true">${esc(d.label)}</span>
          <div class="mini" aria-hidden="true"><i style="left:${lo}%;width:${Math.max(1, hi - lo)}%;background:${cls === "down" ? "var(--attention)" : cls === "up" ? "var(--good)" : "var(--muted)"}"></i><b style="left:${d.after}%"></b></div>
          <span class="v ${cls}" aria-hidden="true">${d.before}→${d.after} (${sign}${d.delta})</span></div>`;
      })
      .join("");
  }

  function renderTrack() {
    const el = $("#trials");
    if (!trials.length) {
      el.innerHTML = `<div class="trial"><p class="muted" style="margin:0">No products tracked yet. Get a verdict on a product, then tap <b>"I bought it: track if it works"</b>.</p></div>`;
    } else {
      el.innerHTML = trials.map((t) => {
        const base = scans.find((s) => s.id === t.baselineScanId);
        const later = scans.filter((s) => base && new Date(s.date) > new Date(base.date));
        const follow = later.find((s) => s.id === t.followupScanId) || later[later.length - 1];
        let body = `<p class="muted" style="margin:6px 0 0">Waiting for a follow-up scan. Rescan in the same spot and light, then come back here.</p>`;
        if (!base) body = `<p class="muted" style="margin:6px 0 0">The baseline scan for this product was deleted.</p>`;
        else if (follow) {
          const days = daysBetween(t.startDate, follow.date.slice(0, 10));
          const p = E.evaluateProgress(base, follow, t.targets, days);
          body = `<div class="progress p-${p.verdict}" role="status"><h4>${esc(p.headline)}</h4><p style="margin:0 0 6px">${esc(p.detail)}</p><div role="list">${deltaRows(p.deltas)}</div></div>`;
        }
        return `<div class="trial">
          <div class="trial-head"><h3>${esc(t.name)}</h3><button class="btn sm ghost" data-del="${esc(t.id)}" aria-label="Stop tracking ${esc(t.name)}">Remove</button></div>
          <div class="trial-meta">
            <span>Targets: ${t.targets.map((k) => esc(E.CONCERNS[k]?.label || k)).join(", ")}</span>
            <label>Started <input type="date" value="${esc(t.startDate)}" data-start="${esc(t.id)}" max="${new Date().toISOString().slice(0, 10)}" /></label>
            ${later.length > 1 ? `<label>Compare with <select data-follow="${esc(t.id)}">${later.map((s) => `<option value="${esc(s.id)}" ${s.id === follow?.id ? "selected" : ""}>${fmtDate(s.date)}${s.sample ? " (sample)" : ""}</option>`).join("")}</select></label>` : ""}
          </div>
          ${body}
          <div class="actions"><button class="btn sm primary" data-go="scan">Rescan now</button><button class="btn sm ghost" data-ics="${esc(t.id)}">📅 Add rescan dates to calendar</button>${base ? `<button class="btn sm ghost" data-demo-follow="${esc(t.id)}" title="Backdates the start by 28 days and adds a simulated follow-up scan, marked as sample">Demo: simulate 4 weeks later</button>` : ""}</div>
        </div>`;
      }).join("");
    }

    $$("[data-ics]", el).forEach((b) => (b.onclick = () => downloadICS(trials.find((t) => t.id === b.dataset.ics))));
    renderDue();
    $$("[data-del]", el).forEach((b) => (b.onclick = () => { trials = trials.filter((t) => t.id !== b.dataset.del); saveTrials(); renderTrack(); toast("Stopped tracking."); }));
    $$("[data-start]", el).forEach((i) => (i.onchange = () => { const t = trials.find((x) => x.id === i.dataset.start); if (/^\d{4}-\d{2}-\d{2}$/.test(i.value)) { t.startDate = i.value; saveTrials(); renderTrack(); } }));
    $$("[data-follow]", el).forEach((s) => (s.onchange = () => { const t = trials.find((x) => x.id === s.dataset.follow); t.followupScanId = s.value; saveTrials(); renderTrack(); }));
    $$("[data-demo-follow]", el).forEach((b) => (b.onclick = () => {
      // Demo helper: a simulated follow-up built from the real baseline, clearly marked "sample".
      const t = trials.find((x) => x.id === b.dataset.demoFollow);
      const base = scans.find((s) => s.id === t.baselineScanId);
      const d = new Date(); d.setDate(d.getDate() - 28);
      t.startDate = d.toISOString().slice(0, 10);
      const scores = { ...base.scores };
      t.targets.forEach((k, i) => { if (scores[k] !== undefined) scores[k] = Math.min(100, scores[k] + [8, 6, 5][i % 3]); });
      const vals = Object.values(scores);
      const s = S.validScan({ id: "s" + Date.now(), date: new Date().toISOString(), scores, overall: Math.round(vals.reduce((a, c) => a + c, 0) / vals.length), skinAge: base.skinAge, sample: true });
      scans.push(s);
      t.followupScanId = s.id;
      saveScans(); saveTrials();
      renderTrack();
      toast("Added a simulated follow-up scan (marked as sample).");
    }));

    renderChart();
    renderCompare();
    $("#history").innerHTML = scans.length
      ? `<table class="hist"><caption class="sr-only">All scans</caption><tr><th scope="col">Date</th><th scope="col">Skin score</th><th scope="col">Lowest</th><th scope="col"><span class="sr-only">Type</span></th><th scope="col"><span class="sr-only">Actions</span></th></tr>${scans.slice().reverse().map((s) => {
          const low = E.priorities(s.scores)[0];
          return `<tr><td>${fmtDate(s.date)}</td><td><b>${s.overall ?? "--"}</b></td><td>${low ? esc(low.label) + " " + low.score : ""}</td><td>${s.sample ? '<span class="tag">Sample</span>' : '<span class="tag live">Live</span>'}</td><td><button class="btn sm ghost" data-del-scan="${esc(s.id)}" aria-label="Delete scan from ${fmtDate(s.date)}">Delete</button></td></tr>`;
        }).join("")}</table>`
      : `<p class="muted">No scans yet.</p>`;
    $$("[data-del-scan]").forEach((b) => (b.onclick = () => {
      scans = scans.filter((s) => s.id !== b.dataset.delScan);
      saveScans();
      current = scans[scans.length - 1] || null;
      if (!current) $("#results").hidden = true;
      renderTrack();
    }));
  }

  // History chart: inline SVG, overall score + the concern that was lowest in the first scan.
  function renderChart() {
    const el = $("#chart");
    if (scans.length < 2) { el.innerHTML = `<p class="muted">Your trend appears after two or more scans.</p>`; return; }
    const pts = scans.slice(-12);
    const focusKey = E.priorities(pts[0].scores)[0]?.key;
    const W = 640, H = 200, P = { l: 32, r: 14, t: 14, b: 28 };
    const x = (i) => P.l + (pts.length === 1 ? 0 : (i * (W - P.l - P.r)) / (pts.length - 1));
    const y = (v) => P.t + (1 - v / 100) * (H - P.t - P.b);
    const path = (vals) => vals.map((v, i) => (v == null ? "" : `${i && vals[i - 1] != null ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`)).join("");
    const overall = pts.map((s) => s.overall);
    const focus = pts.map((s) => s.scores[focusKey] ?? null);
    const grid = [25, 50, 75, 100].map((v) => `<line class="axis" x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}"/><text x="4" y="${y(v) + 4}">${v}</text>`).join("");
    const labels = pts.map((s, i) => (pts.length <= 6 || i % 2 === 0 ? `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${new Date(s.date).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</text>` : "")).join("");
    const summary = `Skin score went from ${overall[0]} to ${overall[overall.length - 1]} over ${pts.length} scans.`;
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(summary)}">${grid}${labels}
      <path class="line2" d="${path(focus)}"/><path class="line" d="${path(overall)}"/>
      ${overall.map((v, i) => `<circle class="pt" cx="${x(i)}" cy="${y(v)}" r="3.5"><title>${fmtDate(pts[i].date)}: ${v}</title></circle>`).join("")}</svg>
      <div class="chart-legend"><span><i style="background:var(--accent)"></i>Skin score</span>${focusKey ? `<span><i style="background:var(--attention)"></i>${esc(E.CONCERNS[focusKey].label)} (your first focus)</span>` : ""}</div>`;
  }

  // Compare any two scans, concern by concern.
  function renderCompare() {
    const el = $("#compare");
    if (scans.length < 2) { el.innerHTML = ""; return; }
    const opts = (sel) => scans.map((s) => `<option value="${esc(s.id)}" ${s.id === sel ? "selected" : ""}>${fmtDate(s.date)} · ${s.overall}${s.sample ? " (sample)" : ""}</option>`).join("");
    const a = renderCompare.a && scans.find((s) => s.id === renderCompare.a) ? renderCompare.a : scans[scans.length - 2].id;
    const b = renderCompare.b && scans.find((s) => s.id === renderCompare.b) ? renderCompare.b : scans[scans.length - 1].id;
    const A = scans.find((s) => s.id === a), B = scans.find((s) => s.id === b);
    const rows = E.compareScans(A, B);
    const up = rows.filter((r) => r.delta >= E.NOISE).length, down = rows.filter((r) => r.delta <= -E.NOISE).length;
    el.innerHTML = `<h3>Compare two scans</h3>
      <div class="compare-ctrl"><label>From <select id="cmp-a">${opts(a)}</select></label><label>To <select id="cmp-b">${opts(b)}</select></label></div>
      <p class="muted" style="margin:8px 0 4px">${up} improved, ${down} worsened, ${rows.length - up - down} unchanged (±${E.NOISE} is normal photo variation).</p>
      <div role="list">${deltaRows(rows)}</div>`;
    $("#cmp-a").onchange = (e) => { renderCompare.a = e.target.value; renderCompare(); };
    $("#cmp-b").onchange = (e) => { renderCompare.b = e.target.value; renderCompare(); };
  }

  // ---------- backup / clear ----------
  $("#btn-export").addEventListener("click", () => (scans.length ? S.exportBackup(scans, trials) : toast("Nothing to back up yet.")));
  $("#btn-import").addEventListener("click", () => pickFile("import-file"));
  $("#import-file").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    try {
      const { addedS, addedT } = await S.importBackup(f, scans, trials);
      saveScans(); saveTrials();
      current = scans[scans.length - 1] || null;
      renderTrack();
      toast(`Restored ${addedS} scan${addedS === 1 ? "" : "s"} and ${addedT} tracked product${addedT === 1 ? "" : "s"}.`);
    } catch (err) { toast(err.message); }
  });
  let clearArmed = false;
  $("#btn-clear").addEventListener("click", (e) => {
    // Two-tap confirm (no blocking browser dialogs).
    if (!clearArmed) {
      clearArmed = true;
      e.target.textContent = "Tap again to delete everything";
      setTimeout(() => { clearArmed = false; e.target.textContent = "Clear all data"; }, 4000);
      return;
    }
    clearArmed = false;
    e.target.textContent = "Clear all data";
    scans = []; trials = []; current = null;
    saveScans(); saveTrials();
    $("#results").hidden = true;
    renderTrack();
    toast("All data cleared.");
  });

  // ---------- wire up ----------
  $("#btn-camera").addEventListener("click", openCamera);
  $("#btn-upload").addEventListener("click", () => { lastSource = "upload"; hidePreview(); pickFile("file"); });
  $("#btn-camera").addEventListener("pointerenter", () => loadScript("js/scanner.js?v=5").then(() => window.SkinScanner.preload()).catch(() => {}), { once: true });
  $("#btn-review-close").addEventListener("click", () => { if (!$("#review").classList.contains("analyzing")) hidePreview(); });
  $("#btn-last").addEventListener("click", () => go("results"));
  $("#btn-analyze").addEventListener("click", () => pending && runScan(pending));
  $("#btn-retake").addEventListener("click", () => { hidePreview(); lastSource === "upload" ? pickFile("file") : openCamera(); });
  ["#file", "#file-cam"].forEach((id) => $(id).addEventListener("change", (e) => { fromFile(e.target.files[0]); e.target.value = ""; }));
  $("#btn-sample").addEventListener("click", runSample);
  $("#btn-rescan").addEventListener("click", () => go("scan"));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { window.SkinBarcode?.stop(); if (!$("#review").hidden && !$("#review").classList.contains("analyzing")) hidePreview(); }
  });
  window.addEventListener("offline", () => toast("You're offline. Saved results still work, and new scans need a connection."));
  window.addEventListener("online", () => toast("Back online."));

  function loadConfig() {
    return fetchJSON("/api/config", {}, { retries: 2 }).then((c) => {
      config = c;
      const banner = $("#key-banner");
      if (c.live) {
        banner.hidden = true;
        $("#mode-note").textContent = "● Live · powered by YouCam AI";
      } else {
        banner.className = "banner bad";
        banner.innerHTML = "<b>Live skin analysis is unavailable on this server right now.</b> Selfies and uploads can't be analyzed, but the sample scan and every other feature still work.";
        banner.hidden = false;
        $("#mode-note").textContent = "Sample mode";
      }
    }).catch(() => {});
  }
  loadConfig();
  S.requestPersistence();

  // Resume a scan that was in flight when the page reloaded (no API units wasted).
  try {
    const pendingTask = sessionStorage.getItem("sv_pending_task");
    if (pendingTask) {
      setLoading(true, "Finishing your last scan…");
      pollTask(pendingTask).catch((e) => { sessionStorage.removeItem("sv_pending_task"); showError(e.message); });
    }
  } catch { /* ignore */ }

  if (current) renderResults(current, null);
  const start = location.hash.slice(1);
  if (!applyPrefill()) go(["scan", "results", "decide", "track"].includes(start) ? start : "scan", { focus: false });
  setTimeout(nudgeIfDue, 1500);

  // ======================= v3 features =======================

  // ---------- #2 Foundation shade match + on-device try-on (YouCam Facial Color Tones Analyzer) ----------
  // A generic, unbranded shade range (depth 1-10 x undertone) used only to illustrate matching.
  const SHADES = (() => {
    const depths = [[244, 222, 205], [236, 206, 184], [226, 190, 163], [214, 174, 144], [199, 155, 123], [181, 135, 103], [160, 113, 84], [136, 92, 66], [110, 73, 52], [84, 55, 40]];
    const tone = { cool: [-6, 0, 8], neutral: [0, 0, 0], warm: [8, 3, -10] };
    const out = [];
    depths.forEach((rgb, i) => Object.entries(tone).forEach(([u, d]) => out.push({ name: `${i + 1}${u[0].toUpperCase()}`, label: `Shade ${i + 1} ${u}`, undertone: u, rgb: rgb.map((v, k) => Math.max(0, Math.min(255, v + d[k]))) })));
    return out;
  })();
  const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const rgbHex = (c) => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
  function toLab([r, g, b]) {
    const f = (v) => ((v /= 255) > 0.04045 ? ((v + 0.055) / 1.055) ** 2.4 : v / 12.92);
    const [R, G, B] = [f(r), f(g), f(b)];
    const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047, Y = R * 0.2126 + G * 0.7152 + B * 0.0722, Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
    const g3 = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    return [116 * g3(Y) - 16, 500 * (g3(X) - g3(Y)), 200 * (g3(Y) - g3(Z))];
  }
  const dE = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  function renderShades(hex) {
    const skin = hexToRgb(hex), L = toLab(skin);
    const undertone = L[2] - L[1] * 0.6 > 14 ? "warm" : L[2] - L[1] * 0.6 < 8 ? "cool" : "neutral";
    const depth = L[0] > 75 ? "fair" : L[0] > 62 ? "light-medium" : L[0] > 48 ? "medium-tan" : "deep";
    const best = SHADES.map((s2) => ({ ...s2, d: dE(L, toLab(s2.rgb)) })).sort((a, b) => a.d - b.d).slice(0, 3);
    $("#shade-out").innerHTML = `<div class="shade-row"><span class="swatch big" style="background:${hex}"></span><div><b>Your skin colour ${esc(hex)}</b><br><span class="muted">${esc(depth)} depth · ${esc(undertone)} undertone</span></div></div>
      <div class="shade-matches" role="group" aria-label="Closest shades">${best.map((b, i) => `<button class="shade" aria-pressed="${i === 0}" data-rgb="${b.rgb.join(",")}"><span class="swatch" style="background:${rgbHex(b.rgb)}"></span>${esc(b.label)}${i === 0 ? " · best match" : ""}</button>`).join("")}</div>
      ${photoURL ? `<div class="tryon"><canvas id="tryon" aria-label="Your photo with the selected foundation shade"></canvas><label class="fine">Coverage <input type="range" id="tryon-amt" min="0" max="80" value="45" /></label></div>` : ""}
      <p class="fine">Shade names are a generic illustration; match the colour to your brand's shade range. Try-on runs on your device.</p>`;
    $$("#shade-out .shade").forEach((b) => (b.onclick = () => { $$("#shade-out .shade").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); tryOn(b.dataset.rgb.split(",").map(Number), skin); }));
    $("#tryon-amt") && ($("#tryon-amt").oninput = () => { const on = $("#shade-out .shade[aria-pressed=true]"); tryOn(on.dataset.rgb.split(",").map(Number), skin); });
    if (photoURL) tryOn(best[0].rgb, skin);
  }
  // Tints only pixels close to the measured skin colour (a simple colour-distance skin mask), blending toward the shade.
  function tryOn(shade, skin) {
    const cv = $("#tryon");
    if (!cv || !photoURL) return;
    const img = new Image();
    img.onload = () => {
      const W = Math.min(480, img.width), H = Math.round((img.height / img.width) * W);
      cv.width = W; cv.height = H;
      const x = cv.getContext("2d", { willReadFrequently: true });
      x.drawImage(img, 0, 0, W, H);
      const d = x.getImageData(0, 0, W, H), amt = Number($("#tryon-amt")?.value || 45) / 100;
      const sL = toLab(skin);
      for (let i = 0; i < d.data.length; i += 4) {
        const px = [d.data[i], d.data[i + 1], d.data[i + 2]];
        const dist = dE(toLab(px), sL);
        if (dist > 28) continue;
        const k = amt * (1 - dist / 28);
        for (let c = 0; c < 3; c++) d.data[i + c] = px[c] + (shade[c] - skin[c]) * k; // shift toward the shade, keep skin texture
      }
      x.putImageData(d, 0, 0);
    };
    img.src = photoURL;
  }
  async function pollFeature(path, id) {
    const t0 = Date.now();
    while (Date.now() - t0 < 90000) {
      await sleep(2000);
      const j = await fetchJSON(`/api/${path}/${encodeURIComponent(id)}`, {}, { retries: 3 });
      if (j.status === "success") return j;
    }
    throw new Error("This is taking too long. Try again.");
  }
  $("#btn-tone").addEventListener("click", async () => {
    if (!photoURL) return;
    const b = $("#btn-tone");
    b.disabled = true; b.textContent = "Reading your skin tone…";
    try {
      const { taskId } = await fetchJSON("/api/tone", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: photoURL }) });
      const j = await pollFeature("tone", taskId);
      if (current) { current.skinColor = j.skinColor; saveScans(); }
      renderShades(j.skinColor);
      track("tone");
    } catch (e) {
      $("#tone-note").textContent = "Shade match isn't available right now: " + e.message;
    } finally {
      b.disabled = false; b.textContent = "🎨 Match my shade";
    }
  });

  // ---------- #1 YouCam AI Skin Simulation: before/after preview ----------
  async function runSimulation(targets) {
    const box = $("#sim");
    if (!box || !photoURL) return;
    box.innerHTML = `<p class="muted">Simulating your skin with YouCam AI…</p><div class="bar-loader"><i></i></div>`;
    try {
      const { taskId } = await fetchJSON("/api/simulate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: photoURL, concerns: targets }) });
      const j = await pollFeature("simulate", taskId);
      box.innerHTML = `<div class="ba" style="--x:50%"><img src="${esc(photoURL)}" alt="Your skin now" /><img class="after" src="${esc(j.imageUrl)}" alt="Simulated result after consistent use" /><span class="ba-l">Now</span><span class="ba-r">After (simulated)</span></div>
        <label class="fine">Drag to compare <input type="range" id="ba-range" min="0" max="100" value="50" aria-label="Before and after slider" /></label>
        <p class="fine">YouCam AI Skin Simulation of your target concerns. An illustration of improvement, not a guaranteed result.</p>`;
      $("#ba-range").oninput = (e) => box.querySelector(".ba").style.setProperty("--x", e.target.value + "%");
      track("simulate");
    } catch (e) {
      box.innerHTML = `<p class="fine">The skin preview isn't available right now (${esc(e.message)}). Your verdict above is unaffected.</p>`;
    }
  }

  // ---------- #3 Read the ingredient list from a photo of the pack (on-device OCR) ----------
  $("#btn-ocr").addEventListener("click", () => pickFile("ocr-file"));
  $("#ocr-file").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    const st = $("#ocr-status");
    st.textContent = "Loading the text reader (first time only)…";
    try {
      await loadScript("js/ocr.js?v=5");
      const { text, confidence } = await window.SkinOCR.read(f, (p) => (st.textContent = `Reading the label… ${p}%`));
      if (E.parseIngredients(text).length < 3) throw new Error("Couldn't find an ingredient list. Try a closer, flatter, well-lit photo of the 'Ingredients' panel.");
      $("#p-ing").value = text;
      st.textContent = `Read ${E.parseIngredients(text).length} ingredients (confidence ${confidence}%). Check for typos, then get your verdict.`;
      track("ocr", { conf: confidence });
      $("#p-ing").focus();
    } catch (err) {
      st.textContent = err.message;
    }
  });

  // ---------- #7 Reminders: calendar file + in-app/system nudges ----------
  function downloadICS(t) {
    if (!t) return;
    const start = new Date(t.startDate + "T09:00:00");
    const fmt = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const ev = (days, title) => {
      const d = new Date(start.getTime() + days * 86400000), end = new Date(d.getTime() + 15 * 60000);
      return ["BEGIN:VEVENT", `UID:${t.id}-${days}@skinverdict`, `DTSTAMP:${fmt(new Date())}`, `DTSTART:${fmt(d)}`, `DTEND:${fmt(end)}`, `SUMMARY:${title}`, `DESCRIPTION:Open SkinVerdict and rescan in the same light to see if ${t.name.replace(/[,;\\n]/g, " ")} is working.`, "BEGIN:VALARM", "TRIGGER:-PT0M", "ACTION:DISPLAY", `DESCRIPTION:${title}`, "END:VALARM", "END:VEVENT"].join("\r\n");
    };
    const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//SkinVerdict//EN", ev(14, `Check-in scan: ${t.name}`), ev(28, `Is it working? Rescan: ${t.name}`), ev(56, `8-week verdict: ${t.name}`), "END:VCALENDAR"].join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
    a.download = "skinverdict-rescan.ics";
    document.body.appendChild(a); a.click(); a.remove();
    track("reminder", { kind: "ics" });
    toast("Calendar file saved. Open it to add day 14, 28 and 56 reminders.");
  }
  function dueTrials() {
    const today = new Date().toISOString().slice(0, 10);
    return trials.map((t) => {
      const days = daysBetween(t.startDate, today);
      const last = scans.filter((s2) => new Date(s2.date) > new Date(t.startDate)).pop();
      const sinceLast = last ? daysBetween(last.date.slice(0, 10), today) : days;
      return { t, days, due: [14, 28, 56].some((m) => days >= m) && sinceLast >= 10 };
    }).filter((x) => x.due);
  }
  function renderDue() {
    const due = dueTrials();
    $("#due-list").textContent = due.length ? "Due now: " + due.map((d) => `${d.t.name} (day ${d.days})`).join(", ") : "No rescans due right now.";
    $("#btn-notify").hidden = !("Notification" in window) || Notification.permission === "granted";
  }
  $("#btn-notify").addEventListener("click", async () => {
    try { const p = await Notification.requestPermission(); toast(p === "granted" ? "Reminders on. We'll nudge you when a rescan is due." : "Reminders are off. Use the calendar button instead."); track("reminder", { kind: "notify_" + p }); } catch { toast("This browser can't show reminders. Use the calendar button."); }
    renderDue();
  });
  function nudgeIfDue() {
    const due = dueTrials();
    if (!due.length) return;
    const msg = `Rescan time: ${due[0].t.name} is on day ${due[0].days}. Let's see if it's working.`;
    toast(msg);
    try {
      if ("Notification" in window && Notification.permission === "granted" && navigator.serviceWorker?.ready) navigator.serviceWorker.ready.then((r) => r.showNotification("SkinVerdict", { body: msg, icon: "icons/icon-192.png", tag: "rescan" }));
    } catch { /* ignore */ }
  }

  // ---------- #4 Encrypted cloud sync ----------
  let syncCode = null;
  try { syncCode = localStorage.getItem("sv_sync_code"); } catch { /* ignore */ }
  const syncUI = () => {
    $("#sync-on").hidden = !syncCode; $("#sync-off").hidden = !!syncCode;
    if (syncCode) $("#sync-code").value = syncCode;
  };
  let syncTimer = null;
  function autoSync() {
    if (!syncCode) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => syncNow(true), 1500);
  }
  async function syncNow(quiet) {
    if (!syncCode) return;
    try {
      await loadScript("js/sync.js?v=5");
      // merge remote first so two devices don't overwrite each other
      try {
        const { payload } = await window.SkinSync.pull(syncCode);
        const f = new File([JSON.stringify({ app: "SkinVerdict", scans: payload.scans || [], trials: payload.trials || [] })], "sync.json");
        await S.importBackup(f, scans, trials);
        S.set("scans", scans); S.set("trials", trials);
      } catch (e) { if (!/No synced data/.test(e.message)) throw e; }
      const r = await window.SkinSync.push(syncCode, { scans, trials });
      $("#sync-status").textContent = "Synced " + new Date(r.updatedAt).toLocaleTimeString();
      if (!quiet) { toast("Synced."); track("sync", { kind: "push" }); }
      current = scans[scans.length - 1] || null;
      if (!$("#view-track").hidden) renderTrack();
    } catch (e) {
      $("#sync-status").textContent = "Sync failed: " + e.message;
    }
  }
  $("#btn-sync-start").addEventListener("click", async () => {
    await loadScript("js/sync.js?v=5");
    syncCode = window.SkinSync.newCode();
    try { localStorage.setItem("sv_sync_code", syncCode); } catch { /* ignore */ }
    syncUI();
    await syncNow();
  });
  $("#btn-sync-restore").addEventListener("click", async () => {
    const code = $("#sync-input").value.trim();
    try {
      await loadScript("js/sync.js?v=5");
      window.SkinSync.split(code);
      syncCode = code;
      try { localStorage.setItem("sv_sync_code", syncCode); } catch { /* ignore */ }
      syncUI();
      await syncNow();
      track("sync", { kind: "restore" });
    } catch (e) { toast(e.message); }
  });
  $("#btn-sync-now").addEventListener("click", () => syncNow());
  $("#btn-copy-code").addEventListener("click", async () => { try { await navigator.clipboard.writeText(syncCode); toast("Sync code copied. Keep it private."); } catch { $("#sync-code").select(); } });
  $("#btn-sync-off").addEventListener("click", () => { syncCode = null; try { localStorage.removeItem("sv_sync_code"); } catch { /* ignore */ } syncUI(); toast("Sync turned off on this device. Your data stays here."); });
  syncUI();

  // ---------- #8 Retailer widget hand-off: #decide?name=…&ing=… ----------
  function applyPrefill() {
    const m = /^#decide\?(.+)$/.exec(location.hash);
    if (!m) return false;
    const q = new URLSearchParams(m[1]);
    $("#p-name").value = E.sanitizeText(q.get("name") || "").slice(0, 120);
    $("#p-ing").value = E.sanitizeText(q.get("ing") || "");
    prefillSource = q.get("src") === "widget" ? "widget" : "link";
    track("widget_open");
    go("decide", { focus: false });
    if (current) check(); else toast("Scan your skin first, then we'll check this product for you.");
    return true;
  }

  // PWA: offline shell + installable. Service workers need HTTPS (or localhost).
  if ("serviceWorker" in navigator && window.isSecureContext) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }
})();
