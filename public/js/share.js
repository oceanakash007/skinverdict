// Lazy-loaded: renders a shareable verdict card (PNG) and opens the native share sheet,
// or downloads it where sharing files isn't supported. No photo is included, only the verdict.
(function (root) {
  const COLORS = { good: "#2e7d5b", caution: "#b7791f", skip: "#c0392b", neutral: "#5f6963" };
  const LABEL = { good: "GOOD MATCH", caution: "USE WITH CAUTION", skip: "SKIP IT", neutral: "OPTIONAL" };

  function wrap(ctx, text, maxW) {
    const words = String(text).split(/\s+/);
    const lines = [];
    let line = "";
    for (const w of words) {
      const t = line ? line + " " + w : w;
      if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
    }
    if (line) lines.push(line);
    return lines;
  }

  async function render(v) {
    const W = 1080, H = 1350, P = 80;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const ctx = c.getContext("2d");
    try { await document.fonts.ready; } catch { /* ignore */ }
    const serif = '600 64px Fraunces, Georgia, serif';
    const sans = (w, s) => `${w} ${s}px Inter, system-ui, sans-serif`;

    ctx.fillStyle = "#f7f2ec"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = COLORS[v.verdict]; ctx.fillRect(0, 0, W, 18);

    ctx.fillStyle = "#2f5d4a"; ctx.beginPath(); ctx.arc(P + 14, 110, 14, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#1f2a24"; ctx.font = '600 40px Fraunces, Georgia, serif'; ctx.fillText("SkinVerdict", P + 42, 124);

    let y = 230;
    ctx.font = sans(700, 30);
    const label = LABEL[v.verdict];
    const lw = ctx.measureText(label).width + 56;
    ctx.fillStyle = COLORS[v.verdict];
    ctx.beginPath(); ctx.roundRect(P, y, lw, 62, 31); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.fillText(label, P + 28, y + 42);

    y += 140;
    ctx.fillStyle = "#1f2a24"; ctx.font = serif;
    for (const l of wrap(ctx, v.name, W - 2 * P).slice(0, 2)) { ctx.fillText(l, P, y); y += 76; }

    y += 10;
    ctx.font = sans(400, 34); ctx.fillStyle = "#3c4741";
    for (const l of wrap(ctx, v.headline, W - 2 * P).slice(0, 3)) { ctx.fillText(l, P, y); y += 48; }

    y += 30;
    const items = [
      ...v.helps.map((h) => ["+", "#2e7d5b", `${h.by[0]} targets ${h.label.toLowerCase()}`]),
      ...v.cautions.map((x) => ["!", "#c0392b", `${x.name}: watch-out for ${x.concern === "moisture" ? "hydration" : x.concern.replace("_", " ")}`]),
      ...v.missing.map((m) => ["–", "#5f6963", `Won't help ${m.label.toLowerCase()}`]),
    ].slice(0, 6);
    ctx.font = sans(500, 32);
    for (const [ico, col, text] of items) {
      ctx.fillStyle = col; ctx.font = sans(700, 34); ctx.fillText(ico, P, y);
      ctx.fillStyle = "#1f2a24"; ctx.font = sans(500, 32);
      const lines = wrap(ctx, text, W - 2 * P - 50).slice(0, 2);
      lines.forEach((l, i) => ctx.fillText(l, P + 50, y + i * 42));
      y += 42 * lines.length + 22;
      if (y > H - 220) break;
    }

    ctx.fillStyle = "#e8e0d6"; ctx.fillRect(P, H - 170, W - 2 * P, 2);
    ctx.fillStyle = "#5f6963"; ctx.font = sans(400, 26);
    ctx.fillText("Verdict based on my own YouCam AI skin scan.", P, H - 115);
    ctx.fillText("Cosmetic guidance, not medical advice.", P, H - 75);
    return new Promise((ok) => c.toBlob(ok, "image/png"));
  }

  async function shareVerdict(v) {
    const blob = await render(v);
    const file = new File([blob], "skinverdict.png", { type: "image/png" });
    const text = `SkinVerdict on ${v.name}: ${LABEL[v.verdict].toLowerCase()}. ${v.headline}`;
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: "My SkinVerdict", text });
      return;
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "skinverdict.png";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  root.SkinShare = { shareVerdict, render };
})(window);
