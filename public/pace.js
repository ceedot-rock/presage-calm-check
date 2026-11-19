// pace.js — study-pace classifier for TeachAid Calm Check.
// Pure functions, no DOM, no network. One copy, used by the browser UI
// (as an ES module) and by the Node server + test suite (same file).
//
// These are STUDY-PACE states, not health states. Breathing rate and HRV
// RMSSD are used only to decide how fast the teacher talks, whether to
// simplify the next explanation, and whether to offer a breathing break.
// Nothing here diagnoses, treats, scores, or makes claims about health.

export const PACE = {
  WARMING: 'warming',
  CALM: 'calm',
  FOCUSED: 'focused',
  STRESSED: 'stressed',
};

// RMSSD (ms) used as the personal baseline until enough confident HRV
// samples arrive to compute the learner's own median. It is a starting
// default only, and the UI labels it as such.
export const DEFAULT_BASELINE_RMSSD_MS = 40;

// Breathing-rate band treated as settled, in breaths per minute.
// At or above STRESS_BREATHING_BPM the teacher eases the pace.
export const CALM_BREATHING_MAX_BPM = 14;
export const STRESS_BREATHING_BPM = 18;

// RMSSD below this fraction of the personal baseline counts as a stress
// signal (together with breathing rate). RMSSD is compared only against
// the learner's own baseline, never against an absolute score.
export const STRESS_RMSSD_FRACTION = 0.6;

// A sample only counts as confident when the SDK reports confidence at
// or above this. Breathing confidence is 0 until ~30 s of signal; HRV
// confidence is 0 until ~60 s. Until then the state stays 'warming'.
export const CONFIDENCE_FLOOR = 0.5;

/**
 * Classify one metrics sample into a candidate pace state.
 * @param {object} s - { breathingRate, breathingConfidence, hrvRmssd, hrvConfidence }
 * @param {number|null} baselineRmssd - personal RMSSD baseline in ms, or null
 */
export function classifySample(s, baselineRmssd) {
  const br = s.breathingRate;
  const brConf = s.breathingConfidence ?? 0;
  if (br == null || brConf < CONFIDENCE_FLOOR) return PACE.WARMING;

  const hrvConf = s.hrvConfidence ?? 0;
  const hrv = s.hrvRmssd;
  const baseline = baselineRmssd ?? DEFAULT_BASELINE_RMSSD_MS;

  if (br >= STRESS_BREATHING_BPM) return PACE.STRESSED;
  if (hrv != null && hrvConf >= CONFIDENCE_FLOOR && hrv < STRESS_RMSSD_FRACTION * baseline) {
    return PACE.STRESSED;
  }
  if (br >= 6 && br <= CALM_BREATHING_MAX_BPM) return PACE.CALM;
  return PACE.FOCUSED;
}

/** Median of a numeric array (null when empty). */
export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Pace tracker: maintains the personal HRV baseline, applies hysteresis so
 * the teacher does not flicker between states, and records a timeline of
 * committed state changes for the session summary.
 */
export class PaceTracker {
  constructor({ commitAfterMs = 5000, baselineSamplesNeeded = 20 } = {}) {
    this.commitAfterMs = commitAfterMs;
    this.baselineSamplesNeeded = baselineSamplesNeeded;
    this.baselineRmssd = null;
    this._baselineSamples = [];
    this.state = PACE.WARMING;
    this._candidate = PACE.WARMING;
    this._candidateSince = 0;
    this.timeline = [{ t: 0, state: PACE.WARMING }];
    this.startedAt = Date.now();
  }

  /** Feed one slim metrics sample. `nowMs` is ms since session start. Returns the committed state. */
  update(sample, nowMs) {
    // Grow the personal HRV baseline from confident samples.
    if (
      this.baselineRmssd == null &&
      sample.hrvRmssd != null &&
      (sample.hrvConfidence ?? 0) >= CONFIDENCE_FLOOR
    ) {
      this._baselineSamples.push(sample.hrvRmssd);
      if (this._baselineSamples.length >= this.baselineSamplesNeeded) {
        this.baselineRmssd = median(this._baselineSamples);
      }
    }

    const candidate = classifySample(sample, this.baselineRmssd);
    if (candidate !== this._candidate) {
      this._candidate = candidate;
      this._candidateSince = nowMs;
    }
    if (candidate !== this.state && nowMs - this._candidateSince >= this.commitAfterMs) {
      this.state = candidate;
      this.timeline.push({ t: nowMs, state: candidate });
    }
    return this.state;
  }

  /** Effective baseline: personal median once known, else the starting default. */
  get baseline() {
    return this.baselineRmssd ?? DEFAULT_BASELINE_RMSSD_MS;
  }

  get baselineIsPersonal() {
    return this.baselineRmssd != null;
  }
}

/** UI copy for each pace state. Study-pace language only. */
export function describeState(state) {
  switch (state) {
    case PACE.WARMING:
      return {
        label: 'Warming up',
        teacher: 'Keep your face and chest in view and stay still — breathing reads in about 30 seconds, HRV in about 60.',
      };
    case PACE.CALM:
      return {
        label: 'Calm pace',
        teacher: 'You are settled, so the teacher keeps moving at full pace.',
      };
    case PACE.FOCUSED:
      return {
        label: 'Focused',
        teacher: 'Steady pace. The teacher keeps the standard explanation.',
      };
    case PACE.STRESSED:
      return {
        label: 'Pace easing',
        teacher: 'Your breathing quickened, so the teacher slowed down and simplified. A breathing break is offered — never forced.',
      };
    default:
      return { label: state, teacher: '' };
  }
}
