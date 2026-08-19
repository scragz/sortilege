/**
 * A drone that is always running. Cards do not play music —
 * they place constraints on a process that never stops.
 * Minors are voices. Majors act on the bus. Reversal is a sign.
 */

import "./style.css";

import { draw } from "./deck/cards";
import { initAudio, audio, ready, resumeIfSuspended } from "./audio/graph";
import { RISE, focusVoice, unfocusVoices } from "./audio/deal";
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
  if (l.clearAt !== null || audio().ctx.currentTime < l.t0) return;   // hasn't arrived yet
  zoomed = l;
  const big = slotEl(l.card, 1, false, false);
  inspect.replaceChildren(big.wrap);
  inspect.classList.add("on");
  l.zoomEl = big.el;
  focusVoice(l.slotIdx);
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
  if (!ready()) return;
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

function start(): void {
  initAudio();
  requestAnimationFrame(frame);
  gate.classList.add("open");
  document.querySelectorAll<HTMLElement>(".picks .pick")
    .forEach((b, i) => setTimeout(() => b.classList.add("warm"), 1400 + i * 400));
}

gate.addEventListener("pointerdown", () => { if (!ready()) start(); }, { once: true });

document.querySelectorAll<HTMLButtonElement>(".picks .pick").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (!ready() || reading) return;
    const n = Number(btn.dataset.n) as SpreadSize;
    place(stage, draw(n), n, openInspect);
    setReading(true);
  });
});

clearBtn.addEventListener("click", () => {
  if (!ready() || !reading) return;
  closeInspect();
  clearReading();
  setReading(false);
});

inspect.addEventListener("click", closeInspect);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") resumeIfSuspended();
});
window.addEventListener("focus", resumeIfSuspended);
