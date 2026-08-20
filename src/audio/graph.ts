/**
 * One persistent graph. Every node is allocated at unlock and never again —
 * constructing a node mid-reading is what produces a click, and a click when
 * the Tower lands would break the premise.
 */

import { ROOT } from "../deck/cards";

export interface Slot {
  carrier: OscillatorNode;
  mod: OscillatorNode;
  modG: GainNode;
  shaper: WaveShaperNode;
  filt: BiquadFilterNode;
  pan: StereoPannerNode | null;
  amp: GainNode;
  focus: GainNode;          // inspecting a card lifts its voice above the rest
  lfo: OscillatorNode;
  lfoG: GainNode;
  send: GainNode;
}

export interface BedOsc {
  o: OscillatorNode;
  mult: number;
  gn: GainNode;
}

export interface Graph {
  ctx: AudioContext;
  mFilt: BiquadFilterNode;
  delay: DelayNode;
  fb: GainNode;
  dFilt: BiquadFilterNode;
  bedBus: GainNode;
  bedFilt: BiquadFilterNode;
  bedOscs: BedOsc[];
  hissG: GainNode;
  voiceBus: GainNode;
  slots: Slot[];
  busy: number[];
}

/** Resting values for every automatable bus parameter, so clear can restore them. */
export const DEF = {
  mFilt: 6200, fb: 0.42, delay: 0.664, dFilt: 2400,
  bedFilt: 260, bedBus: 1, hiss: 0.09, voiceBus: 1,
} as const;

export const SLOT_COUNT = 10;

let graph: Graph | null = null;

export function audio(): Graph {
  if (!graph) throw new Error("audio graph not initialised");
  return graph;
}

export const ready = (): boolean => graph !== null;

function noiseBuffer(ctx: AudioContext, secs = 4): AudioBuffer {
  const b = ctx.createBuffer(1, ctx.sampleRate * secs, ctx.sampleRate);
  const d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) {            // brownish noise
    last = (last + Math.random() * 0.04 - 0.02) * 0.997;
    d[i] = Math.max(-1, Math.min(1, last * 2.2));
  }
  return b;
}

function impulse(ctx: AudioContext, secs = 5.2, decay = 3.1): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * secs);
  const b = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return b;
}

export function driveCurve(amount: number): Float32Array<ArrayBuffer> {
  const n = 1024, c = new Float32Array(n), k = amount * 42;
  for (let i = 0; i < n; i++) {
    const x = (i / n) * 2 - 1;
    c[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return c;
}

function makeSlot(ctx: AudioContext, dryOut: AudioNode, delayIn: AudioNode, verbIn: AudioNode): Slot {
  const carrier = ctx.createOscillator();
  const mod = ctx.createOscillator();
  const modG = ctx.createGain(); modG.gain.value = 0;
  mod.connect(modG).connect(carrier.frequency);

  const shaper = ctx.createWaveShaper(); shaper.curve = driveCurve(0.0001);
  const filt = ctx.createBiquadFilter(); filt.frequency.value = 800;
  const pan = typeof ctx.createStereoPanner === "function" ? ctx.createStereoPanner() : null;
  const amp = ctx.createGain(); amp.gain.value = 0;
  const focus = ctx.createGain(); focus.gain.value = 1;

  const lfo = ctx.createOscillator();
  const lfoG = ctx.createGain(); lfoG.gain.value = 0;
  lfo.connect(lfoG);

  const send = ctx.createGain(); send.gain.value = 0;

  carrier.connect(shaper).connect(filt);
  const tail: AudioNode = pan ? (filt.connect(pan), pan) : filt;
  tail.connect(amp).connect(focus);
  focus.connect(dryOut);
  focus.connect(send);
  send.connect(delayIn);
  send.connect(verbIn);

  carrier.start(); mod.start(); lfo.start();
  return { carrier, mod, modG, shaper, filt, pan, amp, focus, lfo, lfoG, send };
}

export function initAudio(): Graph {
  if (graph) return graph;

  const Ctor = window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctor({ latencyHint: "playback" });
  // Some browsers (notably Safari) leave a freshly constructed context "suspended"
  // even when built inside a user gesture. Resume synchronously, in the same gesture
  // call stack, or the context clock never ticks — no sound, and every card stays
  // invisible since the visual envelope is timed off ctx.currentTime.
  if (ctx.state !== "running") void ctx.resume();

  // ── master ──────────────────────────────────────────────
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18; comp.knee.value = 22;
  comp.ratio.value = 3.4; comp.attack.value = 0.05; comp.release.value = 0.9;

  const master = ctx.createGain(); master.gain.value = 0.0001;
  const mFilt = ctx.createBiquadFilter();
  mFilt.type = "lowpass"; mFilt.frequency.value = DEF.mFilt; mFilt.Q.value = 0.5;
  mFilt.connect(master).connect(comp).connect(ctx.destination);
  master.gain.setTargetAtTime(0.82, ctx.currentTime, 4);   // it fades up; it never starts

  // ── wet buses ───────────────────────────────────────────
  const verb = ctx.createConvolver(); verb.buffer = impulse(ctx);
  const verbGain = ctx.createGain(); verbGain.gain.value = 0.9;
  const delay = ctx.createDelay(4); delay.delayTime.value = DEF.delay;
  const fb = ctx.createGain(); fb.gain.value = DEF.fb;
  const dFilt = ctx.createBiquadFilter();
  dFilt.type = "lowpass"; dFilt.frequency.value = DEF.dFilt;
  delay.connect(dFilt).connect(fb).connect(delay);          // dub feedback loop
  dFilt.connect(verb);
  verb.connect(verbGain).connect(mFilt);
  delay.connect(mFilt);

  // ── the bed: the thing that was already happening ───────
  const bedBus = ctx.createGain(); bedBus.gain.value = DEF.bedBus;
  const bedFilt = ctx.createBiquadFilter();
  bedFilt.type = "lowpass"; bedFilt.frequency.value = DEF.bedFilt; bedFilt.Q.value = 1.1;
  bedFilt.connect(bedBus).connect(mFilt);

  const bedOscs: BedOsc[] = [];
  ([[1, "sine", 0.42], [1.004, "sawtooth", 0.10], [0.4993, "sine", 0.30], [1.4988, "triangle", 0.055]] as
    [number, OscillatorType, number][]).forEach(([mult, wave, g]) => {
      const o = ctx.createOscillator(); o.type = wave; o.frequency.value = ROOT * mult;
      const gn = ctx.createGain(); gn.gain.value = g;
      o.connect(gn).connect(bedFilt); o.start();
      bedOscs.push({ o, mult, gn });
    });

  const hiss = ctx.createBufferSource();
  hiss.buffer = noiseBuffer(ctx); hiss.loop = true;
  const hissG = ctx.createGain(); hissG.gain.value = DEF.hiss;
  const hissF = ctx.createBiquadFilter(); hissF.type = "lowpass"; hissF.frequency.value = 480;
  hiss.connect(hissF).connect(hissG).connect(bedFilt); hiss.start();

  const drift = ctx.createOscillator(); drift.type = "sine"; drift.frequency.value = 0.021;
  const driftG = ctx.createGain(); driftG.gain.value = 42;
  drift.connect(driftG).connect(bedFilt.frequency); drift.start();

  // ── voices ──────────────────────────────────────────────
  const voiceBus = ctx.createGain(); voiceBus.gain.value = DEF.voiceBus;
  voiceBus.connect(mFilt);

  const slots = Array.from({ length: SLOT_COUNT }, () => makeSlot(ctx, voiceBus, delay, verb));

  graph = {
    ctx, mFilt, delay, fb, dFilt, bedBus, bedFilt, bedOscs, hissG, voiceBus,
    slots, busy: slots.map(() => 0),
  };
  return graph;
}

/** The context can be suspended by a call, Siri, or the OS. Bring it back. */
export function resumeIfSuspended(): void {
  if (graph && graph.ctx.state === "suspended") void graph.ctx.resume();
}
