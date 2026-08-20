/**
 * The deck. Minors become voices, majors act on the bus.
 * Suit sets the timbral domain and register; rank walks a just-intoned
 * minor scale and scales modulation depth and rate.
 */

export type Suit = "wands" | "cups" | "swords" | "pents";
export type Sign = 1 | -1;

export type BusOp =
  | "brighten" | "darken" | "space" | "warm" | "anchor" | "consonate"
  | "drive" | "invert" | "stretch" | "morph" | "devil" | "crash" | "judge";

export interface SuitSpec {
  hue: string;
  oct: number;
  wave: OscillatorType;
  fm: number;        // modulator : carrier ratio. Integers stay harmonic.
  fmIndex: number;   // how far that modulator is allowed to push the carrier
  drive: number;
  ftype: BiquadFilterType;
  fbase: number;
  q: number;
  tone: number;      // high-shelf trim in dB — the suit's licence to be bright
  level: number;     // voice trim, so a loud timbre is not also the loudest
  wet: number;
  lfoTo: "filter" | "pitch" | "amp";
  lfoWave: OscillatorType;
  lfoAmt: number;    // scales the LFO depth for this suit
  rate: [number, number];
  drift: number;
}

/**
 * Fire is meant to be active, not abrasive: Wands keeps its saw and its wah,
 * but on a harmonic 2:1 modulator, a shallower index, far less waveshaping,
 * a lower corner, a shelf over the top and more of it pushed into the tail.
 */
export const SUITS: Record<Suit, SuitSpec> = {
  wands:  { hue:"var(--fire)",  oct:2, wave:"sawtooth", fm:2.00, fmIndex:0.15, drive:0.18, ftype:"lowpass",  fbase:1000, q:1.0, tone:-11, level:0.60, wet:0.36, lfoTo:"filter", lfoWave:"triangle", lfoAmt:0.45, rate:[0.09,1.00], drift:0.7 },
  cups:   { hue:"var(--water)", oct:1, wave:"sine",     fm:0.50, fmIndex:0.09, drive:0.00, ftype:"lowpass",  fbase:820,  q:0.7, tone:  0, level:1.00, wet:0.68, lfoTo:"pitch",  lfoWave:"sine",     lfoAmt:1.00, rate:[0.03,0.28], drift:0.3 },
  swords: { hue:"var(--air)",   oct:3, wave:"sawtooth", fm:2.01, fmIndex:0.36, drive:0.26, ftype:"bandpass", fbase:2500, q:6.5, tone: -4, level:0.82, wet:0.36, lfoTo:"filter", lfoWave:"square",   lfoAmt:0.85, rate:[0.40,5.00], drift:1.4 },
  pents:  { hue:"var(--earth)", oct:0, wave:"triangle", fm:0.25, fmIndex:0.09, drive:0.18, ftype:"lowpass",  fbase:420,  q:2.0, tone:  0, level:1.05, wet:0.10, lfoTo:"amp",    lfoWave:"sine",     lfoAmt:1.00, rate:[0.05,0.55], drift:0.2 },
};

/** A minor scale in just ratios. Rank walks it; the suit supplies the octave. */
export const RATIOS = [1, 9 / 8, 6 / 5, 4 / 3, 3 / 2, 8 / 5, 9 / 5];
export const ROOT = 55; // A1

/** Each major is a single operation on the whole graph, in deck order. */
const MAJOR_OPS: BusOp[] = [
  "stretch","brighten","space","warm","anchor","space","consonate","drive",
  "anchor","darken","stretch","consonate","invert","morph","consonate","devil",
  "crash","brighten","darken","brighten","judge","space",
];

const MAJOR_NAMES = [
  "The Fool","The Magician","The High Priestess","The Empress","The Emperor",
  "The Hierophant","The Lovers","The Chariot","Strength","The Hermit",
  "Wheel of Fortune","Justice","The Hanged Man","Death","Temperance",
  "The Devil","The Tower","The Star","The Moon","The Sun","Judgement","The World",
];

const RANK_NAMES = [
  "Ace","Two","Three","Four","Five","Six","Seven",
  "Eight","Nine","Ten","Page","Knight","Queen","King",
];

const SUIT_NAMES: Record<Suit, string> = {
  wands: "Wands", cups: "Cups", swords: "Swords", pents: "Pentacles",
};

export interface MinorCard {
  scope: "voice";
  suit: Suit;
  rank: number;      // 1..14
  sign: Sign;        // reversal, applied as a sign flip on modulation
  rate: number;      // LFO rate, filled in when dealt; drives the visual breathing
}

export interface MajorCard {
  scope: "bus";
  op: BusOp;
  num: number;       // 0..21
  sign: Sign;
  rate: number;
}

export type Card = MinorCard | MajorCard;

type DeckEntry =
  | Omit<MinorCard, "sign" | "rate">
  | Omit<MajorCard, "sign" | "rate">;

function buildDeck(): DeckEntry[] {
  const d: DeckEntry[] = [];
  for (const suit of Object.keys(SUITS) as Suit[])
    for (let rank = 1; rank <= 14; rank++) d.push({ scope: "voice", suit, rank });
  MAJOR_OPS.forEach((op, num) => d.push({ scope: "bus", op, num }));
  return d;
}

export const DECK = buildDeck(); // 78

/** Draw without replacement. Reversal is an independent coin flip per card. */
export function draw(n: number): Card[] {
  const picked = new Set<number>();
  while (picked.size < n) picked.add(Math.floor(Math.random() * DECK.length));
  return [...picked].map((i) => ({
    ...DECK[i],
    sign: (Math.random() < 0.5 ? -1 : 1) as Sign,
    rate: 0,
  })) as Card[];
}

export const nameOf = (card: Card): string =>
  card.scope === "bus"
    ? MAJOR_NAMES[card.num]
    : `${RANK_NAMES[card.rank - 1]} of ${SUIT_NAMES[card.suit]}`;

export const hueOf = (card: Card): string =>
  card.scope === "bus" ? "var(--gold)" : SUITS[card.suit].hue;
