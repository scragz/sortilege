/**
 * Cards do not play music. They write constraints into a process
 * that is already running.
 */

import {
  RATIOS, ROOT, SUITS,
  type Card, type MajorCard, type MinorCard,
} from "../deck/cards";
import { audio, DEF, driveCurve, type Slot } from "./graph";

export const RISE = 6.0;   // seconds for a card to arrive
// A reading sustains. Nothing decays on a timer; it ends when cleared.

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

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
  slot.modG.gain.setTargetAtTime(freq * 0.42 * depth * (s.fm > 1 ? 1 : 0.2), t, 3);

  slot.shaper.curve = driveCurve(Math.max(0.0001, s.drive * depth));
  slot.filt.type = s.ftype;
  slot.filt.Q.setValueAtTime(s.q, t);
  slot.filt.frequency.setTargetAtTime(s.fbase * lerp(0.6, 1.9, r), t, 4);
  if (slot.pan) slot.pan.pan.setTargetAtTime((Math.random() * 2 - 1) * 0.62, t, 5);

  slot.lfo.type = s.lfoWave;
  slot.lfo.frequency.setValueAtTime(rate, t);
  slot.lfoG.disconnect();
  let amt: number;
  if (s.lfoTo === "filter") { amt = s.fbase * 0.75 * depth; slot.lfoG.connect(slot.filt.frequency); }
  else if (s.lfoTo === "pitch") { amt = freq * 0.012 * depth; slot.lfoG.connect(slot.carrier.frequency); }
  else { amt = 0.085 * depth; slot.lfoG.connect(slot.amp.gain); }
  slot.lfoG.gain.setTargetAtTime(amt * card.sign, t, 3);   // reversal is a sign flip

  slot.send.gain.setTargetAtTime(s.wet, t, 3);
  slot.amp.gain.cancelScheduledValues(t);
  slot.amp.gain.setTargetAtTime(lerp(0.22, 0.13, r), t, RISE / 3);

  card.rate = rate;
}

export function applyBus(card: MajorCard, t: number): void {
  const { mFilt, fb, dFilt, bedFilt, bedOscs, hissG, bedBus, delay, slots } = audio();
  const F = mFilt.frequency, now = t;

  switch (card.op) {
    case "brighten":
      F.setTargetAtTime(Math.min(11000, F.value * 1.55), now, 7); break;
    case "darken":
      F.setTargetAtTime(Math.max(900, F.value * 0.55), now, 7); break;
    case "space":
      delay.delayTime.setTargetAtTime(DEF.delay * (card.sign > 0 ? 1.5 : 0.5), now, 9);
      fb.gain.setTargetAtTime(Math.min(0.72, fb.gain.value + 0.14), now, 6);
      dFilt.frequency.setTargetAtTime(3600, now, 8); break;
    case "warm":
      F.setTargetAtTime(3400, now, 9);
      hissG.gain.setTargetAtTime(0.16, now, 8); break;
    case "anchor":
      bedFilt.frequency.setTargetAtTime(180, now, 10);
      bedBus.gain.setTargetAtTime(1.25, now, 8); break;
    case "consonate":
      bedOscs.forEach((b) => b.o.detune.setTargetAtTime(0, now, 12)); break;
    case "drive":
      fb.gain.setTargetAtTime(0.58, now, 5); break;
    case "invert":
      slots.forEach((s) => s.lfoG.gain.setTargetAtTime(-s.lfoG.gain.value, now, 4)); break;
    case "stretch": {
      const m = card.sign > 0 ? 0.45 : 2.1;
      slots.forEach((s) => s.lfo.frequency.setTargetAtTime(
        Math.min(9, Math.max(0.012, s.lfo.frequency.value * m)), now, 6));
      break;
    }
    case "morph": {
      const k = Math.pow(2, (card.sign > 0 ? -3 : 4) / 12);
      bedOscs.forEach((b) => b.o.frequency.setTargetAtTime(ROOT * b.mult * k, now, 16)); break;
    }
    case "devil":
      F.setTargetAtTime(Math.max(700, F.value * 0.5), now, 6);
      fb.gain.setTargetAtTime(0.63, now, 5);
      bedOscs.forEach((b) => b.o.detune.setTargetAtTime((Math.random() * 2 - 1) * 26, now, 8)); break;
    case "crash":   // remove the constraint that was holding it stable
      fb.gain.setValueAtTime(fb.gain.value, now);
      fb.gain.linearRampToValueAtTime(0.93, now + 1.2);
      fb.gain.setTargetAtTime(0.40, now + 6, 10);
      F.setValueAtTime(F.value, now);
      F.linearRampToValueAtTime(520, now + 1.1);
      F.setTargetAtTime(DEF.mFilt, now + 3, 9);
      bedOscs.forEach((b) => b.o.detune.setTargetAtTime((Math.random() * 2 - 1) * 55, now, 2)); break;
    case "judge":
      F.linearRampToValueAtTime(10500, now + 5);
      bedBus.gain.setTargetAtTime(0.55, now, 4); break;
  }
}

/** The bed retreats downward as the spread fills, rather than being buried. */
export function carve(n: number, t: number): void {
  const { bedBus, bedFilt, voiceBus } = audio();
  bedBus.gain.setTargetAtTime(Math.max(0.34, 1 - 0.062 * n), t, 8);
  bedFilt.frequency.setTargetAtTime(Math.max(95, DEF.bedFilt - 15 * n), t, 9);
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
    s.lfoG.gain.cancelScheduledValues(t);
    s.lfoG.gain.setTargetAtTime(0, t, 0.85);
    s.send.gain.cancelScheduledValues(t);
    s.send.gain.setTargetAtTime(0, t, 1.6);        // the tail outlives the source
    s.focus.gain.setTargetAtTime(1, t, 0.4);
  });
  g.busy.fill(0);

  g.mFilt.frequency.cancelScheduledValues(t);
  g.mFilt.frequency.setTargetAtTime(DEF.mFilt, t, 3);
  g.fb.gain.cancelScheduledValues(t);
  g.fb.gain.setTargetAtTime(DEF.fb, t, 3);
  g.delay.delayTime.cancelScheduledValues(t);
  g.delay.delayTime.setTargetAtTime(DEF.delay, t, 4);
  g.dFilt.frequency.setTargetAtTime(DEF.dFilt, t, 3);
  g.bedOscs.forEach((b) => {
    b.o.frequency.cancelScheduledValues(t);
    b.o.frequency.setTargetAtTime(ROOT * b.mult, t, 5);
    b.o.detune.cancelScheduledValues(t);
    b.o.detune.setTargetAtTime(0, t, 4);
  });
  g.bedFilt.frequency.setTargetAtTime(DEF.bedFilt, t, 4);
  g.bedBus.gain.setTargetAtTime(DEF.bedBus, t, 4);
  g.hissG.gain.setTargetAtTime(DEF.hiss, t, 4);
  g.voiceBus.gain.setTargetAtTime(DEF.voiceBus, t, 3);

  return t;
}

/** Inspecting a card lifts its voice and ducks the others. */
export function focusVoice(slotIdx: number): void {
  const g = audio();
  const t = g.ctx.currentTime;
  g.slots.forEach((s, i) => s.focus.gain.setTargetAtTime(i === slotIdx ? 1.7 : 0.4, t, 0.5));
}

export function unfocusVoices(): void {
  const g = audio();
  const t = g.ctx.currentTime;
  g.slots.forEach((s) => s.focus.gain.setTargetAtTime(1, t, 0.6));
}
