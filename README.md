# TeachAid Calm Check

A study companion page that paces its teaching to the learner's breathing rate and HRV, read live from a webcam by the [Presage SmartSpectra SDK](https://smartspectra.presagetech.com/).

Built for the [Presage SmartSpectra SDK Challenge](https://dev.clauneck.workers.dev/challenges/presage-2026-11-04?bb=264834) (DEV, Nov 4–22, 2026). Entered in **Best Thoughtful Real-World Use** (and eligible for overall).

## What it does

A short TeachAid-style lesson — "How photosynthesis works", three concepts, sourced from OpenStax Biology 2e Ch. 8 — adapts in real time to the learner's camera-measured signals:

| SmartSpectra signal | What it drives |
|---|---|
| Breathing rate (`breathing.rate`, 30-s avg) | Pace state; the teacher slows and simplifies when breathing quickens |
| Breathing waveform (`breathing.upperTrace`) | Live trace on screen; the breathing-break pacer |
| Pulse rate (`cardio.pulseRate`, 12-s avg) | Live tile |
| HRV RMSSD (`cardio.hrv[].rmssd`, 60-s window) | Compared only against the learner's own baseline; a drop counts as a stress signal |
| HRV stability (`cardio.hrv[].stable`) | Shown in the HRV tile |

Pace states (study-pace only, never health states): **warming** (confidence 0 until ~30 s breathing / ~60 s HRV — the teacher waits, never guesses) → **calm** (settled breathing, teacher advances) → **focused** (steady pace) → **stressed** (breathing ≥ 18/min, or RMSSD below 60% of the learner's own baseline — teacher slows, switches to the one-line simple version, and offers a 60-second guided breathing break, never forced). State changes commit only after 5 seconds of consistent signal, so the teacher never flickers.

## Architecture

```
browser page --getUserMedia--> canvas 640x360 RGB frames, 10 fps
   --WebSocket (localhost)-->
Node server --useCustomInput / sendFrame--> @smartspectra/node-sdk (v3.5.0)
   --decoded metrics (2 Hz)--> page
```

- `server.js` — static file server + WebSocket bridge + SmartSpectra live engine + demo engine. Binds `127.0.0.1` only. No login, no accounts.
- `public/app.js` — camera capture, metrics rendering, lesson + breathing-break UI.
- `public/pace.js` — the pace classifier. Pure functions, shared by the browser UI and the Node server/test suite (one copy, one logic).
- `src/demo-signal.js` — simulated signal for demo mode (same payload shape as live, tagged `source: 'demo'`).

Requested metrics are exactly the documented bundles: `breathingMetrics` (chest breathing, abdomen breathing, breathing rate) + `cardioMetrics` (pulse rate, arterial pressure trace, HRV). No unavailable metric is requested (requesting one makes `start()` fail).

## Setup

```bash
npm install
```

### Live mode (real camera signals)

1. Get a free API key at the Presage Developer Portal: https://physiology.presagetech.com
2. Copy `.env.example` to `.env` and set `PRESAGE_API_KEY`.
3. `npm start` and open http://127.0.0.1:3000
4. Consent on screen, allow the camera, sit still with face and chest in view, well lit. Breathing reads in ~30 s, HRV in ~60 s.

### Demo mode (no key, no camera)

```bash
npm start          # no key set -> demo mode, with a clear banner
# or
npm run demo       # forces demo mode even if a key is set
```

Demo mode runs the whole flow on a clearly labelled simulated signal. The Calm / Focused / Stressed buttons drive the scenario so the teacher adaptation is visible without a camera. The demo confidence ramp is compressed (full confidence at ~6 s breathing / ~12 s HRV, vs ~30 s / ~60 s live) so a short recording shows the full flow; the UI labels this.

### Troubleshooting

- **Invalid key:** the SDK retries auth in its native layer and logs `Usage verification failed` instead of raising an error event. The app watches for the first metrics packet — if none arrives in 25 s it tells you to check the key/camera or switch to the demo. Check `PRESAGE_API_KEY` in `.env`.
- **No camera on the build machine:** live mode needs a real camera. Use demo mode (`npm run demo`) to verify the full flow without one.

### Verify

```bash
npm test
```

Starts the real server in demo mode, checks the page serves, opens a WebSocket, and verifies the metrics flow plus pace transitions (stressed → calm). Exits 0 on pass.

## Consent and data handling

- **Explicit consent first.** Nothing starts before the on-screen consent step. The camera switches off immediately on Stop.
- **Video never leaves the machine.** Frames are processed in memory on the local server and never recorded, uploaded, or stored. No video file is ever written.
- **No health claims.** This is not a medical device. SmartSpectra metrics are offered for general wellness and informational purposes only, have not been cleared by the FDA, and may not be used for medical diagnosis or treatment. The app makes no diagnosis, treatment, or medical-decision claim anywhere.
- **Telemetry off.** The SDK's optional session-summary telemetry is explicitly disabled (`enableTelemetry: false`), so no session summary, diagnostic report, video, or vitals value leaves the machine.
- **Nothing retained.** The only numbers kept are the pace timeline shown in the session summary, held in the page's memory and cleared on Stop. No account, no login, no cookies.
- **No covert monitoring.** The camera preview is always visible while measuring, with a "local only, never recorded" label.

## Demo video

The demo video for the DEV post is recorded by the author on a laptop with a real camera (the build machine has no camera). See [CAPTURE-WALKTHROUGH.md](CAPTURE-WALKTHROUGH.md) for the exact shot list. A demo-mode screen recording is included in the repo as `demo-mode-walkthrough.mp4` (simulated signal, labelled in-video).

## License

MIT. See [LICENSE](LICENSE).
