<!--
DRAFT — DO NOT PUBLISH AS-IS.
- Replace [DEMO VIDEO LINK] with the live recording (see CAPTURE-WALKTHROUGH.md).
- Review and edit in your own voice before posting. This draft was prepared
  with AI assistance (allowed by the challenge) and needs your pass.
- Publish on DEV with the #presagechallenge tag. One entry per participant.
-->

---
title: TeachAid Calm Check — a study companion that paces itself to your breathing
published: false
tags: presagechallenge
---

# TeachAid Calm Check — a study companion that paces itself to your breathing

I build TeachAid, a teacher that meets every learner where they are. The
problem I keep running into: the teacher talks at one speed, and the learner
does not learn at one speed. Somebody stuck on a hard paragraph breathes
faster, rushes, and falls further behind — and the teacher never notices.

Calm Check is my answer to that. It is a study companion page that reads the
learner's breathing rate and HRV from their webcam with the Presage
SmartSpectra SDK, and paces the lesson to what it sees: slower and simpler
when breathing quickens, moving on when the learner is settled.

## What I Built

A short TeachAid-style lesson — "How photosynthesis works", three concepts,
sourced from OpenStax Biology 2e Ch. 8 — that adapts in real time:

- **Breathing quickens (18+ breaths/min, or HRV RMSSD below 60% of your own
  baseline):** the teacher slows down, switches to a one-line simple version
  of the concept, and offers a 60-second guided breathing break. Offered,
  never forced.
- **Calm and settled:** the teacher keeps full pace and suggests the next
  concept.
- **Warming up:** breathing reads in about 30 seconds, HRV in about 60.
  Until confidence arrives, the teacher waits. It never guesses from a cold
  signal.

The pace logic has a 5-second hysteresis, so the teacher never flickers
between states. The lesson content is real TeachAid material; the adaptation
layer is new.

## Demo

[DEMO VIDEO LINK — replace with the live recording before publishing. See CAPTURE-WALKTHROUGH.md for the shot list.]

A demo-mode walkthrough (simulated signal, labelled DEMO in-video) is in the
repo as `demo-mode-walkthrough.mp4`. The video above is the live recording:
real camera, real signals, LIVE badge on screen throughout.

## How It Responds to Human Signals

| SmartSpectra signal | What it drives |
|---|---|
| Breathing rate (`breathing.rate`, 30-s avg) | Pace state; the teacher slows and simplifies when breathing quickens |
| Breathing waveform (`breathing.upperTrace`) | Live trace on screen; the breathing-break pacer |
| Pulse rate (`cardio.pulseRate`, 12-s avg) | Live tile |
| HRV RMSSD (`cardio.hrv[].rmssd`, 60-s window) | Compared only against the learner's own baseline; a drop counts as a stress signal |
| HRV stability (`cardio.hrv[].stable`) | Shown in the HRV tile |

The stack is a Node server plus a web page. The page captures the camera
with `getUserMedia`, draws frames to a 640×360 canvas, and sends RGB frames
over a local WebSocket to the server, which feeds them to
`@smartspectra/node-sdk` (v3.5.0) with `useCustomInput()` / `sendFrame()`
and streams the decoded metrics back at 2 Hz. Requested metrics are exactly
the documented bundles: `breathingMetrics` + `cardioMetrics`. No login, no
accounts, no cookies.

## Consent and Data Handling

- **Consent first.** Nothing starts before the on-screen consent step. The
  camera switches off immediately on Stop.
- **Video never leaves the machine.** Frames are processed in memory on the
  local server and never recorded, uploaded, or stored. No video file is
  ever written.
- **No health claims.** This is not a medical device. SmartSpectra metrics
  are offered for general wellness and informational purposes only, have not
  been cleared by the FDA, and may not be used for medical diagnosis or
  treatment. Nothing in the app diagnoses, treats, or scores health — the
  signals set study pace only.
- **Telemetry off.** The SDK's optional session-summary telemetry is
  explicitly disabled (`enableTelemetry: false`), so no session summary,
  diagnostic report, video, or vitals value leaves the machine.
- **Nothing retained.** The only numbers kept are the pace timeline shown in
  the session summary, held in the page's memory and cleared on Stop.
- **No covert monitoring.** The camera preview is always visible while
  measuring, labelled "local only, never recorded."

## Prize Categories

**Best Thoughtful Real-World Use** — and eligible for overall. This is the
honest fit: a real classroom need (a teacher that notices when a learner is
struggling), consent-forward by design, and built on the signals the SDK
actually measures.

## Code

https://github.com/ceedot-rock/presage-calm-check

Setup: `npm install`, put your free Presage key in `.env`
(`PRESAGE_API_KEY`, from physiology.presagetech.com), `npm start`, open
http://127.0.0.1:3000. No key? `npm run demo` runs the whole flow on a
clearly labelled simulated signal. `npm test` verifies the server, the
metrics flow, and the pace transitions.

*Built with AI coding assistance; reviewed, tested, and verified by me. The
live demo video is my own recording.*
