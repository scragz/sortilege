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
  tone: BiquadFilterNode;   // per-suit high shelf: how much edge the suit is allowed
  pan: StereoPannerNode | null;
  amp: GainNode;
  focus: GainNode;          // inspecting a card lifts its voice above the rest
  lfo: OscillatorNode;
  // one gain per destination, permanently connected. Re-patching a live LFO
  // steps whatever it was offsetting, and a step is a click.
  lfoF: GainNode;
  lfoP: GainNode;
  lfoA: GainNode;
  send: GainNode;
  /** What the card asked for. Majors bend these; they never overwrite them. */
  base: SlotBase;
}

/**
 * A spread is scheduled in a single synchronous pass, so a major that lands
 * thirty seconds out cannot read a live parameter to modify — at pass time it
 * would read the value from before any card was dealt. Each slot therefore
 * keeps what its card asked for, and every major restates the whole spread
 * from those numbers at its own scheduled time.
 */
export interface SlotBase {
  tone: number;   // dB of high shelf
  rate: number;   // LFO Hz
  wet: number;
  lfoF: number;   // signed LFO depths, per destination
  lfoP: number;
  lfoA: number;
  mod: number;    // FM index in Hz
}

export interface BedOsc {
  o: OscillatorNode;
  mult: number;
  gn: GainNode;
}

/** The struck transient a major fires. Allocated once; gated, never rebuilt. */
export interface Mark {
  tone: OscillatorNode;
  toneG: GainNode;
  ring: OscillatorNode;
  ringG: GainNode;
  noiseF: BiquadFilterNode;
  noiseG: GainNode;
  bus: GainNode;
}

export interface Graph {
  ctx: AudioContext;
  master: GainNode;
  mFilt: BiquadFilterNode;
  delay: DelayNode;
  fb: GainNode;
  dFilt: BiquadFilterNode;
  bedBus: GainNode;
  bedFilt: BiquadFilterNode;
  bedOscs: BedOsc[];
  subG: GainNode;
  hissG: GainNode;
  voiceBus: GainNode;
  mark: Mark;
  slots: Slot[];
  busy: number[];
  /** Where each automated bus parameter is *heading*, so relative majors compose. */
  aim: Aim;
}

/** Where every automated value is heading, so majors compose instead of racing. */
export interface Aim {
  mFilt: number;
  fb: number;
  bedBus: number;
  bedFilt: number;
  tone: number;     // dB added to every voice's shelf
  stretch: number;  // multiplies every LFO rate
  wet: number;      // added to every voice's send
  spin: 1 | -1;     // which way the modulation runs
  wobble: number;   // how much modulation survives at all
  mod: number;      // multiplies every FM index
}

/** Resting values for every automatable bus parameter, so clear can restore them. */
export const DEF = {
  mFilt: 6200, fb: 0.42, delay: 0.664, dFilt: 2400,
  bedFilt: 260, bedBus: 1, hiss: 0.09, voiceBus: 1, sub: 0,
} as const;

/** Every aim at rest: no bend on top of what the cards themselves asked for. */
export const restAim = (): Aim => ({
  mFilt: DEF.mFilt, fb: DEF.fb, bedBus: DEF.bedBus, bedFilt: DEF.bedFilt,
  tone: 0, stretch: 1, wet: 0, spin: 1, wobble: 1, mod: 1,
});

export const SLOT_COUNT = 10;
export const MASTER = 0.76;

let graph: Graph | null = null;

export function audio(): Graph {
  if (!graph) throw new Error("audio graph not initialised");
  return graph;
}

export const ready = (): boolean => graph !== null;

/**
 * Freeze a param at its current value so a new ramp starts from where the ear
 * already is. cancelScheduledValues alone can snap back to the last set value.
 */
export function hold(p: AudioParam, t: number): number {
  if (typeof p.cancelAndHoldAtTime === "function") p.cancelAndHoldAtTime(t);
  else { const v = p.value; p.cancelScheduledValues(t); p.setValueAtTime(v, t); }
  return p.value;
}

/**
 * Brown noise, made genuinely seamless. The naive random walk ends nowhere near
 * where it started, so looping it ticks once per buffer — that tick is the pop
 * you hear under a quiet spread.
 */
function noiseBuffer(ctx: AudioContext, secs = 4): AudioBuffer {
  const xf = Math.floor(ctx.sampleRate * 0.35);          // crossfade length
  const raw = new Float32Array(Math.floor(ctx.sampleRate * secs) + xf);
  let last = 0, sum = 0;
  for (let i = 0; i < raw.length; i++) {
    last = (last + Math.random() * 0.04 - 0.02) * 0.997;
    raw[i] = Math.max(-1, Math.min(1, last * 2.2));
    sum += raw[i];
  }
  const dc = sum / raw.length;                            // the walk drifts; remove it
  const len = raw.length - xf;
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = raw[i] - dc;
  for (let i = 0; i < xf; i++) {                          // tail folded back over head
    const w = i / xf;
    d[i] = d[i] * w + (raw[len + i] - dc) * (1 - w);
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
  const tone = ctx.createBiquadFilter();
  tone.type = "highshelf"; tone.frequency.value = 1900; tone.gain.value = 0;
  const pan = typeof ctx.createStereoPanner === "function" ? ctx.createStereoPanner() : null;
  const amp = ctx.createGain(); amp.gain.value = 0;
  const focus = ctx.createGain(); focus.gain.value = 1;

  const lfo = ctx.createOscillator();
  const lfoF = ctx.createGain(); lfoF.gain.value = 0;
  const lfoP = ctx.createGain(); lfoP.gain.value = 0;
  const lfoA = ctx.createGain(); lfoA.gain.value = 0;
  lfo.connect(lfoF).connect(filt.frequency);
  lfo.connect(lfoP).connect(carrier.frequency);
  lfo.connect(lfoA).connect(amp.gain);

  const send = ctx.createGain(); send.gain.value = 0;

  carrier.connect(shaper).connect(filt).connect(tone);
  const tail: AudioNode = pan ? (tone.connect(pan), pan) : tone;
  tail.connect(amp).connect(focus);
  focus.connect(dryOut);
  focus.connect(send);
  send.connect(delayIn);
  send.connect(verbIn);

  carrier.start(); mod.start(); lfo.start();
  return {
    carrier, mod, modG, shaper, filt, tone, pan, amp, focus, lfo, lfoF, lfoP, lfoA, send,
    base: { tone: 0, rate: 0.1, wet: 0, lfoF: 0, lfoP: 0, lfoA: 0, mod: 0 },
  };
}

/**
 * A major does not add a note; it re-states the terms the drone runs under.
 * This is the sound of that re-statement landing — a struck body, gated from
 * silence, so the operation has a moment you can point at.
 */
function makeMark(ctx: AudioContext, dryOut: AudioNode, delayIn: AudioNode, verbIn: AudioNode): Mark {
  const bus = ctx.createGain(); bus.gain.value = 0.9;
  bus.connect(dryOut);
  const send = ctx.createGain(); send.gain.value = 0.55;
  bus.connect(send); send.connect(delayIn); send.connect(verbIn);

  const tone = ctx.createOscillator(); tone.type = "triangle"; tone.frequency.value = ROOT * 4;
  const toneG = ctx.createGain(); toneG.gain.value = 0;
  tone.connect(toneG).connect(bus); tone.start();

  const ring = ctx.createOscillator(); ring.type = "sine"; ring.frequency.value = ROOT * 6;
  const ringG = ctx.createGain(); ringG.gain.value = 0;
  ring.connect(ringG).connect(bus); ring.start();

  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer(ctx, 3); noise.loop = true;
  const noiseF = ctx.createBiquadFilter();
  noiseF.type = "bandpass"; noiseF.frequency.value = 1400; noiseF.Q.value = 3.2;
  const noiseG = ctx.createGain(); noiseG.gain.value = 0;
  noise.connect(noiseF).connect(noiseG).connect(bus); noise.start();

  return { tone, toneG, ring, ringG, noiseF, noiseG, bus };
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
  comp.threshold.value = -20; comp.knee.value = 24;
  comp.ratio.value = 3.2; comp.attack.value = 0.05; comp.release.value = 0.9;

  const master = ctx.createGain(); master.gain.value = 0.0001;
  const mFilt = ctx.createBiquadFilter();
  mFilt.type = "lowpass"; mFilt.frequency.value = DEF.mFilt; mFilt.Q.value = 0.5;
  mFilt.connect(master).connect(comp).connect(ctx.destination);
  master.gain.setTargetAtTime(MASTER, ctx.currentTime, 4);  // it fades up; it never starts

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

  // silent until something anchors the reading, then the floor drops
  const sub = ctx.createOscillator(); sub.type = "sine"; sub.frequency.value = ROOT / 2;
  const subG = ctx.createGain(); subG.gain.value = DEF.sub;
  sub.connect(subG).connect(bedFilt); sub.start();

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
  const mark = makeMark(ctx, mFilt, delay, verb);

  graph = {
    ctx, master, mFilt, delay, fb, dFilt, bedBus, bedFilt, bedOscs, subG, hissG, voiceBus,
    mark, slots, busy: slots.map(() => 0),
    aim: restAim(),
  };
  return graph;
}

// ── going away and coming back ────────────────────────────
//
// A backgrounded tab keeps the audio thread alive but stops feeding it
// reliably: the render falls behind, the drone chops, and thirty oscillators
// through a convolver come back as beeps and pops. So the reading is put down
// rather than left running — faded out, then suspended. Nothing is torn down,
// and ctx.currentTime freezes with it, so the visual envelope resumes in step.

let sleepTimer: ReturnType<typeof setTimeout> | null = null;

function cancelSleep(): void {
  if (sleepTimer !== null) { clearTimeout(sleepTimer); sleepTimer = null; }
}

export function sleepAudio(): void {
  if (!graph) return;
  const { ctx, master } = graph;
  cancelSleep();
  if (ctx.state === "suspended") return;
  const t = ctx.currentTime;
  hold(master.gain, t);
  master.gain.linearRampToValueAtTime(0.0001, t + 0.35);
  sleepTimer = setTimeout(() => {
    sleepTimer = null;
    if (graph && document.visibilityState === "hidden" && graph.ctx.state === "running")
      void graph.ctx.suspend();
  }, 500);
}

/** Also the way back from a suspend the OS imposed — a call, Siri, a lock. */
export function wakeAudio(): void {
  if (!graph) return;
  cancelSleep();
  const { ctx, master } = graph;
  const fadeUp = (): void => {
    const t = ctx.currentTime;
    hold(master.gain, t);
    master.gain.linearRampToValueAtTime(MASTER, t + 0.7);
  };
  if (ctx.state === "running") fadeUp();
  else void ctx.resume().then(fadeUp, fadeUp);
}
