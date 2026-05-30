/* ===========================================================================
   TrueRule — an accurate on-screen ruler.

   The whole thing runs off ONE number: pxPerMM (CSS pixels per millimeter).
   - On first load we guess it from the CSS reference of 96px = 1 inch. That is
     usable but not physically exact on most phones.
   - Calibration measures the device's true pxPerMM by matching a bank card
     (ISO/IEC 7810 ID-1: exactly 85.6 x 53.98 mm everywhere in the world) and
     saves it to localStorage, so it's a one-time step per device.
   =========================================================================== */

'use strict';

const MM_PER_INCH = 25.4;
const DEFAULT_PX_PER_MM = 96 / MM_PER_INCH; // ≈ 3.7795, the CSS reference
const CARD_LONG_MM = 85.6;                  // card long edge (the precise one)
const CARD_SHORT_MM = 53.98;                // card short edge
const STORE_SCALE = 'truerule.pxPerMM';
const STORE_UNIT = 'truerule.unit';
const STORE_HINT = 'truerule.hintSeen';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const state = {
  pxPerMM: DEFAULT_PX_PER_MM,
  unit: 'in',           // 'in' | 'cm'
  A: { x: 0, y: 0 },    // measure point A (CSS px)
  B: { x: 0, y: 0 },    // measure point B (CSS px)
};

let w = 0, h = 0, dpr = 1;
let handlesPlaced = false;
const canvas = document.getElementById('ruler');
const ctx = canvas.getContext('2d');
const darkMQ = window.matchMedia('(prefers-color-scheme: dark)');

/* ---------- persistence ---------- */
function load() {
  const s = parseFloat(localStorage.getItem(STORE_SCALE));
  if (s && isFinite(s) && s > 0.5 && s < 60) state.pxPerMM = s;
  const u = localStorage.getItem(STORE_UNIT);
  if (u === 'in' || u === 'cm') state.unit = u;
}
function saveScale() { localStorage.setItem(STORE_SCALE, String(state.pxPerMM)); }
function saveUnit() { localStorage.setItem(STORE_UNIT, state.unit); }

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

  // Seed the handles once, but only after the viewport has real dimensions
  // (a 0x0 first layout would otherwise pin them to the corner forever).
  if (!handlesPlaced && w > 0 && h > 0) {
    state.A = { x: Math.round(w * 0.60), y: Math.round(h * 0.28) };
    state.B = { x: Math.round(w * 0.60), y: Math.round(h * 0.60) };
    handlesPlaced = true;
  }
  if (handlesPlaced) {
    for (const k of ['A', 'B']) {
      state[k].x = clamp(state[k].x, 10, w - 10);
      state[k].y = clamp(state[k].y, 10, h - 10);
    }
    placeHandle('A'); placeHandle('B');
  }
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
  if (state.unit === 'in') {
    const inch = mm / MM_PER_INCH;
    return '↔ ' + inch.toFixed(2) + '″ · ' + inchFraction(inch);
  }
  return '↔ ' + (mm / 10).toFixed(2) + ' cm · ' + mm.toFixed(0) + ' mm';
}

/* ---------- drawing ---------- */
function draw() {
  const dark = darkMQ.matches;
  const ink = dark ? '#eef0f5' : '#14151a';
  const faint = dark ? 'rgba(238,240,245,0.55)' : 'rgba(20,21,26,0.55)';
  const accent = '#2563eb';

  ctx.clearRect(0, 0, w, h);

  // crisp horizontal tick at y
  const tick = (len, y, lw, color) => {
    const yy = (Math.round(y * dpr) + 0.5) / dpr;
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(0, yy);
    ctx.lineTo(len, yy);
    ctx.stroke();
  };

  // left baseline (the measuring edge, 0 at the top)
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2;
  const x0 = (Math.round(0 * dpr) + 1) / dpr;
  ctx.beginPath(); ctx.moveTo(x0, 0); ctx.lineTo(x0, h); ctx.stroke();

  ctx.fillStyle = ink;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';

  const pxmm = state.pxPerMM;
  if (state.unit === 'in') {
    const step = (pxmm * MM_PER_INCH) / 16; // 1/16" ticks
    let i = 0;
    for (let y = 0; y <= h + 1; y += step, i++) {
      if (i % 16 === 0) {
        tick(78, y, 2, ink);
        if (i > 0) {
          ctx.font = '600 17px system-ui, sans-serif';
          ctx.fillText(String(i / 16), 86, y);
        }
      } else if (i % 8 === 0) tick(50, y, 1.5, ink);
      else if (i % 4 === 0) tick(36, y, 1.2, faint);
      else if (i % 2 === 0) tick(26, y, 1, faint);
      else tick(16, y, 1, faint);
    }
  } else {
    const step = pxmm; // 1 mm ticks
    let i = 0;
    for (let y = 0; y <= h + 1; y += step, i++) {
      if (i % 10 === 0) {
        tick(78, y, 2, ink);
        if (i > 0) {
          ctx.font = '600 17px system-ui, sans-serif';
          ctx.fillText(String(i / 10), 86, y);
        }
      } else if (i % 5 === 0) tick(46, y, 1.5, ink);
      else tick(24, y, 1, faint);
    }
  }

  // unit tag at the top of the ruler
  ctx.font = '700 13px system-ui, sans-serif';
  ctx.fillStyle = faint;
  ctx.fillText(state.unit === 'in' ? 'INCHES' : 'CM', 8, 14);

  drawMeasure(accent);
}

function drawMeasure(accent) {
  const { A, B } = state;
  const distPx = Math.hypot(B.x - A.x, B.y - A.y);
  const mm = distPx / state.pxPerMM;

  // connecting line
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2.5;
  ctx.setLineDash([2, 6]);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(A.x, A.y);
  ctx.lineTo(B.x, B.y);
  ctx.stroke();
  ctx.setLineDash([]);

  // endpoint dots
  for (const p of [A, B]) {
    ctx.fillStyle = accent;
    ctx.beginPath(); ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2); ctx.fill();
  }

  // value pill at the midpoint
  const label = pillText(mm);
  ctx.font = '700 15px system-ui, sans-serif';
  const tw = ctx.measureText(label).width;
  const pad = 11, pw = tw + pad * 2, ph = 30;
  let px = (A.x + B.x) / 2 - pw / 2;
  let py = (A.y + B.y) / 2 - ph / 2;
  px = clamp(px, 6, w - pw - 6);
  py = clamp(py, 6, h - ph - 6);
  ctx.fillStyle = accent;
  if (ctx.roundRect) {
    ctx.beginPath(); ctx.roundRect(px, py, pw, ph, 15); ctx.fill();
  } else {
    ctx.fillRect(px, py, pw, ph);
  }
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, px + pw / 2, py + ph / 2 + 0.5);
  ctx.textAlign = 'left';

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
function makeDraggable(key) {
  const el = document.getElementById('handle' + key);
  el.addEventListener('pointerdown', (e) => {
    try { el.setPointerCapture(e.pointerId); } catch (_) {}
    el.classList.add('drag');
    e.preventDefault();
  });
  el.addEventListener('pointermove', (e) => {
    if (!el.hasPointerCapture(e.pointerId)) return;
    state[key].x = clamp(e.clientX, 6, w - 6);
    state[key].y = clamp(e.clientY, 6, h - 6);
    placeHandle(key);
    drawSoon();
  });
  const end = (e) => { el.classList.remove('drag'); try { el.releasePointerCapture(e.pointerId); } catch (_) {} };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  // keyboard nudge (desktop accessibility)
  el.addEventListener('keydown', (e) => {
    const d = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowLeft') state[key].x -= d;
    else if (e.key === 'ArrowRight') state[key].x += d;
    else if (e.key === 'ArrowUp') state[key].y -= d;
    else if (e.key === 'ArrowDown') state[key].y += d;
    else return;
    e.preventDefault();
    state[key].x = clamp(state[key].x, 6, w - 6);
    state[key].y = clamp(state[key].y, 6, h - 6);
    placeHandle(key); drawSoon();
  });
}

/* ---------- units ---------- */
function setUnit(u) {
  state.unit = u;
  document.getElementById('unitLabel').textContent = u === 'in' ? 'inches' : 'cm';
  saveUnit();
  draw();
}

/* ---------- calibration ---------- */
let calPxPerMM = DEFAULT_PX_PER_MM;
let calTop = 80;
const calEl = document.getElementById('cal');
const calCard = document.getElementById('calCard');

function calBounds() {
  calTop = Math.max(56, Math.round(h * 0.09));
  const minPxPerMM = 2.2;
  const maxPxPerMM = Math.max(minPxPerMM + 1, Math.min(
    (h - calTop - 250) / CARD_LONG_MM, // must fit above the panel
    (w * 0.96) / CARD_SHORT_MM          // must fit across the screen
  ));
  return { minPxPerMM, maxPxPerMM };
}
function calRender() {
  const { minPxPerMM, maxPxPerMM } = calBounds();
  calPxPerMM = clamp(calPxPerMM, minPxPerMM, maxPxPerMM);
  calCard.style.top = calTop + 'px';
  calCard.style.height = (CARD_LONG_MM * calPxPerMM) + 'px';
  calCard.style.width = (CARD_SHORT_MM * calPxPerMM) + 'px';
  const ppi = Math.round(calPxPerMM * MM_PER_INCH * dpr);
  document.getElementById('calInfo').textContent =
    '≈ ' + ppi + ' PPI  ·  ' + calPxPerMM.toFixed(2) + ' px/mm';
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
  const heightPx = CARD_LONG_MM * calPxPerMM + deltaPx;
  calPxPerMM = heightPx / CARD_LONG_MM;
  calRender();
}
function wireCalibration() {
  document.getElementById('calBtn').addEventListener('click', openCal);
  document.getElementById('calCancel').addEventListener('click', closeCal);
  document.getElementById('calReset').addEventListener('click', () => {
    calPxPerMM = DEFAULT_PX_PER_MM; calRender();
  });
  document.getElementById('calSave').addEventListener('click', () => {
    state.pxPerMM = calPxPerMM;
    saveScale();
    closeCal();
    draw();
  });
  document.getElementById('calMinus').addEventListener('click', () => calNudge(-1));
  document.getElementById('calPlus').addEventListener('click', () => calNudge(+1));

  const resize = document.getElementById('calResize');
  resize.addEventListener('pointerdown', (e) => {
    try { resize.setPointerCapture(e.pointerId); } catch (_) {}
    e.preventDefault();
  });
  resize.addEventListener('pointermove', (e) => {
    if (!resize.hasPointerCapture(e.pointerId)) return;
    const { minPxPerMM, maxPxPerMM } = calBounds();
    const heightPx = clamp(e.clientY - calTop, CARD_LONG_MM * minPxPerMM, CARD_LONG_MM * maxPxPerMM);
    calPxPerMM = heightPx / CARD_LONG_MM;
    calRender();
  });
  const stop = (e) => { try { resize.releasePointerCapture(e.pointerId); } catch (_) {} };
  resize.addEventListener('pointerup', stop);
  resize.addEventListener('pointercancel', stop);
}

/* ---------- lock down zoom / scroll ---------- */
function lockGestures() {
  // iOS pinch-zoom (Safari ignores user-scalable=no)
  for (const t of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(t, (e) => e.preventDefault(), { passive: false });
  }
  // double-tap zoom
  let last = 0;
  document.addEventListener('touchend', (e) => {
    const now = e.timeStamp;
    if (now - last <= 320 && e.cancelable) e.preventDefault();
    last = now;
  }, { passive: false });
  // desktop ctrl+wheel and ctrl/cmd +/-/0 zoom
  window.addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && ['+', '-', '=', '0'].includes(e.key)) e.preventDefault();
  });
  document.addEventListener('contextmenu', (e) => e.preventDefault());
}

/* ---------- init ---------- */
function init() {
  load();
  setUnit(state.unit);
  document.getElementById('unitBtn').addEventListener('click', () => {
    setUnit(state.unit === 'in' ? 'cm' : 'in');
  });
  makeDraggable('A');
  makeDraggable('B');
  wireCalibration();
  lockGestures();

  // one-time tip
  if (!localStorage.getItem(STORE_HINT)) {
    const hint = document.getElementById('hint');
    hint.classList.remove('hidden');
    document.getElementById('hintClose').addEventListener('click', () => {
      hint.classList.add('hidden');
      localStorage.setItem(STORE_HINT, '1');
    });
  }

  resize();
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 60));
  darkMQ.addEventListener?.('change', draw);
}

init();
