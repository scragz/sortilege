/**
 * Spread geometry is mix topology. A slot is the card plus its name:
 * the card rotates, the name never does.
 */

import { hueOf, nameOf, type Card } from "../deck/cards";
import { faceFor } from "../deck/faces";
import { audio } from "../audio/graph";
import { carve, dealCard, releaseAll, RISE } from "../audio/deal";

export type SpreadSize = 1 | 3 | 10;

const POS: Record<SpreadSize, [number, number][]> = {
  1:  [[50, 46]],
  3:  [[26, 46], [50, 46], [74, 46]],
  10: [[37, 45], [37, 45], [37, 79], [17, 45], [37, 14], [57, 45],
       [83, 82], [83, 59], [83, 36], [83, 13]],
};

const STAGGER: Record<SpreadSize, number> = { 1: 0, 3: 4.2, 10: 5.0 };

export interface LiveCard {
  card: Card;
  wrap: HTMLDivElement;
  el: HTMLDivElement;
  label: HTMLDivElement;
  slotIdx: number;
  t0: number;
  gone: boolean;
  clearAt: number | null;
  eAtClear: number;
  zoomEl: HTMLDivElement | null;
}

export const live: LiveCard[] = [];

export function slotEl(card: Card, size: SpreadSize, lay: boolean, under: boolean) {
  const wrap = document.createElement("div");
  wrap.className = `slot s${size}`;
  wrap.style.setProperty("--hue", hueOf(card));

  const el = document.createElement("div");
  el.className = "card" +
    (card.sign < 0 ? " rev" : "") +
    (card.scope === "bus" ? " major" : "") +
    (lay ? " cross-lay" : "");
  if (card.sign < 0) el.style.setProperty("--flip", "180deg");  // reversed cards read upside down
  el.innerHTML = `<div class="fill"></div>${faceFor(card)}<div class="edge"></div>`;

  const label = document.createElement("div");
  label.className = "label" + (under ? " under" : "");
  label.innerHTML = nameOf(card) + (card.sign < 0 ? '<span class="rv">reversed</span>' : "");

  wrap.append(el, label);
  return { wrap, el, label };
}

export function place(
  stage: HTMLElement,
  cards: Card[],
  n: SpreadSize,
  onInspect: (l: LiveCard) => void,
): void {
  const t0 = audio().ctx.currentTime + 0.35;
  const pos = POS[n], step = STAGGER[n];

  // the room is carved first; the cards are then placed into it
  carve(cards.filter((c) => c.scope === "voice").length, t0);

  cards.forEach((card, i) => {
    const t = t0 + i * step;
    const lay = n === 10 && i === 1;              // the crossing card lies across
    const { wrap, el, label } = slotEl(card, n, lay, lay);
    wrap.style.left = `${pos[i][0]}%`;
    wrap.style.top = `${pos[i][1]}%`;
    stage.appendChild(wrap);

    const slotIdx = dealCard(card, t);
    const l: LiveCard = {
      card, wrap, el, label, slotIdx, t0: t,
      gone: false, clearAt: null, eAtClear: 0, zoomEl: null,
    };
    wrap.addEventListener("click", () => onInspect(l));
    live.push(l);
  });
}

/** The only thing that ends a reading. */
export function clearReading(): void {
  const t = releaseAll();
  for (const l of live) {
    l.eAtClear = 1 - Math.exp(-3 * Math.max(0, t - l.t0) / RISE);
    l.clearAt = t;
  }
}
