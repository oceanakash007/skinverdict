// Lazy-loaded live face scanner.
// - Tracks the face in real time (MediaPipe Face Landmarker, 478 3D landmarks) and draws a live 3D mesh.
// - Coaches the user: lighting, distance, centering, glasses, hair/hat over the forehead.
// - Guided 180° sweep: front -> left -> right -> back to centre. The FRONT frame is what goes to
//   YouCam Skin Analysis (one API unit); the side angles confirm a live, well-framed face and are shown to the user.
// - If the face model can't load (offline, blocked), it falls back to a timed guided sweep.
(function (root) {
  const VENDOR = "/vendor/mediapipe";
  // Google's hosted model first; a self-hosted copy at /models/ is used if you add one (see README).
  const MODEL_URLS = ["https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task", "/models/face_landmarker.task"];

  let landmarker = null, tess = null, loading = null;
  async function loadModel() {
    if (landmarker) return landmarker;
    if (loading) return loading;
    loading = (async () => {
      const vision = await import(`${VENDOR}/vision_bundle.mjs`);
      const fileset = await vision.FilesetResolver.forVisionTasks(`${VENDOR}/wasm`);
      tess = vision.FaceLandmarker.FACE_LANDMARKS_TESSELATION;
      let lastErr;
      for (const url of MODEL_URLS) {
        for (const delegate of ["GPU", "CPU"]) {
          try {
            landmarker = await vision.FaceLandmarker.createFromOptions(fileset, {
              baseOptions: { modelAssetPath: url, delegate },
              runningMode: "VIDEO",
              numFaces: 1,
            });
            return landmarker;
          } catch (e) { lastErr = e; }
        }
      }
      throw lastErr || new Error("Face model unavailable");
    })();
    try { return await loading; } catch (e) { loading = null; throw e; }
  }

  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error("timeout")), ms))]);

  // ---------- small image helpers on a downscaled copy of the frame ----------
  const probe = document.createElement("canvas");
  const pctx = probe.getContext("2d", { willReadFrequently: true });
  function grab(video) {
    const w = 160, h = Math.round((video.videoHeight / video.videoWidth) * 160) || 120;
    probe.width = w; probe.height = h;
    pctx.drawImage(video, 0, 0, w, h);
    return { data: pctx.getImageData(0, 0, w, h).data, w, h };
  }
  function patch(img, nx, ny, r = 4) {
    const cx = Math.round(nx * img.w), cy = Math.round(ny * img.h);
    let sum = 0, n = 0, grad = 0;
    for (let y = cy - r; y <= cy + r; y++)
      for (let x = cx - r; x <= cx + r; x++) {
        if (x < 1 || y < 1 || x >= img.w - 1 || y >= img.h - 1) continue;
        const i = (y * img.w + x) * 4;
        const l = 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
        const j = ((y - 1) * img.w + x) * 4;
        const lu = 0.299 * img.data[j] + 0.587 * img.data[j + 1] + 0.114 * img.data[j + 2];
        sum += l; grad += Math.abs(l - lu); n++;
      }
    return n ? { lum: sum / n, edge: grad / n } : { lum: 0, edge: 0 };
  }

  // Tunable thresholds. Calibrate with ?debug=1 (see CALIBRATION.md) and adjust here.
  const T = { dark: 70, uneven: 0.38, glassesEdgeMin: 14, glassesEdgeRatio: 3, foreheadRatio: 0.62, yawFront: 0.08, yawTurn: 0.17, minWidth: 0.32, maxWidth: 0.78 };
  const DEBUG = /[?&]debug=1/.test(location.search);
  const samples = [];

  // ---------- analysis of one detection ----------
  function assess(lm, img) {
    const xs = lm.map((p) => p.x), ys = lm.map((p) => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const width = maxX - minX, cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const L = lm[234], R = lm[454], nose = lm[1];
    const yaw = (nose.x - L.x) / Math.max(1e-3, R.x - L.x) - 0.5; // 0 = facing camera
    const cheekA = patch(img, lm[50].x, lm[50].y), cheekB = patch(img, lm[280].x, lm[280].y);
    const foreY = lm[10].y + (lm[151].y - lm[10].y) * 0.5;
    const fore = patch(img, lm[151].x, foreY, 5);
    const bridge = patch(img, lm[168].x, lm[168].y, 3);
    const skin = (cheekA.lum + cheekB.lum) / 2;
    const cheekEdge = (cheekA.edge + cheekB.edge) / 2;
    return {
      box: { minX, maxX, minY, maxY }, width, cx, cy, yaw,
      dark: skin < T.dark,
      uneven: Math.abs(cheekA.lum - cheekB.lum) / Math.max(1, skin) > T.uneven,
      glasses: bridge.edge > Math.max(T.glassesEdgeMin, T.glassesEdgeRatio * cheekEdge),
      forehead: skin > 60 && fore.lum < skin * T.foreheadRatio,
      raw: { skin: Math.round(skin), bridgeEdge: +bridge.edge.toFixed(1), cheekEdge: +cheekEdge.toFixed(1), foreRatio: +(fore.lum / Math.max(1, skin)).toFixed(2), unevenRatio: +(Math.abs(cheekA.lum - cheekB.lum) / Math.max(1, skin)).toFixed(2), yaw: +yaw.toFixed(3), width: +width.toFixed(2) },
    };
  }

  // Debounce flaky heuristics: a problem must persist for N frames before we nag.
  function makeStreak() {
    const s = {};
    return (key, on, need = 8) => ((s[key] = on ? (s[key] || 0) + 1 : 0) >= need);
  }

  // ---------- UI ----------
  function buildUI() {
    const el = document.createElement("div");
    el.className = "scanner";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-label", "Face scan");
    el.innerHTML = `
      <video class="sc-video" playsinline muted></video>
      <canvas class="sc-mesh" aria-hidden="true"></canvas>
      <svg class="sc-guide" viewBox="0 0 300 400" aria-hidden="true">
        <defs><linearGradient id="scg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7CF5C4"/><stop offset=".5" stop-color="#B79CFF"/><stop offset="1" stop-color="#FFB8A8"/></linearGradient></defs>
        <path class="sc-dim" fill-rule="evenodd" d="M-3000 -3000 H3300 V3400 H-3000 Z M150 34 C 222 34 252 98 250 170 C 248 238 226 300 192 338 C 174 358 162 366 150 366 C 138 366 126 358 108 338 C 74 300 52 238 50 170 C 48 98 78 34 150 34 Z"/>
        <path class="sc-outline" d="M150 34 C 222 34 252 98 250 170 C 248 238 226 300 192 338 C 174 358 162 366 150 366 C 138 366 126 358 108 338 C 74 300 52 238 50 170 C 48 98 78 34 150 34 Z"/>
        <path class="sc-progress" pathLength="100" d="M150 34 C 222 34 252 98 250 170 C 248 238 226 300 192 338 C 174 358 162 366 150 366 C 138 366 126 358 108 338 C 74 300 52 238 50 170 C 48 98 78 34 150 34 Z"/>
      </svg>
      <div class="sc-flash" aria-hidden="true"></div>
      <div class="sc-top">
        <button class="sc-close" aria-label="Close scanner">✕</button>
        <div class="sc-mode"></div>
      </div>
      <div class="sc-coach" role="status" aria-live="polite"><div class="sc-msg">Starting camera…</div><div class="sc-sub"></div></div>
      <div class="sc-bottom">
        <ol class="sc-steps"><li data-s="front">Straight</li><li data-s="left">Left</li><li data-s="right">Right</li></ol>
        <button class="sc-manual btn ghost light sm" hidden>Capture now</button>
      </div>`;
    document.body.appendChild(el);
    return el;
  }

  // ---------- main ----------
  let active = null;
  async function open({ onDone, onCancel, onError }) {
    if (active) return;
    const ui = buildUI();
    const video = ui.querySelector(".sc-video");
    const mesh = ui.querySelector(".sc-mesh");
    const mctx = mesh.getContext("2d");
    const msg = ui.querySelector(".sc-msg"), sub = ui.querySelector(".sc-sub");
    const progress = ui.querySelector(".sc-progress");
    const say = (m, s = "") => { if (msg.textContent !== m) msg.textContent = m; if (sub.textContent !== s) sub.textContent = s; };
    let stream, raf, done = false;
    const shots = {};
    const state = { step: "front", holdSince: 0, turnSign: 0, startedAt: performance.now() };
    const streak = makeStreak();
    active = { close };
    document.body.classList.add("scanning");

    function close(cancelled = true) {
      done = true;
      cancelAnimationFrame(raf);
      stream && stream.getTracks().forEach((t) => t.stop());
      ui.remove();
      document.body.classList.remove("scanning");
      document.removeEventListener("keydown", onKey);
      active = null;
      if (cancelled) onCancel && onCancel();
    }
    const onKey = (e) => e.key === "Escape" && close(true);
    document.addEventListener("keydown", onKey);
    ui.querySelector(".sc-close").onclick = () => close(true);

    function setStep(s) {
      state.step = s;
      ui.querySelectorAll(".sc-steps li").forEach((li) => {
        const order = ["front", "left", "right", "center", "done"];
        li.classList.toggle("on", li.dataset.s === s);
        li.classList.toggle("ok", order.indexOf(li.dataset.s) < order.indexOf(s));
      });
      progress.style.strokeDashoffset = { front: 100, left: 67, right: 34, center: 8, done: 0 }[s];
    }
    function flash() {
      const f = ui.querySelector(".sc-flash");
      f.classList.remove("go"); void f.offsetWidth; f.classList.add("go");
      navigator.vibrate && navigator.vibrate(40);
    }
    // Full-resolution, un-mirrored 3:4 portrait crop (what YouCam receives).
    function captureFront() {
      const vw = video.videoWidth, vh = video.videoHeight;
      let ch = vh, cw = Math.round((vh * 3) / 4);
      if (cw > vw) { cw = vw; ch = Math.round((vw * 4) / 3); }
      const c = document.createElement("canvas");
      c.width = cw; c.height = ch;
      const x = c.getContext("2d");
      x.translate(cw, 0); x.scale(-1, 1);
      x.drawImage(video, (vw - cw) / 2, (vh - ch) / 2, cw, ch, 0, 0, cw, ch);
      return c.toDataURL("image/jpeg", 0.92);
    }
    function thumb() {
      const c = document.createElement("canvas");
      c.width = 180; c.height = 240;
      const x = c.getContext("2d");
      const vw = video.videoWidth, vh = video.videoHeight, cw = Math.min(vw, (vh * 3) / 4);
      x.translate(180, 0); x.scale(-1, 1);
      x.drawImage(video, (vw - cw) / 2, 0, cw, vh, 0, 0, 180, 240);
      return c.toDataURL("image/jpeg", 0.8);
    }
    function finish() {
      setStep("done");
      say("Scan complete ✨", "Nice! Checking your photo…");
      ui.classList.add("complete");
      setTimeout(() => { const front = shots.front; close(false); onDone && onDone(front, [shots.left, shots.front, shots.right].filter(Boolean)); }, 700);
    }

    // Draw the live 3D mesh + a sweeping scan line, mapped to the on-screen (object-fit: cover) video.
    function mapper() {
      const W = mesh.clientWidth, H = mesh.clientHeight;
      if (mesh.width !== W * devicePixelRatio) { mesh.width = W * devicePixelRatio; mesh.height = H * devicePixelRatio; }
      const vw = video.videoWidth, vh = video.videoHeight;
      const s = Math.max(W / vw, H / vh);
      const ox = (W - vw * s) / 2, oy = (H - vh * s) / 2;
      return (p) => [(ox + p.x * vw * s) * devicePixelRatio, (oy + p.y * vh * s) * devicePixelRatio];
    }
    function draw(lm, t, good) {
      const map = mapper();
      mctx.clearRect(0, 0, mesh.width, mesh.height);
      if (!lm) return;
      const pts = lm.map(map);
      mctx.lineWidth = 0.6 * devicePixelRatio;
      mctx.strokeStyle = good ? "rgba(124,245,196,0.38)" : "rgba(255,255,255,0.22)";
      mctx.beginPath();
      for (let i = 0; i < tess.length; i += 2) {
        const a = pts[tess[i].start], b = pts[tess[i].end];
        mctx.moveTo(a[0], a[1]); mctx.lineTo(b[0], b[1]);
      }
      mctx.stroke();
      // depth-tinted points: closer landmarks (more negative z) glow brighter
      for (let i = 0; i < pts.length; i += 3) {
        const z = lm[i].z;
        mctx.fillStyle = `rgba(183,156,255,${Math.min(0.9, 0.35 + -z * 6)})`;
        mctx.fillRect(pts[i][0] - 1, pts[i][1] - 1, 2 * devicePixelRatio, 2 * devicePixelRatio);
      }
      // scan line sweeping across the face
      const ys = pts.map((p) => p[1]), xs = pts.map((p) => p[0]);
      const top = Math.min(...ys), bot = Math.max(...ys), l = Math.min(...xs), r = Math.max(...xs);
      const y = top + ((Math.sin(t / 420) + 1) / 2) * (bot - top);
      const g = mctx.createLinearGradient(0, y - 24, 0, y + 24);
      g.addColorStop(0, "rgba(124,245,196,0)"); g.addColorStop(0.5, "rgba(124,245,196,0.55)"); g.addColorStop(1, "rgba(124,245,196,0)");
      mctx.fillStyle = g;
      mctx.fillRect(l - 10, y - 24, r - l + 20, 48);
    }

    // ---------- start camera ----------
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false });
      video.srcObject = stream;
      await video.play();
    } catch (e) {
      close(false);
      onError && onError(e);
      return;
    }
    setStep("front");
    say("Loading face tracking…", "One sec");

    let model = null;
    try { model = await withTimeout(loadModel(), 12000); } catch { model = null; }
    if (done) return;
    ui.querySelector(".sc-mode").textContent = model ? "LIVE 3D FACE TRACKING" : "GUIDED MODE";
    const manual = ui.querySelector(".sc-manual");
    manual.onclick = () => { shots.front = shots.front || captureFront(); flash(); finish(); };
    setTimeout(() => !done && (manual.hidden = false), model ? 20000 : 4000);

    // Calibration HUD (?debug=1): live heuristic values + labelled sample logging -> CSV.
    const hud = document.createElement("div");
    if (DEBUG) {
      hud.className = "sc-hud";
      ui.appendChild(hud);
      const bar = document.createElement("div");
      bar.className = "sc-hudbar";
      bar.innerHTML = ["glasses", "no-glasses", "hair-on-forehead", "clear-forehead"].map((l) => `<button data-l="${l}">${l}</button>`).join("") + `<button data-l="__csv">CSV (${samples.length})</button>`;
      bar.onclick = (e) => {
        const l = e.target.dataset.l;
        if (!l) return;
        if (l === "__csv") {
          const keys = ["label", "skin", "bridgeEdge", "cheekEdge", "foreRatio", "unevenRatio", "yaw", "width"];
          const csv = [keys.join(","), ...samples.map((x) => keys.map((k) => x[k]).join(","))].join("\n");
          const aEl = document.createElement("a"); aEl.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); aEl.download = "scanner-calibration.csv"; aEl.click();
        } else if (state.lastRaw) { samples.push({ label: l, ...state.lastRaw }); bar.lastChild.textContent = `CSV (${samples.length})`; }
      };
      ui.appendChild(bar);
      manual.hidden = false;
      manual.textContent = "Capture (debug)";
    }

    if (model) trackLoop(); else guidedLoop();

    // ---------- live tracking state machine ----------
    function trackLoop() {
      let lastVideoTime = -1, lastProbe = 0, img = null;
      const tick = (t) => {
        if (done) return;
        raf = requestAnimationFrame(tick);
        if (DEBUG && state.step !== "front" && state.debugHold) return;
        if (video.currentTime === lastVideoTime) return;
        lastVideoTime = video.currentTime;
        let res;
        try { res = landmarker.detectForVideo(video, t); } catch { return; }
        const lm = res.faceLandmarks && res.faceLandmarks[0];
        if (t - lastProbe > 250) { img = grab(video); lastProbe = t; }
        if (!lm) {
          draw(null, t, false);
          ui.classList.remove("aligned");
          state.holdSince = 0;
          return say("Put your face inside the outline", "We'll guide you from there");
        }
        const a = assess(lm, img);
        const turning = state.step === "left" || state.step === "right";
        // Coaching, in priority order.
        let problem = null;
        if (a.width < T.minWidth) problem = ["Move a little closer 📱", "Fill the outline with your face"];
        else if (a.width > T.maxWidth) problem = ["Move back a little", "Your whole face should fit the outline"];
        else if (!turning && (Math.abs(a.cx - 0.5) > 0.14 || Math.abs(a.cy - 0.48) > 0.16)) problem = ["Center your face", "Line it up with the outline"];
        else if (!turning && streak("dark", a.dark, 6)) problem = ["💡 Face a window or a bright light", "It's too dark for an accurate read"];
        else if (!turning && streak("uneven", a.uneven, 10)) problem = ["Light is uneven", "Turn to face the light straight on"];
        else if (!turning && streak("glasses", a.glasses, 10)) problem = ["👓 Glasses on? Take them off", "Frames hide the skin around your eyes"];
        else if (!turning && streak("forehead", a.forehead, 10)) problem = ["Hair or hat over your forehead?", "Push it back so we can see your skin"];
        if (DEBUG) {
          hud.textContent = Object.entries(a.raw).map(([k, v]) => `${k}=${v}`).join("  ") + `  | glasses=${a.glasses} forehead=${a.forehead} dark=${a.dark}`;
          state.lastRaw = a.raw;
        }
        const good = !problem;
        ui.classList.toggle("aligned", good && !turning);
        draw(lm, t, good);

        if (state.step === "front") {
          if (problem) { state.holdSince = 0; return say(...problem); }
          if (Math.abs(a.yaw) > T.yawFront) { state.holdSince = 0; return say("Look straight at the camera", "Chin level, eyes open, mouth closed"); }
          if (!state.holdSince) state.holdSince = t;
          const left = Math.max(0, 900 - (t - state.holdSince));
          say("Perfect, hold still…", left > 450 ? "Capturing front view" : "📸");
          if (left === 0) { shots.front = captureFront(); flash(); setStep("left"); }
        } else if (state.step === "left") {
          if (problem) return say(...problem);
          say("Now slowly turn your head left ←", "Keep your face in view");
          if (Math.abs(a.yaw) > T.yawTurn) { state.turnSign = Math.sign(a.yaw); shots.left = thumb(); flash(); setStep("right"); }
        } else if (state.step === "right") {
          if (problem) return say(...problem);
          say("Great, now all the way right →", "Sweep across slowly");
          if (Math.sign(a.yaw) === -state.turnSign && Math.abs(a.yaw) > T.yawTurn) { shots.right = thumb(); flash(); setStep("center"); }
        } else if (state.step === "center") {
          say("And back to center", "Almost done");
          if (Math.abs(a.yaw) < T.yawFront) finish();
        }
      };
      raf = requestAnimationFrame(tick);
    }

    // ---------- fallback: timed guided sweep (no face model) ----------
    function guidedLoop() {
      const plan = [
        ["front", 3200, "Look straight at the camera", "Fill the outline · bright light · no glasses"],
        ["left", 2200, "Slowly turn your head left ←", "Keep your face in view"],
        ["right", 2600, "Now all the way right →", "Sweep across slowly"],
        ["center", 1200, "And back to center", "Almost done"],
      ];
      let i = 0, stepStart = performance.now(), img = null, lastProbe = 0;
      const tick = (t) => {
        if (done || i >= plan.length) return;
        raf = requestAnimationFrame(tick);
        const [step, dur, m, s] = plan[i];
        if (state.step !== step) setStep(step);
        if (t - lastProbe > 300) { img = grab(video); lastProbe = t; }
        const center = img ? patch(img, 0.5, 0.45, 12) : { lum: 128 };
        if (step === "front" && center.lum < 60) { stepStart = t; return say("💡 Face a window or a bright light", "It's too dark for an accurate read"); }
        const left = Math.ceil((dur - (t - stepStart)) / 1000);
        say(m, step === "front" ? `${s} · ${Math.max(1, left)}` : s);
        // simple scan line inside the outline
        const map = mapper(); void map;
        mctx.clearRect(0, 0, mesh.width, mesh.height);
        const y = mesh.height * (0.27 + ((Math.sin(t / 420) + 1) / 2) * 0.42);
        const g = mctx.createLinearGradient(0, y - 24, 0, y + 24);
        g.addColorStop(0, "rgba(124,245,196,0)"); g.addColorStop(0.5, "rgba(124,245,196,0.5)"); g.addColorStop(1, "rgba(124,245,196,0)");
        mctx.fillStyle = g; mctx.fillRect(mesh.width * 0.22, y - 24, mesh.width * 0.56, 48);
        if (t - stepStart >= dur) {
          if (step === "front") shots.front = captureFront();
          else if (step === "left") shots.left = thumb();
          else if (step === "right") shots.right = thumb();
          if (step !== "center") flash();
          i++; stepStart = t;
          if (i >= plan.length) { cancelAnimationFrame(raf); finish(); }
        }
      };
      raf = requestAnimationFrame(tick);
    }
  }

  root.SkinScanner = { open, preload: () => loadModel().catch(() => {}) };
})(window);
