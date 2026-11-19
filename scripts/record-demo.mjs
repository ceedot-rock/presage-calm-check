// record-demo.mjs — records a demo-mode walkthrough of TeachAid Calm Check.
//
// Starts the real server in demo mode, drives the page in headless Chromium
// with video recording, and converts the capture to mp4 with ffmpeg.
// Output: demo-mode-walkthrough.mp4 in the repo root.
//
// The recording is DEMO MODE throughout (simulated signal, DEMO badges on
// screen). It is not a live-signal recording — see CAPTURE-WALKTHROUGH.md
// for the live recording shot list.
// Run: node scripts/record-demo.mjs

import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import { chromium } from 'playwright';

const PORT = 3000;
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn('node', ['server.js', '--demo'], {
  cwd: new URL('..', import.meta.url).pathname,
  env: { ...process.env, PORT: String(PORT) },
  stdio: 'ignore',
});

try {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(BASE + '/');
      if (res.status === 200) break;
    } catch { /* not up yet */ }
    await sleep(200);
  }

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    recordVideo: { dir: 'video-tmp', size: { width: 1280, height: 800 } },
  });
  const page = await context.newPage();
  await page.goto(BASE + '/');
  await sleep(1200);

  await page.click('#btn-demo'); // Try the demo — no camera
  await sleep(8000); // warming -> focused as confidence ramps

  await page.click('[data-scenario="stressed"]');
  await sleep(9000); // pace commits to stressed; teacher simplifies

  await page.click('#btn-break');
  await sleep(9000); // breathing-break circle animating
  await page.click('#btn-end-break');
  await sleep(1000);

  await page.click('[data-scenario="calm"]');
  await sleep(9000); // pace commits to calm

  await page.click('#btn-next');
  await sleep(2000);

  await page.click('#btn-stop'); // session summary
  await sleep(2000);

  await context.close();
  await browser.close();

  const [webm] = fs.readdirSync('video-tmp').filter((f) => f.endsWith('.webm'));
  if (!webm) throw new Error('no video file recorded');
  execSync(
    `ffmpeg -y -loglevel error -i video-tmp/${webm} -c:v libx264 -pix_fmt yuv420p -movflags +faststart demo-mode-walkthrough.mp4`,
    { stdio: 'inherit' },
  );
  fs.rmSync('video-tmp', { recursive: true, force: true });
  const stat = fs.statSync('demo-mode-walkthrough.mp4');
  console.log(`wrote demo-mode-walkthrough.mp4 (${(stat.size / 1e6).toFixed(1)} MB)`);
} finally {
  server.kill();
}
