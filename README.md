# TrueRule

A physically accurate on-screen ruler. Built phone-first, works anywhere. Hold a
real object against your screen and read its true length — no weird scaling from
different phone sizes, zoom, or scroll.

**Live:** _(deploy link goes here)_

## Why it's actually accurate

A browser can't read your screen's real DPI, and the CSS "96px = 1 inch" rule is
wrong on most phones. So TrueRule does two things:

1. **Auto-guess** a starting scale on first load — usable instantly.
2. **Calibrate** against a bank/ID card (ISO/IEC 7810 ID-1 is exactly
   **85.6 mm** wide everywhere on Earth). You match an on-screen outline to your
   card once; we compute your device's true pixels-per-millimeter and remember
   it. Every measurement after that is physically correct.

The card is shown standing up (portrait) so it fits even on phones, which are
narrower than a card is wide.

## Features

- Full-screen ruler pinned to the left edge, **0 at the top**.
- Inches (1/16" ticks) or centimeters (mm ticks) — tap to switch.
- Two draggable points to measure any distance, with a live readout.
- One-time card calibration, saved per device (`localStorage`).
- Locked against pinch-zoom, double-tap zoom, scroll drift, and desktop
  ctrl/cmd zoom — so the scale never silently changes.
- Retina-crisp ticks, light/dark aware.

## Run locally

It's plain static HTML/CSS/JS — no build step.

```bash
# from this folder
python3 -m http.server 8000
# then open http://localhost:8000
```

## Deploy

Static site, deploys as-is to Vercel (or any static host). No config needed.

## Tech

- `index.html` — structure + locked viewport
- `style.css` — full-screen layout and controls
- `app.js` — scale engine, ruler/measure rendering, calibration, persistence

## Roadmap

- Horizontal ruler / two-edge mode
- Metric ⇄ imperial fraction presets for engineering
- Shareable calibration profiles per device
- PWA install + offline

---

Built as a demo. Measurements are as accurate as your calibration — for anything
critical, double-check against a physical ruler.
