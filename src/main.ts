/**
 * A drone that is always running. Cards do not play music —
 * they place constraints on a process that never stops.
 * Minors are voices. Majors act on the bus. Reversal is a sign.
 */

import "./style.css";

import { draw } from "./deck/cards";
import {
  audio, asleep, onAudioState, running, sleepAudio, started, unlock, wakeAudio,
} from "./audio/graph";
import { RISE, focusCard, unfocusVoices } from "./audio/deal";
import {
  clearReading, live, place, slotEl,
  type LiveCard, type SpreadSize,
} from "./ui/reading";

const REDUCED = matchMedia("(prefers-reduced-motion:reduce)").matches;

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
};

const stage = el("stage");
const field = el("field");
const inspect = el("inspect");
const spreads = el("spreads");
const clearBox = el("clearWrap");
const gate = el("gate");
const gateSay = gate.querySelector<HTMLElement>(".say")!;
const clearBtn = el<HTMLButtonElement>("clearBtn");

let reading = false;
let zoomed: LiveCard | null = null;

function setReading(on: boolean): void {
  reading = on;
  spreads.classList.toggle("hidden", on);
  clearBox.classList.toggle("shown", on);
}

// ── inspect ─────────────────────────────────────────────────────

function openInspect(l: LiveCard): void {
  if (!running()) return;
  if (l.clearAt !== null || audio().ctx.currentTime < l.t0) return;   // hasn't arrived yet
  zoomed = l;
  const big = slotEl(l.card, 1, false, false);
  inspect.replaceChildren(big.wrap);
  inspect.classList.add("on");
  l.zoomEl = big.el;
  focusCard(l.card, l.slotIdx);
}

function closeInspect(): void {
  if (!zoomed) return;
  unfocusVoices();
  inspect.classList.remove("on");
  inspect.replaceChildren();
  zoomed.zoomEl = null;
  zoomed = null;
}

// ── visual envelope, driven off the audio clock ─────────────────

function frame(): void {
  requestAnimationFrame(frame);
  if (!running()) return;
  const now = audio().ctx.currentTime;
  let sum = 0;
  let swept = false;

  for (const l of live) {
    const dt = now - l.t0;
    const e = l.clearAt !== null
      ? l.eAtClear * Math.exp(-(now - l.clearAt) / 0.62)   // matches the audio fade
      : dt < 0 ? 0 : 1 - Math.exp(-3 * dt / RISE);
    sum += e;

    let p = e, bright = 1;
    if (!REDUCED && l.card.rate) {                          // each card breathes at its own rate
      const wob = Math.sin(2 * Math.PI * l.card.rate * now) * l.card.sign;
      p = Math.max(0, Math.min(1, e * (1 + wob * 0.16)));
      bright = 1 + wob * 0.22;
    }

    const vis = Math.min(1, e * 3.2);
    l.el.style.setProperty("--p", p.toFixed(4));
    l.el.style.opacity = vis.toFixed(3);
    l.el.style.filter = `brightness(${bright.toFixed(3)})`;
    l.label.style.opacity = (vis * 0.94).toFixed(3);
    if (l.zoomEl) {
      l.zoomEl.style.setProperty("--p", p.toFixed(4));
      l.zoomEl.style.filter = `brightness(${bright.toFixed(3)})`;
    }

    if (l.clearAt !== null && e < 0.012 && !l.gone) {
      l.gone = true;
      l.wrap.remove();
      swept = true;
    }
  }

  if (swept) {
    for (let i = live.length - 1; i >= 0; i--) if (live[i].gone) live.splice(i, 1);
  }
  field.style.opacity = (0.9 + Math.min(0.9, sum * 0.09)).toFixed(3);
}

// ── input ───────────────────────────────────────────────────────

let looping = false;
let opened = false;   // the gate has been let go at least once

/**
 * The gate is the app's only claim that the drone is running, so it is tied to
 * whether the clock is actually running rather than to whether a tap happened.
 * A tap that fails to unlock leaves it up, still saying what to do; an
 * interruption the OS imposed puts it back, asking for the gesture that is the
 * only thing allowed to fix it.
 */
function syncGate(): void {
  const up = !running() && !asleep();
  gate.classList.toggle("open", !up);
  if (up && opened) gateSay.textContent = "touch to resume";
}

function warmPicks(): void {
  document.querySelectorAll<HTMLElement>(".picks .pick")
    .forEach((b, i) => setTimeout(() => b.classList.add("warm"), 1400 + i * 400));
}

/** Every gesture is a chance to start, or to recover. Never a one-shot. */
function tryUnlock(): Promise<boolean> {
  if (!looping) { looping = true; requestAnimationFrame(frame); }
  return unlock().then((ok) => {
    if (ok && !opened) { opened = true; warmPicks(); }
    syncGate();
    return ok;
  });
}

// Any gesture, anywhere, may start or recover the clock: a context can stop
// being usable without the page being touched at all, since iOS drops it into
// "interrupted" on a call or a lock. Capture phase, so whatever the user
// reaches for next revives it — the gate, a spread, or a card.
//
// Unconditional, because this also reconciles the gate with reality on every
// gesture. A gate left up over a context that is in fact running would cover
// the whole page with no way past it: the same latch, pointing the other way.
document.addEventListener("pointerdown", () => { void tryUnlock(); }, true);

onAudioState(syncGate);

document.querySelectorAll<HTMLButtonElement>(".picks .pick").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (reading) return;
    const n = Number(btn.dataset.n) as SpreadSize;
    // The click is itself a gesture, so it is a legitimate place to recover a
    // stopped clock. Dealing waits for that to settle: a spread scheduled
    // against a frozen currentTime is scheduled for a time that never comes.
    void tryUnlock().then((ok) => {
      if (!ok || reading) return;
      place(stage, draw(n), n, openInspect);
      setReading(true);
    });
  });
});

clearBtn.addEventListener("click", () => {
  if (!running() || !reading) return;
  closeInspect();
  clearReading();
  setReading(false);
});

inspect.addEventListener("click", closeInspect);

// A backgrounded tab stops feeding the audio thread on time, and a starved
// render of thirty oscillators through a convolver comes back as beeping and
// popping. So the reading is put down when the page goes away and picked up
// when it returns — ctx.currentTime freezes with it, so the cards resume
// exactly where their envelopes left off.
document.addEventListener("visibilitychange", () => {
  if (!started()) return;
  if (document.visibilityState === "hidden") sleepAudio();
  else wakeAudio();
});
window.addEventListener("pagehide", () => { if (started()) sleepAudio(); });
window.addEventListener("pageshow", () => {
  if (started() && document.visibilityState === "visible") wakeAudio();
});
