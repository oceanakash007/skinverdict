// Lazy-loaded: live barcode scanning with the browser's BarcodeDetector (Chrome/Edge on Android, macOS).
(function (root) {
  let stream = null, timer = null, box = null;

  async function start(video, container, onCode, onMsg) {
    stop();
    try {
      const detector = new BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e"] });
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      video.srcObject = stream;
      await video.play();
      box = container;
      box.hidden = false;
      onMsg && onMsg("Point the camera at the barcode.");
      const tick = async () => {
        if (!stream) return;
        try {
          const codes = await detector.detect(video);
          const hit = codes.find((c) => /^\d{8,14}$/.test(c.rawValue));
          if (hit) {
            if (navigator.vibrate) navigator.vibrate(60);
            stop();
            return onCode(hit.rawValue);
          }
        } catch { /* frame not ready */ }
        timer = setTimeout(tick, 250);
      };
      tick();
    } catch (e) {
      stop();
      onMsg && onMsg(e && e.name === "NotAllowedError" ? "Camera permission blocked. Type the barcode instead." : "Barcode scanning isn't available here. Type the barcode instead.");
    }
  }

  function stop() {
    clearTimeout(timer);
    stream && stream.getTracks().forEach((t) => t.stop());
    stream = null;
    if (box) box.hidden = true;
  }

  root.SkinBarcode = { start, stop };
})(window);
