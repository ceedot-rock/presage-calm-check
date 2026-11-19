// app.js — TeachAid Calm Check client.
//
// Flow: consent screen -> (live: camera frames to the server over
// WebSocket; demo: simulated signal) -> live tiles + teacher adaptation.
// Video frames are processed in memory on the local server only. Nothing
// is recorded, uploaded, or stored.

import { PACE, describeState } from './pace.js';

// --- lesson content: short TeachAid-style mini-lesson -----------------------
const LESSON = [
  {
    title: '1 · What photosynthesis does',
    standard:
      'Photosynthesis is how green plants turn sunlight, water, and carbon dioxide into glucose and oxygen. ' +
      'The glucose is stored energy the plant uses to grow; the oxygen is released into the air.',
    simple: 'Plants use sunlight to make their own food — and release oxygen.',
  },
  {
    title: '2 · Where it happens',
    standard:
      'It happens mostly in the leaves, inside tiny structures called chloroplasts. Chlorophyll, the green pigment, ' +
      'catches sunlight. Water arrives from the roots, and carbon dioxide enters through tiny pores called stomata.',
    simple: 'It happens in the leaves, where a green pigment catches sunlight.',
  },
  {
    title: '3 · Why it matters',
    standard:
      'Nearly all life on Earth runs on photosynthesis, directly or indirectly. It produces the oxygen we breathe ' +
      'and sits at the base of almost every food chain — including the plants and animals we eat.',
    simple: 'It makes the oxygen we breathe and feeds nearly every food chain.',
  },
];
const LESSON_SOURCE = 'Source: OpenStax Biology 2e, Chapter 8 — Photosynthesis';

// --- DOM --------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const consentEl = $('consent');
const sessionEl = $('session');
const modeBadge = $('mode-badge');
const sourceBadge = $('source-badge');
const btnLive = $('btn-live');
const btnDemo = $('btn-demo');
const liveUnavailable = $('live-unavailable');
const preview = $('preview');
const traceCanvas = $('trace');
const hintEl = $('hint');
const demoControls = $('demo-controls');

// --- state ------------------------------------------------------------------
const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
let serverMode = 'demo';
let liveAvailable = false;
let running = false;
let stream = null;
let frameTimer = null;
let conceptIndex = 0;
let paceState = PACE.WARMING;
let paceCounts = { warming: 0, calm: 0, focused: 0, stressed: 0 };
let lastPaceSampleAt = 0;
let sessionStartedAt = null;
let lastMetrics = null;

// --- helpers ----------------------------------------------------------------
function confLabel(c) {
  if (c == null) return 'no reading yet';
  if (c < 0.5) return `confidence ${c.toFixed(2)} — still warming up`;
  return `confidence ${c.toFixed(2)}`;
}

function drawTrace(values) {
  const ctx = traceCanvas.getContext('2d');
  const w = traceCanvas.width;
  const h = traceCanvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = '#dfe4ee';
  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  ctx.stroke();
  if (!values || values.length < 2) return;
  ctx.strokeStyle = '#2456d6';
  ctx.lineWidth = 2;
  ctx.beginPath();
  values.forEach((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h / 2 - v * (h / 2 - 8);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function renderConcept() {
  const c = LESSON[conceptIndex];
  $('concept-title').textContent = c.title;
  $('lesson-pos').textContent = `Concept ${conceptIndex + 1} of ${LESSON.length}`;
  $('concept-source').textContent = LESSON_SOURCE;
  // Stressed pace reads the simple version; anything else reads standard.
  $('concept-body').textContent = paceState === PACE.STRESSED ? c.simple : c.standard;
  $('btn-next').disabled = conceptIndex >= LESSON.length - 1;
  $('btn-next').textContent =
    conceptIndex >= LESSON.length - 1 ? 'Lesson complete' : 'Next concept';
}

function renderTeacherNote() {
  const { label, teacher } = describeState(paceState);
  const paceEl = $('t-pace');
  paceEl.textContent = label;
  paceEl.className = 'value pace ' + (paceState === PACE.CALM ? 'calm' : paceState === PACE.STRESSED ? 'stressed' : '');
  $('t-pace-note').textContent = '';
  $('teacher-note').textContent = teacher;
  if (paceState === PACE.STRESSED) renderConcept(); // auto-simplify
  if (paceState === PACE.CALM && conceptIndex < LESSON.length - 1) {
    $('teacher-note').textContent += ' Ready for the next concept when you are.';
  }
}

function renderMetrics(m) {
  lastMetrics = m;
  $('t-breath').textContent = m.breathingRate != null ? m.breathingRate.toFixed(1) : '—';
  $('c-breath').textContent = confLabel(m.breathingConfidence);
  $('t-pulse').textContent = m.pulseRate != null ? Math.round(m.pulseRate) : '—';
  $('c-pulse').textContent = confLabel(m.pulseConfidence);
  $('t-hrv').textContent = m.hrvRmssd != null ? m.hrvRmssd.toFixed(0) : '—';
  $('c-hrv').textContent =
    m.hrvConfidence != null && m.hrvConfidence >= 0.5
      ? `confidence ${m.hrvConfidence.toFixed(2)} · ${m.hrvStable ? 'steady' : 'unsteady'}`
      : confLabel(m.hrvConfidence);
  drawTrace(m.breathingTrace);
  sourceBadge.textContent = m.source === 'live' ? 'LIVE · SmartSpectra' : 'DEMO · simulated signal';
  sourceBadge.className = 'badge small ' + (m.source === 'live' ? 'live' : 'demo');
  $('warmup-note').textContent =
    m.source === 'live'
      ? 'Breathing reads in about 30 seconds, HRV in about 60. Until then the teacher waits — it never guesses from a cold signal.'
      : 'Demo signal: confidence ramps in a few seconds so the flow is visible (live: breathing ~30 s, HRV ~60 s). Until then the teacher waits — it never guesses from a cold signal.';

  // Count pace time for the session summary (samples arrive at ~2 Hz).
  const now = Date.now();
  if (lastPaceSampleAt && m.pace) paceCounts[m.pace] = (paceCounts[m.pace] || 0) + (now - lastPaceSampleAt);
  lastPaceSampleAt = now;

  if (m.pace && m.pace !== paceState) {
    paceState = m.pace;
    renderTeacherNote();
  }
}

// --- camera (live mode) -------------------------------------------------------
async function startCamera() {
  stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  preview.srcObject = stream;
  const off = document.createElement('canvas');
  off.width = 640;
  off.height = 360;
  const ctx = off.getContext('2d', { willReadFrequently: true });
  frameTimer = setInterval(() => {
    if (!stream || ws.readyState !== 1) return;
    const vw = preview.videoWidth;
    const vh = preview.videoHeight;
    if (!vw || !vh) return;
    ctx.drawImage(preview, 0, 0, 640, 360);
    const img = ctx.getImageData(0, 0, 640, 360).data;
    const rgb = new Uint8Array(8 + 640 * 360 * 3);
    const view = new DataView(rgb.buffer);
    view.setUint32(0, 640, true);
    view.setUint32(4, 360, true);
    for (let i = 0, j = 8; i < img.length; i += 4, j += 3) {
      rgb[j] = img[i];
      rgb[j + 1] = img[i + 1];
      rgb[j + 2] = img[i + 2];
    }
    ws.send(rgb);
  }, 100); // 10 fps
}

function stopCamera() {
  clearInterval(frameTimer);
  frameTimer = null;
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  preview.srcObject = null;
}

// --- session control ----------------------------------------------------------
function beginSession(mode) {
  running = true;
  sessionStartedAt = Date.now();
  paceState = PACE.WARMING;
  paceCounts = { warming: 0, calm: 0, focused: 0, stressed: 0 };
  conceptIndex = 0;
  consentEl.classList.add('hidden');
  sessionEl.classList.remove('hidden');
  demoControls.classList.toggle('hidden', mode !== 'demo');
  $('summary').classList.add('hidden');
  renderConcept();
  renderTeacherNote();
  ws.send(JSON.stringify({ type: mode === 'live' ? 'start-live' : 'start-demo' }));
}

async function endSession() {
  running = false;
  stopCamera();
  if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'stop' }));
  const secs = Math.round((Date.now() - sessionStartedAt) / 1000);
  const fmt = (ms) => `${Math.round(ms / 1000)}s`;
  $('summary-body').textContent =
    `Session length ${secs}s. Pace time — warming ${fmt(paceCounts.warming || 0)}, ` +
    `calm ${fmt(paceCounts.calm || 0)}, focused ${fmt(paceCounts.focused || 0)}, ` +
    `eased ${fmt(paceCounts.stressed || 0)}. ` +
    `The camera is off. Nothing was recorded or stored.`;
  $('summary').classList.remove('hidden');
  sessionEl.classList.add('hidden');
  consentEl.classList.remove('hidden');
}

// --- breathing break ------------------------------------------------------------
let breakTimer = null;
function startBreak() {
  $('break-overlay').classList.remove('hidden');
  const circle = $('breath-circle');
  const phaseEl = $('breath-phase');
  const countEl = $('breath-count');
  const phases = [
    ['Breathe in…', 'scale(1.45)'],
    ['Hold…', 'scale(1.45)'],
    ['Breathe out…', 'scale(1)'],
    ['Hold…', 'scale(1)'],
  ];
  let i = 0;
  const started = Date.now();
  const step = () => {
    const elapsed = Math.floor((Date.now() - started) / 1000);
    if (elapsed >= 60) return endBreak();
    const [label, scale] = phases[i % 4];
    phaseEl.textContent = label;
    circle.style.transform = scale;
    countEl.textContent = `${elapsed}s of 60s`;
    i += 1;
    breakTimer = setTimeout(step, 4000);
  };
  step();
}
function endBreak() {
  clearTimeout(breakTimer);
  $('break-overlay').classList.add('hidden');
}

// --- websocket ------------------------------------------------------------------
ws.addEventListener('open', () => {
  // Hello arrives first; buttons enable from it.
});
ws.addEventListener('message', (ev) => {
  let msg;
  try { msg = JSON.parse(ev.data); } catch { return; }
  if (msg.type === 'hello') {
    serverMode = msg.mode;
    liveAvailable = msg.liveAvailable;
    modeBadge.textContent = serverMode === 'live' ? 'LIVE mode ready' : 'DEMO mode (no key)';
    modeBadge.className = 'badge ' + serverMode;
    btnLive.disabled = !liveAvailable;
    liveUnavailable.classList.toggle('hidden', liveAvailable);
    return;
  }
  if (msg.type === 'metrics') { renderMetrics(msg); return; }
  if (msg.type === 'hint' && msg.hint) {
    hintEl.textContent = msg.hint;
    hintEl.classList.remove('hidden');
    return;
  }
  if (msg.type === 'sdk-error') {
    hintEl.textContent = `SmartSpectra error (${msg.code}): ${msg.message}. You can switch to the demo — no camera, simulated signal.`;
    hintEl.classList.remove('hidden');
    $('btn-to-demo').classList.remove('hidden');
    return;
  }
});
ws.addEventListener('close', () => {
  if (running) {
    hintEl.textContent = 'Connection to the local server dropped. Refresh the page to restart.';
    hintEl.classList.remove('hidden');
  }
});

// --- wiring -----------------------------------------------------------------------
btnLive.addEventListener('click', async () => {
  try {
    beginSession('live');
    await startCamera();
  } catch (err) {
    hintEl.textContent = `Could not start the camera: ${err.message}. Check the browser permission and try again, or use the demo.`;
    hintEl.classList.remove('hidden');
    sessionEl.classList.add('hidden');
    consentEl.classList.remove('hidden');
  }
});
btnDemo.addEventListener('click', () => beginSession('demo'));
$('btn-stop').addEventListener('click', endSession);
$('btn-to-demo').addEventListener('click', () => {
  stopCamera();
  if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'stop' }));
  $('btn-to-demo').classList.add('hidden');
  hintEl.classList.add('hidden');
  beginSession('demo');
});
$('btn-next').addEventListener('click', () => {
  if (conceptIndex < LESSON.length - 1) {
    conceptIndex += 1;
    renderConcept();
  }
});
$('btn-break').addEventListener('click', startBreak);
$('btn-end-break').addEventListener('click', endBreak);
document.querySelectorAll('[data-scenario]').forEach((b) =>
  b.addEventListener('click', () => {
    if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'scenario', value: b.dataset.scenario }));
  }),
);

renderConcept();
