# Live demo video — capture walkthrough

The build machine has no camera, so the live-signals recording has to be
shot on a laptop with a webcam. This is the exact shot list. Total
recording time: about 3 minutes. Nothing here is faked: every number on
screen is a real SmartSpectra reading.

## Before you record

1. **API key.** Create a free account at https://physiology.presagetech.com
   and copy the key into `.env` as `PRESAGE_API_KEY`. Never paste the key
   anywhere on screen.
2. **Setup.** `git clone https://github.com/ceedot-rock/presage-calm-check.git`,
   `npm install`, `npm start`, open http://127.0.0.1:3000.
3. **Lighting and framing.** Sit facing a window or a lamp. Face and upper
   chest in view, plain background. Avoid dark clothing and tight stripes
   (both confuse the breathing signal). Laptop on a stable desk — not
   handheld. Do not talk while measuring; talking breaks the breathing
   reading.
4. **Recorder.** OBS (screen capture of the browser window) is best — it
   shows the tiles, the trace, and the teacher panel. A phone on a tripod
   filming the screen works too. Check afterwards that no key or password
   is visible anywhere in the frame.

## Shot list

| # | What to do | What the viewer should see | ~Time |
|---|---|---|---|
| 1 | Show the consent screen, read the first line aloud, click "I consent — start with my camera" and allow the camera. | Consent text; LIVE badge appears; camera preview turns on. | 0:00–0:20 |
| 2 | Sit still, face and chest in view, breathing normally. Say nothing. | Tiles fill in; "Warming up" while confidence climbs; breathing rate appears at ~30 s, HRV at ~60 s. The teacher waits. | 0:20–1:30 |
| 3 | Keep sitting calmly. | Pace commits to Calm or Focused; teacher shows the standard explanation; click "Next concept". | 1:30–1:50 |
| 4 | Stand up off-camera, do 20 jumping jacks, sit back down. Keep still. | Breathing rate climbs past 18/min; pace commits to "Pace easing"; the teacher switches to the one-line simple version and offers a breathing break. | 1:50–2:30 |
| 5 | Click "Take a breathing break" and follow the circle for ~30 s, then "Back to the lesson". | The 60-second break overlay with the animated circle. | 2:30–3:00 |
| 6 | Sit still and breathe normally until the pace settles back to Calm. Click "Stop session". | Pace returns to Calm; session summary appears with pace times. | 3:00–3:30 |

## After recording

- Watch it once through: confirm the LIVE badge (not DEMO) is visible
  throughout, the breathing trace moves, and no key is on screen.
- Upload it: either attach the file directly to the DEV post (DEV supports
  video upload) or post it as an unlisted YouTube video and link it.
- Replace the `[DEMO VIDEO LINK]` placeholder in `dev-post-draft.md` with
  the real link before publishing the post.
- The repo already contains `demo-mode-walkthrough.mp4` (44 s, simulated
  signal, labelled DEMO in-video). Do not submit that as the live demo —
  it is a walkthrough of the flow only.
