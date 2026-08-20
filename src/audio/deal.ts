/**
 * Cards do not play music. They write constraints into a process
 * that is already running.
 */

import {
  RATIOS, ROOT, SUITS,
  type BusOp, type Card, type MajorCard, type MinorCard,
} from "../deck/cards";
import { audio, DEF, driveCurve, hold, restAim, type Slot } from "./graph";

export const RISE = 6.0;   // seconds for a card to arrive
// A reading sustains. Nothing decays on a timer; it ends when cleared.

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Least-recently-freed slot, retired with a short fade so nothing clicks. */
export function takeSlot(t: number): number {
  const { slots, busy } = audio();
  let idx = 0, best = Infinity;
  for (let i = 0; i < slots.length; i++) if (busy[i] < best) { best = busy[i]; idx = i; }
  if (best > t - 0.5) {
    const s = slots[idx];
    s.amp.gain.cancelScheduledValues(t);
    s.amp.gain.setTargetAtTime(0.0001, t, 0.45);
  }
  busy[idx] = t + 1e6;   // held until the reading is cleared
  return idx;
}

/**
 * Write every derived voice value from the slot's own base and the standing
 * aims. Called when a card is dealt and again, at its own scheduled time, by
 * every major that bends one of those aims.
 */
export function restate(s: Slot, t: number, tau = 2): void {
  const { aim } = audio();
  const b = s.base, twist = aim.spin * aim.wobble;
  s.tone.gain.setTargetAtTime(clamp(b.tone + aim.tone, -20, 8), t, tau);
  s.lfo.frequency.setTargetAtTime(clamp(b.rate * aim.stretch, 0.012, 9), t, tau);
  s.send.gain.setTargetAtTime(clamp(b.wet + aim.wet, 0, 0.9), t, tau);
  s.lfoF.gain.setTargetAtTime(b.lfoF * twist, t, tau);
  s.lfoP.gain.setTargetAtTime(b.lfoP * twist, t, tau);
  s.lfoA.gain.setTargetAtTime(b.lfoA * twist, t, tau);
  s.modG.gain.setTargetAtTime(b.mod * aim.mod, t, tau);
}

export function dealVoice(slot: Slot, card: MinorCard, t: number): void {
  const s = SUITS[card.suit];
  const r = (card.rank - 1) / 13;
  const freq = ROOT * RATIOS[(card.rank - 1) % 7] *
    Math.pow(2, s.oct + Math.floor((card.rank - 1) / 7));
  const rate = lerp(s.rate[0], s.rate[1], r);
  const depth = lerp(0.22, 1, r);

  slot.carrier.type = s.wave;
  slot.carrier.frequency.setValueAtTime(freq, t);
  slot.carrier.detune.setValueAtTime((Math.random() * 2 - 1) * 9 * s.drift, t);
  slot.mod.frequency.setValueAtTime(freq * s.fm, t);

  slot.shaper.curve = driveCurve(Math.max(0.0001, s.drive * depth));
  slot.filt.type = s.ftype;
  slot.filt.Q.setValueAtTime(s.q, t);
  slot.filt.frequency.setTargetAtTime(s.fbase * lerp(0.6, 1.9, r), t, 4);
  if (slot.pan) slot.pan.pan.setTargetAtTime((Math.random() * 2 - 1) * 0.62, t, 5);
  slot.lfo.type = s.lfoWave;

  // every destination stays wired; the ones this suit does not use sit at zero,
  // so a card never re-patches a running modulator. Reversal is a sign flip.
  slot.base = {
    tone: s.tone,
    rate,
    wet: s.wet,
    mod: freq * s.fmIndex * depth,
    lfoF: s.lfoTo === "filter" ? s.fbase * 0.75 * depth * s.lfoAmt * card.sign : 0,
    lfoP: s.lfoTo === "pitch" ? freq * 0.012 * depth * s.lfoAmt * card.sign : 0,
    lfoA: s.lfoTo === "amp" ? 0.085 * depth * s.lfoAmt * s.level * card.sign : 0,
  };
  slot.lfo.frequency.cancelScheduledValues(t);
  slot.lfo.frequency.setValueAtTime(clamp(rate * audio().aim.stretch, 0.012, 9), t);
  restate(slot, t, 3);

  slot.amp.gain.cancelScheduledValues(t);
  slot.amp.gain.setTargetAtTime(lerp(0.22, 0.13, r) * s.level, t, RISE / 3);

  card.rate = rate;
}

// ── majors ──────────────────────────────────────────────────────
//
// A major is one operation on the whole graph. Two things were keeping that
// from being heard: the moves settled over time constants longer than the card
// stayed alone on the table, and nothing marked the instant they were applied.
// So every gesture below lands inside the card's own rise, and each one strikes
// the graph once as it takes hold.

interface MarkSpec {
  p: number;      // partial the strike sits on
  r: number;      // its ring
  band: number;   // where the transient's noise is focused
  noise: number;
  peak: number;
  decay: number;
}

const MARKS: Record<BusOp, MarkSpec> = {
  brighten:  { p: 8,   r: 12,   band: 3200, noise: 0.05, peak: 0.13, decay: 1.6 },
  darken:    { p: 2,   r: 3,    band: 520,  noise: 0.04, peak: 0.15, decay: 2.4 },
  space:     { p: 6,   r: 9,    band: 2000, noise: 0.05, peak: 0.12, decay: 2.2 },
  warm:      { p: 3,   r: 4.5,  band: 900,  noise: 0.06, peak: 0.13, decay: 2.6 },
  anchor:    { p: 1,   r: 2,    band: 320,  noise: 0.05, peak: 0.19, decay: 3.2 },
  consonate: { p: 4,   r: 6,    band: 1600, noise: 0.02, peak: 0.12, decay: 2.8 },
  drive:     { p: 4,   r: 5,    band: 1800, noise: 0.07, peak: 0.14, decay: 1.4 },
  invert:    { p: 5,   r: 7.5,  band: 1500, noise: 0.06, peak: 0.13, decay: 1.2 },
  stretch:   { p: 3,   r: 4,    band: 1100, noise: 0.04, peak: 0.12, decay: 2.4 },
  morph:     { p: 2.5, r: 3.75, band: 800,  noise: 0.04, peak: 0.13, decay: 3.0 },
  devil:     { p: 2,   r: 2.83, band: 700,  noise: 0.09, peak: 0.17, decay: 2.6 },
  crash:     { p: 1.5, r: 2.12, band: 1200, noise: 0.22, peak: 0.25, decay: 3.6 },
  judge:     { p: 8,   r: 12,   band: 3600, noise: 0.08, peak: 0.19, decay: 3.4 },
};

/** Strike the graph. Gated from silence out of nodes that have run since unlock. */
export function strike(op: BusOp, sign: number, t: number): void {
  const { mark } = audio();
  const m = MARKS[op];
  const oct = sign < 0 ? 0.5 : 1;                 // a reversed major reads lower
  const atk = 0.012;

  mark.tone.frequency.setValueAtTime(ROOT * m.p * oct, t);
  mark.ring.frequency.setValueAtTime(ROOT * m.r * oct, t);
  mark.noiseF.frequency.setValueAtTime(m.band * oct, t);

  const env = (g: AudioParam, peak: number): void => {
    hold(g, t);
    g.linearRampToValueAtTime(peak, t + atk);
    g.setTargetAtTime(0, t + atk, m.decay / 3.2);
  };
  env(mark.toneG.gain, m.peak);
  env(mark.ringG.gain, m.peak * 0.45);
  env(mark.noiseG.gain, m.noise);
}

export function applyBus(card: MajorCard, t: number): void {
  const g = audio();
  const { mFilt, fb, dFilt, bedFilt, bedOscs, hissG, bedBus, subG, delay, slots, aim } = g;
  const F = mFilt.frequency, now = t;

  strike(card.op, card.sign, now);

  /** Aim a bus parameter somewhere and remember where, so majors compose. */
  const toFilt = (hz: number, tau: number): void => {
    aim.mFilt = clamp(hz, 420, 12000);
    hold(F, now);
    F.setTargetAtTime(aim.mFilt, now, tau);
  };
  const toFb = (v: number, tau: number): void => {
    aim.fb = clamp(v, 0, 0.86);
    hold(fb.gain, now);
    fb.gain.setTargetAtTime(aim.fb, now, tau);
  };
  /** Every voice restates itself from its own card plus the new aims. */
  const voices = (tau = 2): void => slots.forEach((s) => restate(s, now, tau));

  switch (card.op) {
    case "brighten":
      toFilt(aim.mFilt * 1.9, 1.4);
      aim.tone += 4;
      voices();
      break;

    case "darken":
      toFilt(aim.mFilt * 0.34, 1.4);
      aim.tone -= 4;
      voices();
      break;

    case "space":
      hold(delay.delayTime, now);
      delay.delayTime.setTargetAtTime(DEF.delay * (card.sign > 0 ? 1.5 : 0.5), now, 2.5);
      toFb(aim.fb + 0.18, 1.6);
      dFilt.frequency.setTargetAtTime(4200, now, 2);
      aim.wet += 0.24;
      voices();
      break;

    case "warm":
      toFilt(2600, 1.8);
      hissG.gain.setTargetAtTime(0.2, now, 2);
      bedBus.gain.setTargetAtTime(aim.bedBus * 1.25, now, 2);
      aim.tone -= 3;
      voices(2.5);
      break;

    case "anchor":
      bedFilt.frequency.setTargetAtTime(Math.max(90, aim.bedFilt * 0.55), now, 2.5);
      bedBus.gain.setTargetAtTime(aim.bedBus * 1.45, now, 2);
      subG.gain.setTargetAtTime(0.38, now, 2.5);          // the floor drops
      break;

    case "consonate":
      // everything that was bending stops bending: no detune, no index, no wobble
      bedOscs.forEach((b) => b.o.detune.setTargetAtTime(0, now, 2.5));
      slots.forEach((s) => s.carrier.detune.setTargetAtTime(0, now, 2.5));
      hissG.gain.setTargetAtTime(0.03, now, 2.5);
      aim.mod = 0.05;
      aim.wobble = 0.12;
      voices(2.2);
      break;

    case "drive":
      toFb(0.66, 1.6);
      toFilt(aim.mFilt * 0.8, 2);
      aim.mod *= 2.4;                    // grit as harmonics, not as a new curve
      aim.wobble = Math.min(2, aim.wobble * 1.3);
      voices(1.6);
      break;

    case "invert":
      aim.spin = aim.spin > 0 ? -1 : 1;
      voices(1.2);
      slots.forEach((s) => {
        if (s.pan) s.pan.pan.setTargetAtTime(-s.pan.pan.value, now, 1.5);
      });
      hold(F, now);                       // a lurch, so the turn is felt
      F.linearRampToValueAtTime(aim.mFilt * 0.45, now + 0.28);
      F.setTargetAtTime(aim.mFilt, now + 0.3, 0.9);
      break;

    case "stretch":
      aim.stretch = clamp(aim.stretch * (card.sign > 0 ? 0.35 : 2.6), 0.04, 14);
      voices(1.6);
      break;

    case "morph": {
      const k = Math.pow(2, (card.sign > 0 ? -3 : 4) / 12);
      bedOscs.forEach((b) => b.o.frequency.setTargetAtTime(ROOT * b.mult * k, now, 3.5));
      subG.gain.setTargetAtTime(0.22, now, 3);
      break;
    }

    case "devil":
      toFilt(aim.mFilt * 0.42, 1.6);
      toFb(0.7, 1.6);
      bedOscs.forEach((b) => b.o.detune.setTargetAtTime((Math.random() * 2 - 1) * 34, now, 2));
      aim.mod *= 1.9;
      voices(2);
      break;

    case "crash":   // remove the constraint that was holding it stable
      hold(fb.gain, now);
      fb.gain.linearRampToValueAtTime(0.9, now + 0.9);
      fb.gain.setTargetAtTime(0.46, now + 4, 4);
      aim.fb = 0.46;
      hold(F, now);
      F.linearRampToValueAtTime(430, now + 0.8);
      F.setTargetAtTime(DEF.mFilt, now + 2, 2.5);
      aim.mFilt = DEF.mFilt;
      bedOscs.forEach((b) => b.o.detune.setTargetAtTime((Math.random() * 2 - 1) * 60, now, 1));
      bedFilt.frequency.setTargetAtTime(520, now, 1);
      bedFilt.frequency.setTargetAtTime(aim.bedFilt, now + 5, 4);
      aim.wet = Math.min(0.5, aim.wet + 0.2);
      voices(3);
      break;

    case "judge":
      hold(F, now);
      F.linearRampToValueAtTime(11000, now + 3);
      aim.mFilt = 11000;
      bedBus.gain.setTargetAtTime(aim.bedBus * 0.45, now, 2);
      dFilt.frequency.setTargetAtTime(5200, now, 2.5);
      aim.tone += 3;
      voices(2.5);
      break;
  }
}

/**
 * The bed retreats downward as the spread fills, rather than being buried.
 * This runs before the cards are dealt and records where it left the bed, so a
 * major that moves the bed moves it from there instead of being overwritten by
 * a spread-wide setting scheduled at the same instant.
 */
export function carve(n: number, t: number): void {
  const { bedBus, bedFilt, voiceBus, aim } = audio();
  aim.bedBus = Math.max(0.34, 1 - 0.062 * n);
  aim.bedFilt = Math.max(95, DEF.bedFilt - 15 * n);
  bedBus.gain.setTargetAtTime(aim.bedBus, t, 8);
  bedFilt.frequency.setTargetAtTime(aim.bedFilt, t, 9);
  voiceBus.gain.setTargetAtTime(n > 5 ? 0.78 : 1, t, 6);
}

/** Deal a whole spread in one pass on the audio clock. Never setTimeout. */
export function dealCard(card: Card, t: number): number {
  if (card.scope === "voice") {
    const idx = takeSlot(t);
    dealVoice(audio().slots[idx], card, t);
    return idx;
  }
  applyBus(card, t);
  card.rate = 0.14;
  return -1;
}

/** Fade the voices and walk every bus parameter back to rest. */
export function releaseAll(): number {
  const g = audio();
  const t = g.ctx.currentTime;

  g.slots.forEach((s) => {
    s.amp.gain.cancelScheduledValues(t);
    s.amp.gain.setTargetAtTime(0.0001, t, 0.85);
    [s.lfoF, s.lfoP, s.lfoA].forEach((n) => {
      n.gain.cancelScheduledValues(t);
      n.gain.setTargetAtTime(0, t, 0.85);
    });
    s.send.gain.cancelScheduledValues(t);
    s.send.gain.setTargetAtTime(0, t, 1.6);        // the tail outlives the source
    s.focus.gain.setTargetAtTime(1, t, 0.4);
    s.tone.gain.cancelScheduledValues(t);
    s.tone.gain.setTargetAtTime(0, t, 1.2);
    s.modG.gain.cancelScheduledValues(t);
    s.modG.gain.setTargetAtTime(0, t, 1.2);
    s.carrier.detune.cancelScheduledValues(t);
    s.base = { tone: 0, rate: 0.1, wet: 0, lfoF: 0, lfoP: 0, lfoA: 0, mod: 0 };
  });
  g.busy.fill(0);

  [g.mark.toneG, g.mark.ringG, g.mark.noiseG].forEach((n) => {
    n.gain.cancelScheduledValues(t);
    n.gain.setTargetAtTime(0, t, 0.5);
  });

  g.mFilt.frequency.cancelScheduledValues(t);
  g.mFilt.frequency.setTargetAtTime(DEF.mFilt, t, 3);
  g.fb.gain.cancelScheduledValues(t);
  g.fb.gain.setTargetAtTime(DEF.fb, t, 3);
  Object.assign(g.aim, restAim());
  g.delay.delayTime.cancelScheduledValues(t);
  g.delay.delayTime.setTargetAtTime(DEF.delay, t, 4);
  g.dFilt.frequency.setTargetAtTime(DEF.dFilt, t, 3);
  g.bedOscs.forEach((b) => {
    b.o.frequency.cancelScheduledValues(t);
    b.o.frequency.setTargetAtTime(ROOT * b.mult, t, 5);
    b.o.detune.cancelScheduledValues(t);
    b.o.detune.setTargetAtTime(0, t, 4);
  });
  g.bedFilt.frequency.cancelScheduledValues(t);
  g.bedFilt.frequency.setTargetAtTime(DEF.bedFilt, t, 4);
  g.bedBus.gain.setTargetAtTime(DEF.bedBus, t, 4);
  g.subG.gain.setTargetAtTime(DEF.sub, t, 3);
  g.hissG.gain.setTargetAtTime(DEF.hiss, t, 4);
  g.voiceBus.gain.setTargetAtTime(DEF.voiceBus, t, 3);

  return t;
}

/**
 * Inspecting a card lifts its voice and ducks the others. A major has no voice
 * of its own, so inspecting one clears the table and strikes its operation again.
 */
export function focusCard(card: Card, slotIdx: number): void {
  const g = audio();
  const t = g.ctx.currentTime;
  if (card.scope === "bus") {
    g.slots.forEach((s) => s.focus.gain.setTargetAtTime(0.42, t, 0.5));
    strike(card.op, card.sign, t + 0.06);
    return;
  }
  g.slots.forEach((s, i) => s.focus.gain.setTargetAtTime(i === slotIdx ? 1.7 : 0.4, t, 0.5));
}

export function unfocusVoices(): void {
  const g = audio();
  const t = g.ctx.currentTime;
  g.slots.forEach((s) => s.focus.gain.setTargetAtTime(1, t, 0.6));
}
