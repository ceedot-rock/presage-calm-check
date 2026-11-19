// ws-demo-test.mjs — verifies TeachAid Calm Check end to end in demo mode.
// 1. pace.js classifier unit checks (same file the browser uses).
// 2. Starts the real server (no API key -> demo mode), fetches the page,
//    opens a WebSocket, starts a demo session, and checks the metrics flow
//    plus pace transitions (stressed -> calm) through the shared tracker.
// Run: npm test. Exits 0 on pass, 1 on any failure.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import { classifySample, PaceTracker, PACE } from '../public/pace.js';

const PORT = 3456;
const BASE = `http://127.0.0.1:${PORT}`;

// --- 1. classifier unit checks ------------------------------------------------
assert.equal(classifySample({ breathingRate: 12, breathingConfidence: 0 }, null), PACE.WARMING);
assert.equal(classifySample({ breathingRate: 21, breathingConfidence: 0.9 }, null), PACE.STRESSED);
assert.equal(classifySample({ breathingRate: 11, breathingConfidence: 0.9 }, null), PACE.CALM);
assert.equal(classifySample({ breathingRate: 16, breathingConfidence: 0.9 }, null), PACE.FOCUSED);
assert.equal(
  classifySample({ breathingRate: 12, breathingConfidence: 0.9, hrvRmssd: 15, hrvConfidence: 0.9 }, 40),
  PACE.STRESSED,
);
const tracker = new PaceTracker({ commitAfterMs: 100 });
tracker.update({ breathingRate: 21, breathingConfidence: 0.9 }, 0);
assert.equal(tracker.update({ breathingRate: 21, breathingConfidence: 0.9 }, 150), PACE.STRESSED);
console.log('classifier unit checks: pass');

// --- 2. server + websocket checks ---------------------------------------------
const server = spawn('node', ['server.js', '--demo'], {
  cwd: new URL('..', import.meta.url).pathname,
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error('FAIL:', msg); server.kill(); process.exit(1); };

try {
  // Wait for the page to serve.
  let page = '';
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(BASE + '/');
      if (res.status === 200) { page = await res.text(); break; }
    } catch { /* not up yet */ }
    await sleep(200);
  }
  if (!page.includes('TeachAid Calm Check')) fail('index page did not serve');
  if (!page.includes('Before we switch the camera on')) fail('consent screen missing');
  if (!page.includes('not a medical device')) fail('disclaimer missing');
  console.log('page serves (200, consent + disclaimer present): pass');

  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
  await new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject); });

  const seen = [];
  let hello = null;
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === 'hello') hello = msg;
    if (msg.type === 'metrics') seen.push(msg);
  });

  await sleep(500);
  if (!hello || hello.mode !== 'demo') fail(`hello not demo mode: ${JSON.stringify(hello)}`);
  console.log('hello mode=demo: pass');

  ws.send(JSON.stringify({ type: 'start-demo' }));
  await sleep(4000);
  if (!seen.length) fail('no metrics arrived in demo mode');
  const m = seen.at(-1);
  if (m.source !== 'demo') fail('metrics source is not demo');
  if (typeof m.breathingRate !== 'number' || typeof m.pulseRate !== 'number') fail('metrics missing rates');
  if (!Array.isArray(m.breathingTrace) || !m.breathingTrace.length) fail('metrics missing trace');
  if (!m.pace) fail('metrics missing pace');
  console.log(`demo metrics flow (${seen.length} samples, pace=${m.pace}): pass`);

  // Drive the pace: stressed, then calm. Commit hysteresis is 5 s.
  ws.send(JSON.stringify({ type: 'scenario', value: 'stressed' }));
  await sleep(9000);
  const stressed = seen.at(-1);
  if (stressed.pace !== 'stressed') fail(`pace did not reach stressed, got ${stressed.pace}`);
  console.log('pace -> stressed under stressed scenario: pass');

  ws.send(JSON.stringify({ type: 'scenario', value: 'calm' }));
  await sleep(9000);
  const calm = seen.at(-1);
  if (calm.pace !== 'calm') fail(`pace did not reach calm, got ${calm.pace}`);
  console.log('pace -> calm under calm scenario: pass');

  ws.send(JSON.stringify({ type: 'stop' }));
  ws.close();
  console.log('ALL CHECKS PASS');
} finally {
  server.kill();
}
process.exit(0);
