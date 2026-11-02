# Calibrating the scanner's coaching checks

The glasses, hair/hat-on-forehead, lighting and turn checks in `public/js/scanner.js` are image heuristics on top of MediaPipe face landmarks. To tune them on real faces:

1. Open the app with `?debug=1` (e.g. `https://your-app/?debug=1`) and start a face scan.
2. A live HUD shows the raw values: `skin`, `bridgeEdge`, `cheekEdge`, `foreRatio`, `unevenRatio`, `yaw`, `width`.
3. For each person and condition, tap a label (`glasses`, `no-glasses`, `hair-on-forehead`, `clear-forehead`) to log a sample. Aim for 20+ people in different light.
4. Tap **CSV** to download `scanner-calibration.csv`.
5. Pick thresholds that separate the labels (for example, `bridgeEdge / cheekEdge` for glasses), then update the `T` object at the top of `scanner.js`.
6. Track the false-positive and false-negative rate per check, and only show a coaching message once the false-positive rate is below about 10%.
