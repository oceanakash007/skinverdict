# SkinVerdict: *Should I buy this, and is it working?*

**SkinVerdict turns a 10-second selfie into a product decision.** The **YouCam AI Skin Analysis API** scores 12 skin concerns. SkinVerdict then checks any product's ingredient list (pasted, picked, or found by **barcode**) against *your* scores, and gives a verdict: **Good match / Use with caution / Skip**. After you buy, it compares follow-up scans to tell you whether the product is actually working: **Keep it / Give it time / Switch / Stop**.

Built for the YouCam API Skin AI & eCommerce VTO Hackathon (Skin AI track).

## The problem

People think about their skin at three moments:

1. **Before a purchase:** "Will this serum actually help *my* skin?"
2. **After a breakout:** "What should I even look for?"
3. **Three weeks in, in front of the mirror:** "Is this working, or am I wasting money?"

Shoppers answer these with "for oily skin" labels and reviews. That leads to wasted money, returns, and reactions.

## The flow: four pages

1. **Scan**: a minimal landing page with one button. The **live face scanner** opens full screen: a face-shaped outline, a real-time **3D face mesh** (478 tracked landmarks), and live coaching ("Face a window or a bright light", "Glasses on? Take them off", "Hair or hat over your forehead?", "Move closer", "Center your face"). Then a guided **180° sweep: straight → left → right → back to center**. The front frame goes to YouCam, and the side angles are shown in the review. If the face model can't load, a timed guided sweep is used instead.
2. **Report**: balanced or not, skin score, skin type (oily/dry/combination/normal, sensitive-leaning), all 12 concerns grouped (Clarity, Hydration & glow, Even tone, Firmness & lines, Eye area) with what each score means, detection masks on your photo, and your shopping list.
3. **Should I buy it?**: the product verdict.
4. **Is it working?**: progress tracking.

## New in v3 (all fail-safe: a feature hides itself if its API isn't available)

| # | Feature | How |
|---|---|---|
| 1 | **"Your skin after 8 weeks" preview** | On a verdict, **YouCam AI Skin Simulation** runs on your scan photo for the product's target concerns. Before/after slider. |
| 2 | **Foundation shade match + try-on** | **YouCam Facial Color Tones Analyzer** measures your exact skin colour → depth + undertone → closest shades (CIELAB ΔE) → on-device try-on that tints only skin-coloured pixels, with a coverage slider |
| 3 | **Read the label** | Photo of the pack → on-device OCR (Tesseract.js, served locally) → ingredient list filled in |
| 4 | **Cross-device sync** | End-to-end encrypted (PBKDF2 + AES-GCM in the browser). The server stores only ciphertext and a hash of a separate auth token. No email or password: one private sync code. |
| 5 | **Concentrations + expert review** | Detects stated % ("10% Niacinamide") and compares it to typical ranges, with a caution for high % on sensitive skin. `npm run export-rules` exports all 103 rules to a CSV for a dermatologist or cosmetic chemist to sign off. |
| 6 | **YouCam's own skin type** | Adds `skin_type` to the analysis (+2 units). Shown as "(YouCam)". Automatically retries without it if the account rejects it, and falls back to an estimate. |
| 7 | **Reminders** | Calendar file with rescan reminders on days 14/28/56, plus in-app and system notifications when a rescan is due |
| 8 | **Retailer widget** | One `<script>` + `<div data-skinverdict data-name data-ingredients>` on any product page adds **"✨ Check against my skin"**, which opens SkinVerdict pre-filled. Demo store: `/shop-demo.html` |
| 9 | **Scanner calibration** | `?debug=1` shows live heuristic values, logs labelled samples, and exports a CSV. Thresholds are in one place. See `CALIBRATION.md`. |
| 10 | **Analytics + error monitoring** | First-party, no personal data: an allow-list of event names → `/api/events`. Browser errors → `/api/client-error`. Counts at `/api/stats?token=$STATS_TOKEN`. |

Units per action: scan 16 (14 if `skin_type` is off), shade match 20, skin preview 4–6. All count toward the per-visitor daily cap.
Sync storage: files in `data/sync/` (set `SYNC_DIR`). On Render's free plan the disk resets on redeploy, so add a Render Disk or a database for production.

## Features

| | Feature | Details |
|---|---|---|
| 📸 | **Scan with a preview step** | Live camera with a face oval (or upload). Before any API unit is spent, the app checks **resolution, lighting, sharpness and orientation** on the device, then you confirm. |
| 🧪 | **YouCam AI Skin Analysis** | 12 concerns, skin score, skin age, and per-concern **detection masks** over your photo |
| 🛒 | **Skin shopping list** | Your 3 lowest scores → actives to look for, ingredients to avoid |
| ⚖️ | **Should I buy it?** | Paste, pick, type a barcode, or **scan a barcode** (Open Beauty Facts). The engine matches actives to *your* weak concerns, flags clashes, detects the **~1% line** (actives listed after the preservative are probably token amounts), warns about stacked exfoliants, and lists what the product **won't** fix. **Ingredient-by-ingredient breakdown** with recognition coverage. |
| 📈 | **Is it working?** | Baseline vs follow-up on the product's target concerns. Ignores ±3-point photo noise, detects irritation, and knows that actives take 4 to 12 weeks. |
| 📊 | **History** | Trend chart, compare any two scans concern by concern, delete individual scans |
| 🔗 | **Share** | A verdict card image (no photo) through the native share sheet, or downloaded |
| 💾 | **Your data, your device** | Scores only, never photos. **Backup download/restore**, and asks the browser to keep the data persistent. |
| 📱 | **Installable PWA** | Add to home screen. Works offline for everything except new scans. Mobile bottom tab bar, dark mode. |
| ♿ | **Accessible** | Status shown with symbols + text (never colour alone), colour-blind-safe palette, ARIA labels/live regions, keyboard navigation, skip link, focus management, reduced-motion support |

### Ingredient database (`public/js/ingredients.js`)
- **62 actives** across acne/oil, retinoids and peptides, exfoliating acids, brighteners, sunscreen filters, hydrators and barrier lipids, soothers, and eye care. Each is weighted per concern (primary vs supporting).
- **8 watch-out groups** (fragrance, 20 named fragrance allergens, essential oils, drying alcohol, harsh sulfates, ~20 pore-clogging ingredients, scrub particles, menthol/camphor). These trigger **only** when your own scores show the matching vulnerability.
- **21 functional families** (solvents, preservatives, emulsifiers, fatty alcohols, which are correctly *not* treated as drying, silicones, emollients, pH adjusters, and more), so typical product lists are 90–100% recognised.

## YouCam API used

**AI Skin Analysis (v2.0, SD)**, in `lib/youcam.js`:

1. `POST /s2s/v2.0/file/skin-analysis` → `file_id` + pre-signed upload URL
2. `PUT` image bytes to that URL
3. `POST /s2s/v2.0/task/skin-analysis` with `src_file_id` and 12 `dst_actions`: `acne, wrinkle, redness, dark_circle_v2, pore, texture, age_spot, moisture, eye_bag, oiliness, radiance, firmness`
4. `GET /s2s/v2.0/task/skin-analysis/{task_id}`: polled through our server (with retry/backoff) until `success`
5. `lib/normalize.js` maps `ui_score` and `mask_urls` per concern, plus the overall score and skin age

14 units per scan. The key is verified at startup with a free call, and the server picks the right regional API server (India `makeupar.com` or global `perfectcorp.com`) automatically.

## Security & reliability
- API key server-side only. **Client error messages never mention keys or configuration**; details go to the server log only.
- **Rate limits on every API route** (120/min general, 6/min scan starts, 20/min barcode lookups), plus per-visitor and global **daily scan quotas** to protect API units.
- Strict **Content-Security-Policy** (no inline scripts), `nosniff`, `Referrer-Policy`, `Permissions-Policy`, no `X-Powered-By`.
- Ingredient input is **sanitized** (HTML/script/entity/control-character stripping, length and item caps), and every rendered string is HTML-escaped (defense in depth). Backup imports are schema-validated.
- Task-ID and image payload validation. Scan polling retries with exponential backoff. An in-flight scan **resumes after a page reload** without spending units again. Scan creation is deliberately **not** auto-retried, to avoid double charges.
- **Structured JSON logs** (`scan_started`, `scan_done`, `scan_error`, …) and a `GET /api/health` endpoint.

## Project structure

```
skinverdict/
├── server.js                 Express: security headers, rate limits, API routes, optional local HTTPS
├── lib/
│   ├── youcam.js             YouCam client: key check, upload → task → poll
│   ├── normalize.js          Raw YouCam JSON → { scores, masks, overall, skinAge }
│   ├── productLookup.js      Barcode → ingredients (Open Beauty Facts, cached)
│   ├── ratelimit.js          Dependency-free rate limiter
│   ├── log.js                Structured JSON logging
│   └── https.js              Self-signed certificate for phone testing on your Wi-Fi
├── public/
│   ├── index.html · styles.css · manifest.webmanifest · sw.js · icons/
│   └── js/
│       ├── ingredients.js    Ingredient database
│       ├── engine.js         Verdicts, shopping list, progress, sanitizing
│       ├── store.js          Local data, validation, backup/restore
│       ├── app.js            UI: camera, preview, scan, decide, track, chart
│       ├── theme.js          Dark mode (no flash)
│       ├── products.js       Sample (unbranded) products
│       ├── barcode.js        Lazy-loaded: live barcode scanning
│       └── share.js          Lazy-loaded: share-card renderer
├── fixtures/demo-result.json Sample result for "Try a sample scan"
├── scripts/test-api.js       One real scan from the command line
└── test/
    ├── engine.test.js        21 engine + sanitizer tests
    ├── server.test.js        9 integration tests (against the mock)
    └── mock-youcam.js        Local fake YouCam API (no units used)
```

Routes: `POST /api/tone` · `POST /api/simulate` (+ `GET …/:taskId`) · `PUT /api/sync/:id` · `POST /api/sync/:id/get` · `POST /api/events` · `POST /api/client-error` · `GET /api/stats` · `POST /api/scan` · `GET /api/scan/:taskId` · `GET /api/product/:barcode` · `GET /api/demo` · `GET /api/config` · `GET /api/health`

## Run it locally

Requires Node.js 18+.

```bash
npm install
cp .env.example .env        # put your key on the YOUCAM_API_KEY= line
npm start                   # http://localhost:3000
```

The log must show `youcam_key_ok … Scans are LIVE`. `npm run dev` prints friendlier log lines.

**Test on your phone (live camera + face guide):** browsers only allow in-page cameras on HTTPS.

```bash
npm run https
```

Then open the printed `https://192.168.x.x:3443` link on your phone (same Wi-Fi). Tap **Advanced → Proceed** (it's a self-signed certificate) and allow the camera. On plain `http://` the app opens the phone's camera app instead.

**Face tracking:** the scanner uses Google's MediaPipe Face Landmarker (Apache-2.0). The engine is served from this app. The small model file is downloaded by the browser from Google's servers on first use. To self-host it, save [face_landmarker.task](https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task) as `public/models/face_landmarker.task`.

Other commands: `npm test` (all tests) · `node scripts/test-api.js selfie.jpg` (one real scan, about 14 units)

## Deploy (Render, free)

1. Push to GitHub. 2. render.com → **New → Web Service** → pick the repo. 3. Build `npm install`, Start `npm start`, plan **Free**. 4. **Environment:** `YOUCAM_API_KEY` (optional: `SCAN_LIMIT_PER_IP`, `SCAN_LIMIT_PER_DAY`). 5. Deploy. Render's HTTPS URL gives the live camera on phones, and the app can be installed to the home screen.

## Testing instructions for judges

- Open the live URL. **Take a selfie** (or **Upload a photo**), check the preview, and tap **Analyze my skin** for a live YouCam scan. Or tap **Try a sample scan**.
- **Should I buy it?**: tap the sample products to see different verdicts, paste any real ingredient list, or enter a barcode. Open **See every ingredient** for the breakdown.
- **I bought it: track if it works** → **Is it working?**: rescan, or tap **Demo: simulate 4 weeks later** (adds a clearly labelled sample follow-up).

## Troubleshooting
- **Same result for every photo / red banner:** the server can't reach YouCam with its key. Check the server log for `youcam_key_missing` or `youcam_key_rejected`. Live results show a green **✓ Live YouCam AI analysis** tag.
- **Camera opens the gallery or camera app on a phone:** you're on `http://`. Use `npm run https` locally, or the HTTPS Render URL.
- **Camera blocked:** re-allow it from the 🔒 icon in the address bar.

## Disclaimer
Cosmetic guidance based on widely used ingredient conventions, not medical advice.

## License
MIT
