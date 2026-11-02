# Submission kit (copy-paste into Devpost)

## Project name
SkinVerdict

## Tagline (one line)
Should I buy this, and is it working? A selfie-powered verdict on any skincare product, for *your* skin.

## Inspiration
Most skincare purchases happen in a 30-second window on a product page, guided by a "for oily skin" label and a few reviews. We kept buying serums that either did nothing for us or made our skin worse, and we only found out weeks later. The YouCam Skin AI already gives a precise, per-concern read of someone's skin. What was missing was the step that turns that read into a decision: *this product, for this face, right now?*

## What it does
SkinVerdict meets people at the three moments they actually think about their skin.

**1. Scan:** a live face scanner with a face-shaped outline, a real-time 3D face mesh, and coaching (light, glasses, hair over the forehead, distance), followed by a guided 180° sweep (straight → left → right). Then a 10-second selfie (live camera with a face guide, or upload) goes to the **YouCam AI Skin Analysis API**. You get 12 concern scores, an overall skin score, skin age, and YouCam's detection masks drawn on your face, so you can see *where* the redness or the enlarged pores are.

**2. Should I buy it?** Paste any product's ingredient list (or pick a sample). The decision engine:
- matches each active ingredient to *your* lowest-scoring concerns (salicylic acid → breakouts and pores, niacinamide → oil and pores, ceramides → hydration, and so on)
- flags clashes with your own weak spots, such as fragrance when your redness score is low, pore-clogging oils when your breakout score is low, drying alcohol when hydration is low, or strong acids or retinoids on reactive skin
- notices when an active is listed so late that it's probably a token amount
- tells you what the product **won't** fix, and what to look for instead

The result is one clear verdict (**Good match / Use with caution / Skip**) with reasons tied to your scores.

**3. Is it working?** Tap "I bought it" and SkinVerdict saves your scan as a baseline. Rescan in 2 to 4 weeks. It compares only the concerns that product targets, ignores small photo-to-photo noise (±3 points), watches for irritation (sudden drops in redness or acne scores), and knows that most actives need 4 to 8 weeks. You get **Keep going / Give it time / Consider switching / Pause it**.

There's also a personal **skin shopping list**: for your three lowest scores, which ingredients to look for and which to avoid.

**Built to be used, not just demoed:**
- **Photo preview with quality checks** (resolution, lighting, sharpness) before any API unit is spent
- **Barcode lookup and live barcode scanning**, so you don't have to type ingredient lists
- **Ingredient database** of 62 actives, 8 watch-out groups and 21 functional families. Typical lists are 90–100% recognised, with an ingredient-by-ingredient breakdown and detection of the ~1% line.
- **History chart and compare-any-two-scans**, plus a **shareable verdict card**
- **Installable PWA** that works offline (except new scans), with dark mode and a mobile tab bar
- **Accessible:** symbols + text (never colour alone), ARIA, keyboard navigation
- **Private:** photos are never stored; scores stay on the device, with backup/restore

## Who it's for and why it matters
Online skincare shoppers, especially in fast-growing markets like India, where buyers compare dozens of similar serums on marketplace apps. The value for shoppers is less money wasted on wrong products and fewer reactions. The value for retailers is higher purchase confidence and fewer returns. The "Is it working?" loop gives a reason to come back and rescan, which is where repeat purchases and the next recommendation happen.

## How we built it
- **YouCam AI Skin Analysis API (v2.0)**: the full flow runs server-side: file init → pre-signed upload → task with 12 `dst_actions` → polling → normalized scores and per-concern `mask_urls`
- **Node.js + Express** backend that keeps the API key private, with per-visitor and daily scan caps to protect API units, and friendly messages for YouCam's image errors (face too small, too dark, out of frame)
- **Vanilla JS** front end, with no build step: camera capture cropped to a 3:4 portrait so the face fills the frame as YouCam recommends, mask overlays, and a three-step flow
- A **rule-based decision engine** (`engine.js`) that encodes widely used cosmetic-ingredient conventions and is unit-tested
- **Privacy by design**: photos are never stored. Only scores are saved, and only on the user's device.
- **Hardened**: strict CSP, rate limits on every route, daily scan quotas, sanitized input, key-free error messages, polling retries with backoff, resume-after-reload, structured logs, health endpoint, and 30 automated tests against a mock YouCam server

## Challenges
- Making verdicts *personal* instead of generic: every reason in the verdict quotes the user's own score.
- Telling real improvement from photo noise and from "too early to tell".
- Designing the scan step so first-time users get a valid photo on the first try.

## Accomplishments
A complete loop (scan → decide → buy → verify) that a first-time user understands in seconds, built on a real API integration rather than a mockup.

## What we learned
Skin analysis is most valuable *right before* and *a few weeks after* a purchase, not as a one-off report.

## Also included
YouCam Skin Simulation before/after preview · YouCam Facial Color Tones shade match with on-device foundation try-on · on-device label OCR · end-to-end encrypted sync · concentration checks plus an expert-review export · YouCam skin-type output · calendar and notification reminders · an embeddable retailer widget with a demo store · scanner calibration mode · privacy-friendly analytics and error monitoring.

## What's next
- Clinical review of the ingredient rules (export ready: `npm run export-rules`)
- Calibrate the scanner's coaching checks on a diverse set of faces (`?debug=1` tool included)
- Retailer pilots with the widget; brand shade ranges for the shade match

## Built with
YouCam AI Skin Analysis API · MediaPipe Face Landmarker · Node.js · Express · JavaScript · HTML/CSS · PWA (service worker) · BarcodeDetector API · Open Beauty Facts · Render

---

# Demo video script (target: 2:15, max 3:00)

Record your screen at 1080p with your face visible for the scan. Use **no copyrighted music**: silence, or royalty-free music from the YouTube Audio Library. Speak over the footage, or add captions.

| Time | Show on screen | Say |
|---|---|---|
| 0:00–0:15 | Home page | "We buy skincare in a 30-second window, guided by a label that says 'for oily skin'. Weeks later we find out it didn't work, or made things worse. SkinVerdict fixes both moments." |
| 0:15–0:45 | Tap **Start face scan** → show the live 3D mesh + coaching → sweep straight/left/right → **review with quality checks** → Analyze → **Report page** (balance, skin type, grouped analysis). Tap 2 mask chips. | "I take a selfie, and before spending any API credits, SkinVerdict checks lighting and sharpness right on my phone. SkinVerdict sends it to the **YouCam AI Skin Analysis API**: we upload the image, create a skin-analysis task with 12 concerns, and poll for the result. I get 12 scores, my skin age, and YouCam's detection masks showing exactly where on my face each concern is." |
| 0:45–1:00 | Scroll to the shopping list | "My three lowest scores become a personal shopping list: what to look for, and what to avoid." |
| 1:00–1:45 | **Should I buy it?** → tap Niacinamide serum (good) → Coconut balm (skip) → Vitamin C serum (caution or skip) → open "See every ingredient" | "Now the real question: should I buy this? I paste any ingredient list. SkinVerdict matches each active to *my* weak spots, and flags clashes, like fragrance when my redness is high, or pore-clogging oils on acne-prone skin. It even notices when an active is listed so late it's probably a token amount. One clear verdict, with every reason tied to my own scores." |
| 1:45–2:15 | Tap **I bought it: track** → Is it working? → Rescan *or* **Demo: simulate 4 weeks later** | "When I buy it, my scan becomes a baseline. A few weeks later I rescan, and SkinVerdict compares only the concerns this product targets. It ignores photo noise, watches for irritation, and knows actives take time. Keep it, give it time, or switch." |
| 2:15–2:30 | Back to home / the GitHub README | "SkinVerdict: powered by the YouCam AI Skin Analysis API. Know before you buy, and know if it's working." |

Say "simulated" out loud if you use the demo follow-up button. It's labelled "Sample" in the app.

# Screenshots to upload (5)
1. Home page
2. Scan results: scores plus a mask overlay switched on
3. A "Good match" verdict
4. A "Skip it" verdict with red cautions
5. "Is it working?" with the before→after bars

# Final checklist before 10:15 PM IST (11:45 AM ET)
- [ ] GitHub repo is public and has the LICENSE file (or is shared with contact_event@PerfectCorp.com)
- [ ] Live Render URL works in an incognito window
- [ ] YouTube video is **Public** (not Unlisted/Private) and under 3 minutes
- [ ] Description, screenshots, repo link, video link and live link are all on Devpost
- [ ] Testing instructions pasted (from the README section "Testing instructions for judges")
- [ ] Opt into **Rising Star** (student with .edu or school email) or **Women in Tech**, if eligible
- [ ] All team members added
- [ ] Click **Submit**, not just save the draft
