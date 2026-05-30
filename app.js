/* ===========================================================================
   TrueRule — an accurate on-screen ruler.

   Everything runs off ONE number: pxPerMM (CSS pixels per millimeter).
   We resolve it in priority order:
     1. The user's saved calibration (always wins — it's a measured truth).
     2. A known-device lookup. The browser can't read physical size or the
        exact model, but resolution + devicePixelRatio together identify an
        Apple device family, and every phone in a family has a known PPI.
        So iPhones/iPads auto-correct with no calibration.
     3. A fallback guess of 96px = 1in (the CSS reference). Usable, not exact.
        Laptops/monitors and unknown phones land here and should calibrate.
   Calibration solves for the true pxPerMM by matching a bank card
   (ISO/IEC 7810 ID-1: exactly 85.6 x 53.98 mm worldwide).
   =========================================================================== */

'use strict';

const MM_PER_INCH = 25.4;
const DEFAULT_PX_PER_MM = 96 / MM_PER_INCH; // ≈ 3.7795, the CSS reference
const CARD_LONG_MM = 85.6;                  // card long edge (the precise one)
const CARD_SHORT_MM = 53.98;                // card short edge
const STORE_SCALE = 'truerule.pxPerMM';
const STORE_UNIT = 'truerule.unit';
const STORE_SNAP = 'truerule.snap';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/* Known Apple devices: "minPts x maxPts @ dpr" -> physical PPI.
   PPI is constant within a family, so we don't need the exact model name. */
const APPLE_PPI = {
  // iPhones
  '320x480@2': 326,  // 4 / 4S
  '320x568@2': 326,  // 5 / 5S / 5C / SE (1st gen)
  '375x667@2': 326,  // 6 / 6S / 7 / 8 / SE 2 / SE 3
  '414x736@3': 401,  // 6+ / 6S+ / 7+ / 8+
  '375x812@3': 458,  // X / XS / 11 Pro
  '414x896@2': 326,  // XR / 11
  '414x896@3': 458,  // XS Max / 11 Pro Max
  '360x780@3': 476,  // 12 mini / 13 mini
  '390x844@3': 460,  // 12 / 12 Pro / 13 / 13 Pro / 14
  '428x926@3': 458,  // 12 Pro Max / 13 Pro Max
  '393x852@3': 460,  // 14 Pro / 15 / 15 Pro / 16
  '430x932@3': 460,  // 14 Plus / 15 Plus / 14 Pro Max / 15 Pro Max
  '402x874@3': 460,  // 16 Pro
  '440x956@3': 460,  // 16 Pro Max
  // iPads (264 PPI across the line; mini is 326)
  '744x1133@2': 326, // iPad mini 6
  '768x1024@2': 264, // iPad / iPad Air / iPad Pro 9.7
  '810x1080@2': 264, // iPad 10.2
  '820x1180@2': 264, // iPad Air 10.9 / iPad 10.9
  '834x1112@2': 264, // iPad Pro 10.5 / Air 10.5
  '834x1194@2': 264, // iPad Pro 11
  '1024x1366@2': 264 // iPad Pro 12.9
};

const ppiToPxPerMM = (ppi, dpr) => ppi / (MM_PER_INCH * dpr);

function detectDevice() {
  const ua = navigator.userAgent || '';
  const isApple = /iPhone|iPad|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS pretends to be Mac
  if (!isApple) return null;
  const dpr = Math.round((window.devicePixelRatio || 1) * 100) / 100;
  const a = Math.min(screen.width, screen.height);
  const b = Math.max(screen.width, screen.height);
  const ppi = APPLE_PPI[`${a}x${b}@${dpr}`];
  if (!ppi) return null;
  const name = /iPad/.test(ua) || navigator.platform === 'MacIntel' ? 'iPad'
    : /iPhone/.test(ua) ? 'iPhone' : 'iOS device';
  return { ppi, name };
}

const state = {
  pxPerMM: DEFAULT_PX_PER_MM,
  scaleSource: 'guess',   // 'calibrated' | 'auto' | 'guess'
  deviceInfo: null,
  unit: 'in',             // 'in' | 'cm'
  snap: false,            // snap measure points to the ruler grid
  A: { x: 0, y: 0 },
  B: { x: 0, y: 0 }
};

let w = 0, h = 0, dpr = 1;
let handlesUserMoved = false; // until the user drags one, keep them parked relative to the viewport
const canvas = document.getElementById('ruler');
const ctx = canvas.getContext('2d');
const darkMQ = window.matchMedia('(prefers-color-scheme: dark)');

/* ---------- resolve the scale (priority order above) ---------- */
function resolveScale() {
  const saved = parseFloat(localStorage.getItem(STORE_SCALE));
  if (saved && isFinite(saved) && saved > 0.5 && saved < 60) {
    state.pxPerMM = saved;
    state.scaleSource = 'calibrated';
    return;
  }
  const dev = detectDevice();
  if (dev) {
    state.pxPerMM = ppiToPxPerMM(dev.ppi, window.devicePixelRatio || 1);
    state.scaleSource = 'auto';
    state.deviceInfo = dev;
    return;
  }
  state.pxPerMM = DEFAULT_PX_PER_MM;
  state.scaleSource = 'guess';
}
function loadUnit() {
  const u = localStorage.getItem(STORE_UNIT);
  if (u === 'in' || u === 'cm') state.unit = u;
}

/* ---------- scale status chip ---------- */
let statusTimer = null;
function updateStatus() {
  const el = document.getElementById('status');
  const txt = document.getElementById('statusText');
  el.classList.remove('warn', 'hidden');
  clearTimeout(statusTimer);
  if (state.scaleSource === 'calibrated') {
    txt.textContent = 'Calibrated ✓';
    statusTimer = setTimeout(() => el.classList.add('hidden'), 4000);
  } else if (state.scaleSource === 'auto') {
    txt.textContent = `Auto: ${state.deviceInfo.name} · ${state.deviceInfo.ppi} PPI`;
    statusTimer = setTimeout(() => el.classList.add('hidden'), 4500);
  } else {
    txt.textContent = 'Estimated — tap to calibrate';
    el.classList.add('warn'); // stays put until calibrated
  }
}

/* ---------- canvas sizing (crisp on retina) ---------- */
function resize() {
  w = window.innerWidth;
  h = window.innerHeight;
  dpr = window.devicePixelRatio || 1;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  if (w > 0 && h > 0) {
    if (!handlesUserMoved) {
      // park them relative to the current viewport (survives the real size
      // arriving late, and re-flows nicely on rotate until first touched)
      state.A = { x: Math.round(w * 0.60), y: Math.round(h * 0.28) };
      state.B = { x: Math.round(w * 0.60), y: Math.round(h * 0.60) };
    } else {
      for (const k of ['A', 'B']) {
        state[k].x = clamp(state[k].x, 0, w);
        state[k].y = clamp(state[k].y, 0, h);
      }
    }
    placeHandle('A'); placeHandle('B');
  }
  layoutLabels();
  draw();
}

/* ---------- number formatting ---------- */
function inchFraction(inches) {
  const whole = Math.floor(inches + 1e-9);
  let num = Math.round((inches - whole) * 16);
  let den = 16;
  if (num === 16) return String(whole + 1) + '″';
  if (num === 0) return whole + '″';
  while (num % 2 === 0) { num /= 2; den /= 2; }
  return (whole > 0 ? whole + ' ' : '') + num + '/' + den + '″';
}
function pillText(mm) {
  if (state.unit === 'in') return (mm / MM_PER_INCH).toFixed(2) + '″';
  if (mm < 10) return mm.toFixed(0) + ' mm';
  return (mm / 10).toFixed(1) + ' cm';
}
function readoutText(mm) {
  // Compact on phones (the fraction/mm tail wraps and breaks the number); full on desktop.
  const narrow = window.innerWidth < 600;
  if (state.unit === 'in') {
    const inch = mm / MM_PER_INCH;
    return narrow ? '↔ ' + inch.toFixed(2) + '″'
                  : '↔ ' + inch.toFixed(2) + '″ · ' + inchFraction(inch);
  }
  return narrow ? '↔ ' + (mm / 10).toFixed(1) + ' cm'
                : '↔ ' + (mm / 10).toFixed(2) + ' cm · ' + mm.toFixed(0) + ' mm';
}

/* ---------- drawing ---------- */
const labelsEl = document.getElementById('labels');
const capsuleEl = document.getElementById('capsule');

function colors() {
  const dark = darkMQ.matches;
  return {
    ink: dark ? '#eef0f5' : '#14151a',
    faint: dark ? 'rgba(238,240,245,0.55)' : 'rgba(20,21,26,0.55)',
    accent: '#2563eb'
  };
}

// Crisp line on the device-pixel grid. Even device-widths center on an integer
// pixel, odd widths on a half-pixel — otherwise the line blurs across two rows
// at 2x/3x. (The old code always used +0.5, which fuzzed every even-width line.)
function hline(x0, x1, y, cssW, color) {
  const dw = Math.max(1, Math.round(cssW * dpr));
  const dy = Math.round(y * dpr);
  const cy = (dw % 2 ? dy + 0.5 : dy) / dpr;
  ctx.strokeStyle = color;
  ctx.lineWidth = dw / dpr;
  ctx.beginPath();
  ctx.moveTo(x0, cy);
  ctx.lineTo(x1, cy);
  ctx.stroke();
}
function vline(x, y0, y1, cssW, color) {
  const dw = Math.max(1, Math.round(cssW * dpr));
  const dx = Math.round(x * dpr);
  const cx = (dw % 2 ? dx + 0.5 : dx) / dpr;
  ctx.strokeStyle = color;
  ctx.lineWidth = dw / dpr;
  ctx.beginPath();
  ctx.moveTo(cx, y0);
  ctx.lineTo(cx, y1);
  ctx.stroke();
}

// Snap step = the ruler's finest tick (1/16" or 1mm), so points land on its lines.
function gridSpacing() {
  return state.unit === 'in' ? (state.pxPerMM * MM_PER_INCH) / 16 : state.pxPerMM;
}
// Faint full-screen grid shown while snap is on (drawn coarser than the snap step).
function drawGrid() {
  const dark = darkMQ.matches;
  ctx.strokeStyle = dark ? 'rgba(238,240,245,0.09)' : 'rgba(20,21,26,0.08)';
  ctx.lineWidth = 1 / dpr;
  const g = state.unit === 'in' ? (state.pxPerMM * MM_PER_INCH) / 2 : state.pxPerMM * 10; // 1/2" or 1cm
  ctx.beginPath();
  for (let x = g; x < w; x += g) { const cx = (Math.round(x * dpr) + 0.5) / dpr; ctx.moveTo(cx, 0); ctx.lineTo(cx, h); }
  for (let y = g; y < h; y += g) { const cy = (Math.round(y * dpr) + 0.5) / dpr; ctx.moveTo(0, cy); ctx.lineTo(w, cy); }
  ctx.stroke();
}

// Ruler numbers + unit tag are real HTML (font-hinted, pixel-crisp), rebuilt
// only when the scale, unit, or viewport changes — not on every handle drag.
function layoutLabels() {
  const frag = document.createDocumentFragment();
  const unit = document.createElement('div');
  unit.className = 'rlabel unit';
  unit.textContent = state.unit === 'in' ? 'INCHES' : 'CM';
  frag.appendChild(unit);
  const per = state.unit === 'in' ? state.pxPerMM * MM_PER_INCH : state.pxPerMM * 10;
  if (per > 4) {
    for (let n = 1; n * per <= h + 1; n++) {
      const d = document.createElement('div');
      d.className = 'rlabel';
      d.textContent = n;
      d.style.top = (n * per) + 'px';
      frag.appendChild(d);
    }
  }
  labelsEl.replaceChildren(frag);
}

function draw() {
  const { ink, faint, accent } = colors();
  ctx.clearRect(0, 0, w, h);
  if (state.snap) drawGrid();
  vline(0, 0, h, 2, ink); // measuring edge, 0 at the top

  const pxmm = state.pxPerMM;
  if (state.unit === 'in') {
    const step = (pxmm * MM_PER_INCH) / 16; // 1/16" ticks
    let i = 0;
    for (let y = 0; y <= h + 1; y += step, i++) {
      if (i % 16 === 0) hline(0, 78, y, 2, ink);
      else if (i % 8 === 0) hline(0, 50, y, 1.5, ink);
      else if (i % 4 === 0) hline(0, 36, y, 1, faint);
      else if (i % 2 === 0) hline(0, 26, y, 1, faint);
      else hline(0, 16, y, 1, faint);
    }
  } else {
    const step = pxmm; // 1 mm ticks
    let i = 0;
    for (let y = 0; y <= h + 1; y += step, i++) {
      if (i % 10 === 0) hline(0, 78, y, 2, ink);
      else if (i % 5 === 0) hline(0, 46, y, 1.5, ink);
      else hline(0, 24, y, 1, faint);
    }
  }

  // measure line + endpoint dots (the value capsule is HTML)
  const { A, B } = state;
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2.5;
  ctx.setLineDash([2, 6]);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(A.x, A.y);
  ctx.lineTo(B.x, B.y);
  ctx.stroke();
  ctx.setLineDash([]);
  for (const p of [A, B]) {
    ctx.fillStyle = accent;
    ctx.beginPath(); ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2); ctx.fill();
  }

  const mm = Math.hypot(B.x - A.x, B.y - A.y) / state.pxPerMM;
  capsuleEl.textContent = pillText(mm);
  capsuleEl.style.left = clamp((A.x + B.x) / 2, 46, w - 46) + 'px';
  capsuleEl.style.top = clamp((A.y + B.y) / 2, 22, h - 22) + 'px';
  document.getElementById('readout').textContent = readoutText(mm);
}

let rafPending = false;
function drawSoon() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => { rafPending = false; draw(); });
}

/* ---------- measure handles ---------- */
function placeHandle(key) {
  const el = document.getElementById('handle' + key);
  el.style.left = state[key].x + 'px';
  el.style.top = state[key].y + 'px';
}
// Move a point, snapping to the ruler grid when enabled. Reaches the true edges
// (0,0 = the ruler's zero corner) so it can line up with the 0 mark cleanly.
function setPoint(key, x, y) {
  x = clamp(x, 0, w);
  y = clamp(y, 0, h);
  if (state.snap) {
    const g = gridSpacing();
    x = clamp(Math.round(x / g) * g, 0, w);
    y = clamp(Math.round(y / g) * g, 0, h);
  }
  state[key].x = x;
  state[key].y = y;
  placeHandle(key);
}
function makeDraggable(key) {
  const el = document.getElementById('handle' + key);
  el.addEventListener('pointerdown', (e) => {
    try { el.setPointerCapture(e.pointerId); } catch (_) {}
    el.classList.add('drag');
    e.preventDefault();
  });
  el.addEventListener('pointermove', (e) => {
    if (!el.hasPointerCapture(e.pointerId)) return;
    handlesUserMoved = true;
    setPoint(key, e.clientX, e.clientY);
    drawSoon();
  });
  const end = (e) => { el.classList.remove('drag'); try { el.releasePointerCapture(e.pointerId); } catch (_) {} };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('keydown', (e) => {
    const d = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowLeft') state[key].x -= d;
    else if (e.key === 'ArrowRight') state[key].x += d;
    else if (e.key === 'ArrowUp') state[key].y -= d;
    else if (e.key === 'ArrowDown') state[key].y += d;
    else return;
    e.preventDefault();
    handlesUserMoved = true;
    setPoint(key, state[key].x, state[key].y);
    drawSoon();
  });
}

/* ---------- units ---------- */
function setUnit(u) {
  state.unit = u;
  document.getElementById('unitLabel').textContent = u === 'in' ? 'inches' : 'cm';
  localStorage.setItem(STORE_UNIT, u);
  layoutLabels();
  draw();
}

/* ---------- calibration ---------- */
let calPxPerMM = DEFAULT_PX_PER_MM;
let calTop = 80;
const calEl = document.getElementById('cal');
const calCard = document.getElementById('calCard');
const calHead = document.querySelector('.cal-head');
const calBar = document.querySelector('.cal-bar');
const calSlider = document.getElementById('calSlider');

// Calibrate by the card's WIDTH (short edge, 53.98 mm). It fits comfortably
// across any phone, unlike the long edge which is nearly the whole screen.
// The card's height just follows and may hang off the bottom — that's fine.
function calBounds() {
  const headH = calHead.getBoundingClientRect().height || 84;
  calTop = headH + 14;
  const minPxPerMM = 2.0;
  const maxWidth = w - 52; // leave room for the side grip
  const maxPxPerMM = Math.max(minPxPerMM + 1, maxWidth / CARD_SHORT_MM);
  return { minPxPerMM, maxPxPerMM };
}
function calRender() {
  const { minPxPerMM, maxPxPerMM } = calBounds();
  calPxPerMM = clamp(calPxPerMM, minPxPerMM, maxPxPerMM);
  const cardW = CARD_SHORT_MM * calPxPerMM;
  const cardH = CARD_LONG_MM * calPxPerMM;
  calCard.style.top = calTop + 'px';
  calCard.style.width = cardW + 'px';
  calCard.style.height = cardH + 'px';
  const ratio = (calPxPerMM - minPxPerMM) / (maxPxPerMM - minPxPerMM);
  document.getElementById('calFill').style.width = (ratio * 100) + '%';
  document.getElementById('calThumb').style.left = (ratio * 100) + '%';
  const ppi = Math.round(calPxPerMM * MM_PER_INCH * (window.devicePixelRatio || 1));
  document.getElementById('calPx').textContent = Math.round(cardW) + ' px';
  document.getElementById('calPPI').textContent = '≈ ' + ppi + ' PPI';
}
function openCal() {
  calPxPerMM = state.pxPerMM;
  calEl.classList.remove('hidden');
  calEl.setAttribute('aria-hidden', 'false');
  calRender();
}
function closeCal() {
  calEl.classList.add('hidden');
  calEl.setAttribute('aria-hidden', 'true');
}
function calNudge(deltaPx) {
  calPxPerMM = (CARD_SHORT_MM * calPxPerMM + deltaPx) / CARD_SHORT_MM;
  calRender();
}
function sliderSet(clientX) {
  const r = calSlider.getBoundingClientRect();
  const { minPxPerMM, maxPxPerMM } = calBounds();
  const ratio = clamp((clientX - r.left) / r.width, 0, 1);
  calPxPerMM = minPxPerMM + ratio * (maxPxPerMM - minPxPerMM);
  calRender();
}
// press-and-hold auto-repeat for the +/- fine buttons
function holdRepeat(el, fn) {
  let to = null, iv = null;
  const stop = () => { clearTimeout(to); clearInterval(iv); to = iv = null; };
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { el.setPointerCapture(e.pointerId); } catch (_) {}
    fn();
    to = setTimeout(() => { iv = setInterval(fn, 55); }, 320);
  });
  el.addEventListener('pointerup', stop);
  el.addEventListener('pointerleave', stop);
  el.addEventListener('pointercancel', stop);
}
function capturingDrag(el, onMove) {
  el.addEventListener('pointerdown', (e) => {
    try { el.setPointerCapture(e.pointerId); } catch (_) {}
    e.preventDefault();
    onMove(e);
  });
  el.addEventListener('pointermove', (e) => {
    if (!el.hasPointerCapture(e.pointerId)) return;
    onMove(e);
  });
  const stop = (e) => { try { el.releasePointerCapture(e.pointerId); } catch (_) {} };
  el.addEventListener('pointerup', stop);
  el.addEventListener('pointercancel', stop);
}
function wireCalibration() {
  document.getElementById('calBtn').addEventListener('click', openCal);
  document.getElementById('status').addEventListener('click', openCal);
  document.getElementById('calCancel').addEventListener('click', closeCal);

  document.getElementById('calSave').addEventListener('click', () => {
    state.pxPerMM = calPxPerMM;
    state.scaleSource = 'calibrated';
    localStorage.setItem(STORE_SCALE, String(calPxPerMM));
    closeCal(); updateStatus(); draw();
  });
  document.getElementById('calReset').addEventListener('click', () => {
    localStorage.removeItem(STORE_SCALE); // back to auto-detect / guess
    resolveScale();
    closeCal(); updateStatus(); draw();
  });

  holdRepeat(document.getElementById('calMinus'), () => calNudge(-1));
  holdRepeat(document.getElementById('calPlus'), () => calNudge(+1));
  capturingDrag(calSlider, (e) => sliderSet(e.clientX));
  capturingDrag(document.getElementById('calGrip'), (e) => {
    const { minPxPerMM, maxPxPerMM } = calBounds();
    const width = 2 * Math.abs(e.clientX - w / 2); // card is centered
    calPxPerMM = clamp(width / CARD_SHORT_MM, minPxPerMM, maxPxPerMM);
    calRender();
  });
}

/* ---------- lock down zoom / scroll ---------- */
function lockGestures() {
  for (const t of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(t, (e) => e.preventDefault(), { passive: false });
  }
  let last = 0;
  document.addEventListener('touchend', (e) => {
    const now = e.timeStamp;
    if (now - last <= 320 && e.cancelable) e.preventDefault();
    last = now;
  }, { passive: false });
  window.addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && ['+', '-', '=', '0'].includes(e.key)) e.preventDefault();
  });
  document.addEventListener('contextmenu', (e) => e.preventDefault());
}

/* ---------- init ---------- */
function init() {
  resolveScale();
  loadUnit();
  setUnit(state.unit);
  updateStatus();

  document.getElementById('unitBtn').addEventListener('click', () => {
    setUnit(state.unit === 'in' ? 'cm' : 'in');
  });

  // snap-to-grid toggle
  state.snap = localStorage.getItem(STORE_SNAP) === '1';
  const snapBtn = document.getElementById('snapBtn');
  const updateSnapBtn = () => {
    snapBtn.classList.toggle('on', state.snap);
    snapBtn.setAttribute('aria-pressed', String(state.snap));
  };
  updateSnapBtn();
  snapBtn.addEventListener('click', () => {
    state.snap = !state.snap;
    localStorage.setItem(STORE_SNAP, state.snap ? '1' : '0');
    if (state.snap) { setPoint('A', state.A.x, state.A.y); setPoint('B', state.B.x, state.B.y); }
    updateSnapBtn();
    draw();
  });

  makeDraggable('A');
  makeDraggable('B');
  wireCalibration();
  lockGestures();

  resize();
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 60));
  darkMQ.addEventListener?.('change', draw);

  // expose a couple internals for debugging/inspection
  window.__truerule = { state, detectDevice, ppiToPxPerMM, APPLE_PPI };
}

init();
