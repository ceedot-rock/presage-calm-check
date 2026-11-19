// demo-signal.js — clearly labelled SIMULATED signal for TeachAid Calm Check.
//
// Used only when no Presage API key is set (or when the user picks the demo
// explicitly). It produces the same slim metrics shape as the live
// SmartSpectra path so the UI, pace classifier, and teacher adaptation can
// be exercised and verified without a camera or a key.
//
// Every payload this generates is tagged source: 'demo', the UI shows a
// permanent DEMO badge, and the scenario buttons (calm / focused /
// stressed) are user-driven — nothing here pretends to be a real reading.

const SCENARIOS = {
  calm: { breathingRate: 11, pulseRate: 62, hrvRmssd: 55, baevsky: 0.8, stable: true },
  focused: { breathingRate: 15, pulseRate: 72, hrvRmssd: 42, baevsky: 1.4, stable: true },
  stressed: { breathingRate: 21, pulseRate: 88, hrvRmssd: 24, baevsky: 2.6, stable: false },
};

export class DemoSignal {
  constructor({ scenario = 'focused' } = {}) {
    this.scenario = SCENARIOS[scenario] ? scenario : 'focused';
    this.startedAt = Date.now();
    this.phase = 0; // breathing-trace phase, radians
    this.trace = []; // last 100 trace samples at 10 Hz = 10 s window
  }

  setScenario(name) {
    if (SCENARIOS[name]) this.scenario = name;
    return this.scenario;
  }

  /** Advance the simulation by dtMs and return one slim metrics payload. */
  tick(dtMs = 100) {
    const target = SCENARIOS[this.scenario];
    const elapsedS = (Date.now() - this.startedAt) / 1000;

    // Slow drift so the numbers look alive instead of frozen.
    const wobble = Math.sin(elapsedS / 9) * 0.8;
    const breathingRate = Math.max(5, target.breathingRate + wobble);
    const pulseRate = Math.round(target.pulseRate + Math.sin(elapsedS / 7) * 2);
    const hrvRmssd = Math.max(8, target.hrvRmssd + Math.sin(elapsedS / 11) * 3);

    // Breathing trace: sine at the current rate, sampled at 10 Hz.
    this.phase += (2 * Math.PI * breathingRate) / 60 * (dtMs / 1000);
    const traceValue = Math.sin(this.phase);
    this.trace.push(traceValue);
    if (this.trace.length > 100) this.trace.shift();

    // Confidence ramps mirror the real SDK warm-up: breathing 0 until
    // ~30 s, HRV 0 until ~60 s. In demo mode we compress the ramp so the
    // flow is demonstrable in a short recording: full confidence at 6 s
    // (breathing) and 12 s (HRV). The ramp is labelled in the UI.
    const breathingConfidence = Math.min(0.92, elapsedS / 6);
    const hrvConfidence = Math.min(0.9, Math.max(0, (elapsedS - 2) / 10));

    return {
      type: 'metrics',
      source: 'demo',
      t: Date.now(),
      breathingRate: Number(breathingRate.toFixed(1)),
      breathingConfidence: Number(breathingConfidence.toFixed(2)),
      breathingTrace: [...this.trace],
      traceHz: 10,
      pulseRate,
      pulseConfidence: Number(Math.min(0.93, elapsedS / 5).toFixed(2)),
      hrvRmssd: Number(hrvRmssd.toFixed(1)),
      hrvConfidence: Number(hrvConfidence.toFixed(2)),
      hrvStable: target.stable,
      baevsky: Number(target.baevsky.toFixed(2)),
    };
  }
}
