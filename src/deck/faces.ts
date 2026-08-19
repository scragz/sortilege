/**
 * Card faces, drawn rather than written.
 * Pip cards genuinely are counted suit symbols, so rank stays countable
 * and suit stays a shape. Majors get sigils reduced from their own
 * iconography to line geometry. Face viewBox is 0 0 50 80.
 */

import { type Card, type Suit } from "./cards";

function suitMark(suit: Suit, cx: number, cy: number, s: number): string {
  const k = s / 7;
  const g = (b: string) => `<g transform="translate(${cx},${cy}) scale(${k.toFixed(3)})" stroke stroke-width="${(1.5/k).toFixed(2)}">${b}</g>`;
  switch (suit){
    case "wands":   // a budding staff
      return g(`<line x1="-3.4" y1="5.5" x2="3.4" y2="-5.5"/><line x1="1.4" y1="-3.2" x2="4.4" y2="-3"/><line x1="-1.2" y1="1.4" x2="-4.2" y2="1.8"/>`);
    case "cups":    // bowl, stem, foot
      return g(`<path d="M-4.4 -4.6 H4.4 A4.4 5.4 0 0 1 -4.4 -4.6 Z"/><line x1="0" y1="0.6" x2="0" y2="4.4"/><line x1="-3" y1="5.2" x2="3" y2="5.2"/>`);
    case "swords":  // blade and crossguard
      return g(`<line x1="0" y1="-6" x2="0" y2="6"/><line x1="-3.8" y1="2.4" x2="3.8" y2="2.4"/><path d="M-2 -3.4 L0 -6 L2 -3.4"/>`);
    case "pents":   // disc with inscribed star
      return g(`<circle cx="0" cy="0" r="5.2"/><polygon points="0,-4.2 2.47,3.4 -4,-1.3 4,-1.3 -2.47,3.4"/>`);
  }
  return "";
}

// pip arrangements, in fractions of the face's content box
const PIPS: Record<number, [number, number][]> = {
  1:[[.5,.5]],
  2:[[.5,.24],[.5,.76]],
  3:[[.5,.16],[.5,.5],[.5,.84]],
  4:[[.3,.26],[.7,.26],[.3,.74],[.7,.74]],
  5:[[.28,.22],[.72,.22],[.5,.5],[.28,.78],[.72,.78]],
  6:[[.3,.18],[.7,.18],[.3,.5],[.7,.5],[.3,.82],[.7,.82]],
  7:[[.3,.15],[.7,.15],[.5,.33],[.3,.51],[.7,.51],[.3,.87],[.7,.87]],
  8:[[.3,.13],[.7,.13],[.3,.38],[.7,.38],[.3,.62],[.7,.62],[.3,.87],[.7,.87]],
  9:[[.22,.16],[.5,.16],[.78,.16],[.22,.5],[.5,.5],[.78,.5],[.22,.84],[.5,.84],[.78,.84]],
  10:[[.3,.1],[.7,.1],[.3,.3],[.7,.3],[.3,.5],[.7,.5],[.3,.7],[.7,.7],[.3,.9],[.7,.9]],
};

// 22 sigils, each reduced from the card's own iconography to line geometry
function majorSigil(n: number): string {
  const SW = 'stroke stroke-width="1.6"';
  const P = (d: string) => `<path d="${d}" ${SW}/>`;
  const C = (x: number, y: number, r: number) => `<circle cx="${x}" cy="${y}" r="${r}" ${SW}/>`;
  const L = (x1: number, y1: number, x2: number, y2: number) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${SW}/>`;
  const star = (cx: number, cy: number, r: number, pts: number, rot = -90): string => {
    const pt = (i: number): string => {
      const th = (rot + i * 360 / pts) * Math.PI / 180;
      return `${(cx + Math.cos(th)*r).toFixed(2)},${(cy + Math.sin(th)*r).toFixed(2)}`;
    };
    if (pts === 6)   // a hexagram is two triangles, not a hexagon
      return `<polygon points="${[0,2,4].map(pt).join(" ")}" ${SW}/>`
           + `<polygon points="${[1,3,5].map(pt).join(" ")}" ${SW}/>`;
    const step = pts === 5 ? 2 : 3, order = []; let i = 0;
    do { order.push(pt(i)); i = (i + step) % pts; } while (i !== 0);
    return `<polygon points="${order.join(" ")}" ${SW}/>`;
  };
  const lemniscate = (cx: number, cy: number, w: number, h: number) =>
    P(`M${cx-w} ${cy} C${cx-w} ${cy-h}, ${cx-1} ${cy-h}, ${cx} ${cy} C${cx+1} ${cy+h}, ${cx+w} ${cy+h}, ${cx+w} ${cy} C${cx+w} ${cy-h}, ${cx+1} ${cy-h}, ${cx} ${cy} C${cx-1} ${cy+h}, ${cx-w} ${cy+h}, ${cx-w} ${cy} Z`);
  switch (n){
    case 0:  return L(12,58,33,31) + C(36,27,4.4) + L(8,66,20,66) + L(30,66,42,66);          // the step off the edge
    case 1:  return lemniscate(25,24,10,9) + L(25,33,25,58) + L(15,58,35,58);                // lemniscate over a staff
    case 2:  return L(13,22,13,58) + L(37,22,37,58) + P("M19 34 A8 8 0 1 0 31 34 A6.5 6.5 0 1 1 19 34"); // pillars, crescent
    case 3:  return C(25,38,11) + P("M16 24 L19.5 18 L25 23 L30.5 18 L34 24") + L(14,58,36,58);          // crowned
    case 4:  return P("M14 26 H36 V56 H14 Z") + L(14,38,36,38) + L(25,26,25,18);            // the cube throne
    case 5:  return L(25,20,25,60) + L(14,30,36,30) + L(17,40,33,40) + L(20,50,30,50);      // triple bar
    case 6:  return C(19,40,11) + C(31,40,11);                                              // vesica
    case 7:  return P("M13 28 H37 V44 H13 Z") + C(18,52,6) + C(32,52,6);                    // the chariot
    case 8:  return lemniscate(25,29,12,11) + P("M14 49 L25 56 L36 49") + P("M14 69 L25 62 L36 69"); // endless force, closing
    case 9:  return L(25,18,25,42) + C(25,54,9) + star(25,54,5.4,6);                        // lantern on a staff
    case 10: return C(25,40,14) + L(11,40,39,40) + L(25,26,25,54) + L(15,30,35,50) + L(35,30,15,50);
    case 11: return L(25,22,25,58) + L(11,30,39,30) + C(11,40,5) + C(39,40,5) + L(15,58,35,58);
    case 12: return L(25,16,25,32) + P("M13 32 H37 L25 60 Z");                              // suspended, inverted
    case 13: return P("M10 33 A17 17 0 0 1 40 24 A21 21 0 0 0 10 33 Z") + L(25,30,25,64) + L(19,42,31,42); // the scythe
    case 14: return P("M12 26 A7 7 0 0 0 26 26 Z") + P("M24 50 A7 7 0 0 0 38 50 Z") + L(21,32,31,46);
    case 15: return star(25,40,15,5,90);                                                    // inverted star
    case 16: return P("M16 62 V30 H34 V62") + P("M18 27 L40 21") + P("M33 12 L25 29 L31 31 L21 47"); // the struck tower
    case 17: return star(25,40,15,8) + C(25,40,3.4);                                        // eight points
    case 18: return P("M18 28 A11 11 0 1 0 32 28 A9 9 0 1 1 18 28") + L(12,48,12,60) + L(38,48,38,60) + P("M11 68 Q18 62 25 68 T39 68");
    case 19: return C(25,40,9) + L(25,19,25,26) + L(25,54,25,61) + L(4,40,11,40) + L(39,40,46,40)
                  + L(11,26,15,30) + L(35,50,39,54) + L(39,26,35,30) + L(15,50,11,54);      // the disc
    case 20: return P("M11 46 A14 14 0 0 1 39 46") + L(17,62,17,50) + L(25,62,25,46) + L(33,62,33,50) + L(11,68,39,68);
    case 21: return `<ellipse cx="25" cy="40" rx="13" ry="19" stroke stroke-width="1.6"/>` + C(25,17,3) + C(25,63,3) + C(9,40,3) + C(41,40,3);
  }
  return "";
}

export function faceFor(card: Card): string {
  let body = "";
  if (card.scope === "bus"){
    body = majorSigil(card.num);
  } else if (card.rank <= 10){
    const s = card.rank <= 3 ? 8.6 : card.rank <= 6 ? 7 : card.rank <= 8 ? 5.4 : 4.7;
    body = PIPS[card.rank]
      .map(([fx,fy]) => suitMark(card.suit, 8 + fx * 34, 12 + fy * 56, s))
      .join("");
  } else {
    // court: one large mark plus 1–4 counters — page, knight, queen, king
    body = suitMark(card.suit, 25, 32, 14);
    const n = card.rank - 10;
    for (let i = 0; i < n; i++){
      const x = 25 + (i - (n - 1) / 2) * 7;
      body += `<circle cx="${x.toFixed(2)}" cy="63" r="2.4" data-solid/>`;
    }
    body += `<line x1="10" y1="52" x2="40" y2="52" stroke stroke-width="1.2" opacity=".45"/>`;
  }
  return `<svg class="sigil" viewBox="0 0 50 80" preserveAspectRatio="xMidYMid meet">${body}</svg>`;
}
