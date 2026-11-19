// server.js — TeachAid Calm Check
//
// Serves the study-companion page on http://127.0.0.1:3000 and bridges
// camera frames to the Presage SmartSpectra SDK.
//
// LIVE mode (PRESAGE_API_KEY set in .env or environment):
//   browser --getUserMedia--> page --RGB frames over WebSocket--> this
//   server --useCustomInput/sendFrame--> @smartspectra/node-sdk
//   --decoded metrics--> page. All processing is on this machine.
//   SDK telemetry is explicitly DISABLED (enableTelemetry: false), so
//   nothing — no video, no vitals, no session summary — leaves the machine.
//
// DEMO mode (no key, or --demo): the server generates a clearly labelled
// simulated signal (src/demo-signal.js, source: 'demo') so the UI, pace
// classifier, and teacher adaptation can be exercised without a camera.
//
// No login, no accounts, no storage: frames live in memory only and are
// never written to disk. The server binds localhost only.

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { PaceTracker, PACE } from './public/pace.js';
import { DemoSignal } from './src/demo-signal.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 3000);
const HOST = '127.0.0.1';

// ---- tiny .env loader (no dependency) ------------------------------------
for (const line of (await fs.readFile(path.join(__dirname, '.env'), 'utf8').catch(() => '')).split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}

const API_KEY = (process.env.PRESAGE_API_KEY || '').trim();
const FORCE_DEMO = process.argv.includes('--demo');
const MODE = !FORCE_DEMO && API_KEY ? 'live' : 'demo';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

// ---- static file server ----------------------------------------------------
const server = http.createServer(async (req, res) => {
  try {
    let urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (urlPath === '/') urlPath = '/index.html';
    const filePath = path.join(PUBLIC_DIR, urlPath);
    if (!filePath.startsWith(PUBLIC_DIR)) throw Object.assign(new Error('bad path'), { code: 403 });
    const data = await fs.readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  } catch (err) {
    res.writeHead(err.code === 403 ? 403 : 404, { 'Content-Type': 'text/plain' });
    res.end(err.code === 403 ? 'forbidden' : 'not found');
  }
});

const wss = new WebSocketServer({ server });

// ---- live SmartSpectra engine ---------------------------------------------
// Imported lazily so demo mode never loads the native runtime.
let sdkModule = null;
async function loadSdk() {
  if (!sdkModule) sdkModule = await import('@smartspectra/node-sdk');
  return sdkModule;
}

class LiveEngine {
  constructor(send) {
    this.send = send;
    this.sdk = null;
    this.trace = [];
    this.lastBroadcast = 0;
    this.frameCount = 0;
    this.metricsSeen = false;
    this.watchdog = null;
  }

  async start() {
    const {
      SmartSpectraSDK, breathingMetrics, cardioMetrics, decodeMetrics,
      FrameTransform, PixelFormat,
    } = await loadSdk();
    this.decodeMetrics = decodeMetrics;
    this.PixelFormat = PixelFormat;
    this.sdk = new SmartSpectraSDK({
      apiKey: API_KEY,
      requestedMetrics: [...breathingMetrics, ...cardioMetrics],
      enableTelemetry: false, // nothing leaves this machine
    });
    this.sdk.on('metrics', (buf) => this.onMetrics(buf));
    this.sdk.on('validationStatus', (code, ts, hint) =>
      this.send({ type: 'hint', code: String(code), hint: hint || '' }));
    this.sdk.on('processingStatus', (status) =>
      this.send({ type: 'status', status: String(status) }));
    this.sdk.on('error', (code, message, retryable) =>
      this.send({ type: 'sdk-error', code: String(code), message: String(message), retryable: !!retryable }));
    this.sdk.useCustomInput(FrameTransform.kNone);
    this.sdk.start();
    // Auth failures surface only as native-log retries, not as an error
    // event, so watch for the first metrics packet: if none arrives in
    // 25 s the key or camera is wrong — say so instead of warming up forever.
    this.watchdog = setTimeout(() => {
      if (!this.metricsSeen) {
        this.send({
          type: 'sdk-error',
          code: 'no-signal',
          message: 'No signal arrived in 25 seconds. Check the Presage API key and camera, or switch to the demo.',
          retryable: false,
        });
      }
    }, 25000);
  }

  onMetrics(buf) {
    this.metricsSeen = true;
    if (this.watchdog) { clearTimeout(this.watchdog); this.watchdog = null; }
    let metrics;
    try {
      metrics = this.decodeMetrics(buf);
    } catch {
      return;
    }
    if (Buffer.isBuffer(metrics)) return;
    const last = (arr) => (Array.isArray(arr) && arr.length ? arr.at(-1) : null);
    const br = last(metrics.breathing?.rate);
    const upper = last(metrics.breathing?.upperTrace);
    const pulse = last(metrics.cardio?.pulseRate);
    const hrv = last(metrics.cardio?.hrv);
    if (upper) {
      this.trace.push(upper.value);
      if (this.trace.length > 100) this.trace.shift();
    }
    const now = Date.now();
    if (now - this.lastBroadcast < 500) return; // broadcast at 2 Hz
    this.lastBroadcast = now;
    this.send({
      type: 'metrics',
      source: 'live',
      t: now,
      breathingRate: br?.value ?? null,
      breathingConfidence: br?.confidence ?? 0,
      breathingTrace: [...this.trace],
      traceHz: 10,
      pulseRate: pulse?.value ?? null,
      pulseConfidence: pulse?.confidence ?? 0,
      hrvRmssd: hrv?.rmssd ?? null,
      hrvConfidence: hrv?.confidence ?? 0,
      hrvStable: hrv?.stable ?? false,
      baevsky: hrv?.baevsky ?? null,
    });
  }

  sendFrame(rgb, width, height) {
    if (!this.sdk) return;
    // Monotonic timestamp (µs), as the SDK requires.
    const tsUs = Number(process.hrtime.bigint() / 1000n);
    this.sdk.sendFrame(rgb, width, height, width * 3, this.PixelFormat.kRGB, tsUs);
    this.frameCount += 1;
  }

  async stop() {
    if (this.watchdog) { clearTimeout(this.watchdog); this.watchdog = null; }
    if (!this.sdk) return;
    try { await this.sdk.stopAsync(); } catch { /* already stopped */ }
    try { this.sdk.destroy(); } catch { /* already destroyed */ }
    this.sdk = null;
  }
}

// ---- per-connection session -------------------------------------------------
wss.on('connection', (ws) => {
  const tracker = new PaceTracker();
  const sessionStart = Date.now();
  const send = (obj) => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); };

  let engine = null; // LiveEngine in live mode
  let demo = null; // DemoSignal in demo mode
  let demoTimer = null;
  let mode = MODE;

  const broadcastPace = (payload) => {
    const prev = tracker.state;
    const state = tracker.update(
      {
        breathingRate: payload.breathingRate,
        breathingConfidence: payload.breathingConfidence,
        hrvRmssd: payload.hrvRmssd,
        hrvConfidence: payload.hrvConfidence,
      },
      Date.now() - sessionStart,
    );
    send({ ...payload, pace: state, paceChanged: state !== prev });
  };

  const startDemo = () => {
    mode = 'demo';
    demo = new DemoSignal({ scenario: 'focused' });
    clearInterval(demoTimer);
    let ticks = 0;
    // Advance the simulation at 10 Hz; broadcast at 2 Hz like the live path.
    demoTimer = setInterval(() => {
      const payload = demo.tick(100);
      ticks += 1;
      if (ticks % 5 === 0) broadcastPace(payload);
    }, 100);
    send({ type: 'mode', mode: 'demo', note: 'Simulated signal — no camera, no key. Scenario buttons drive the pace.' });
  };

  const startLive = async () => {
    mode = 'live';
    engine = new LiveEngine((obj) => {
      if (obj.type === 'metrics') broadcastPace(obj);
      else send(obj);
    });
    try {
      await engine.start();
      send({ type: 'mode', mode: 'live', note: 'Live SmartSpectra signal. Telemetry off; frames stay on this machine.' });
    } catch (err) {
      send({ type: 'sdk-error', code: 'start-failed', message: String(err?.message || err), retryable: false });
    }
  };

  send({ type: 'hello', mode: MODE, liveAvailable: MODE === 'live' });

  ws.on('message', async (data, isBinary) => {
    if (isBinary) {
      // Binary message = one RGB frame: first 8 bytes are width/height (uint32 LE), rest is RGB.
      if (mode !== 'live' || !engine) return;
      const width = data.readUInt32LE(0);
      const height = data.readUInt32LE(4);
      const rgb = data.subarray(8);
      if (rgb.length === width * height * 3) engine.sendFrame(rgb, width, height);
      return;
    }
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    if (msg.type === 'start-live') await startLive();
    if (msg.type === 'start-demo') startDemo();
    if (msg.type === 'scenario' && demo) demo.setScenario(msg.value);
    if (msg.type === 'stop') {
      clearInterval(demoTimer);
      if (engine) await engine.stop();
      engine = null;
      demo = null;
    }
  });

  ws.on('close', async () => {
    clearInterval(demoTimer);
    if (engine) await engine.stop();
  });
});

server.listen(PORT, HOST, () => {
  console.log(`TeachAid Calm Check listening on http://${HOST}:${PORT}`);
  console.log(`Mode: ${MODE}${MODE === 'demo' ? ' (no PRESAGE_API_KEY set — simulated signal; set the key in .env for live mode)' : ' (live SmartSpectra, telemetry off)'}`);
  console.log('Open the URL above, consent on screen, and start a session.');
});
