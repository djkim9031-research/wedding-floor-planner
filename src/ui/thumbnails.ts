import type { ItemType } from '../types';

const woodTable = (x: number, y: number, w: number, h: number, stroke: string, fill: string, dot: string) => `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" stroke="${stroke}" stroke-width="2" fill="${fill}" fill-opacity="0.4"/>
  <circle cx="${x + 4}" cy="${y + 4}" r="1.8" fill="${dot}"/>
  <circle cx="${x + w - 4}" cy="${y + 4}" r="1.8" fill="${dot}"/>
  <circle cx="${x + 4}" cy="${y + h - 4}" r="1.8" fill="${dot}"/>
  <circle cx="${x + w - 4}" cy="${y + h - 4}" r="1.8" fill="${dot}"/>
</svg>`;

const table = woodTable(6, 12, 36, 24, '#B57A40', '#C68A4F', '#8F5A2E');
const tableSq = woodTable(9, 9, 30, 30, '#B57A40', '#C68A4F', '#8F5A2E');
const tableQ = woodTable(4, 14, 40, 20, '#4E3A26', '#5E4630', '#3B2B1B');
const tableCoffee = `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="9" y="9" width="14" height="14" rx="1" fill="#55585B" stroke="#2F3133" stroke-width="1.6"/>
  <rect x="25" y="9" width="14" height="14" rx="1" fill="#55585B" stroke="#2F3133" stroke-width="1.6"/>
  <rect x="9" y="25" width="14" height="14" rx="1" fill="#55585B" stroke="#2F3133" stroke-width="1.6"/>
  <rect x="25" y="25" width="14" height="14" rx="1" fill="#55585B" stroke="#2F3133" stroke-width="1.6"/>
  <path d="M12 14h8M12 18h8M28 12v8M32 12v8M12 28v8M16 28v8M28 30h8M28 34h8" stroke="#2F3133" stroke-width="1"/>
</svg>`;
const lounge = (w: number) => `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="${24 - w / 2}" y="14" width="${w}" height="22" rx="3" fill="#D8D0C2" stroke="#7E776D" stroke-width="2"/>
  <rect x="${24 - w / 2}" y="14" width="${w}" height="6" rx="2" fill="#8B847A"/>
  <rect x="${24 - w / 2}" y="14" width="4" height="22" rx="1.5" fill="#8B847A"/>
  <rect x="${20 + w / 2}" y="14" width="4" height="22" rx="1.5" fill="#8B847A"/>
</svg>`;

const cloth = (fill: string) => `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="7" y="7" width="34" height="34" rx="3" fill="${fill}" stroke="#B08D57" stroke-width="1.6"/>
  <rect x="15" y="17" width="18" height="14" rx="1" stroke="#8d8478" stroke-width="1.4" stroke-dasharray="3 2.4" fill="none"/>
  <path d="M9 14 q3 3 0 7 M39 14 q-3 3 0 7 M9 27 q3 3 0 7 M39 27 q-3 3 0 7" stroke="#B08D57" stroke-width="1" opacity="0.6"/>
</svg>`;

const person = (color: string, headY: number, bun: string) => `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle cx="24" cy="${headY}" r="5" fill="${color}"/>${bun}
  <path d="M16 44 L17.5 ${headY + 14} Q18 ${headY + 8} 24 ${headY + 8} Q30 ${headY + 8} 30.5 ${headY + 14} L32 44 Z" fill="${color}"/>
</svg>`;

const figureW = person('#8A7466', 13, '<circle cx="24" cy="9.5" r="2.2" fill="#3D332A"/>');
const figureM = person('#6F665C', 11, '');

const chair = `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="12" y="16" width="24" height="22" rx="3" stroke="#B57A40" stroke-width="2" fill="#C68A4F" fill-opacity="0.4"/>
  <rect x="12" y="10" width="24" height="6" rx="2" fill="#B57A40"/>
</svg>`;

const lantern = (stroke: string, hh: number) => `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M24 ${10 - hh} L15 ${17 - hh} L33 ${17 - hh} Z" fill="${stroke}"/>
  <rect x="16" y="${17 - hh}" width="16" height="${24 + hh}" stroke="${stroke}" stroke-width="2.2" fill="none"/>
  <rect x="14" y="${41}" width="20" height="3" fill="${stroke}"/>
  <ellipse cx="24" cy="${33}" rx="2.6" ry="4" fill="#FFB84D"/>
</svg>`;

const hedge = `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="8" y="10" width="32" height="30" rx="4" fill="#47573A"/>
  <circle cx="15" cy="16" r="3.4" fill="#526344"/><circle cx="26" cy="13" r="3.8" fill="#3E5233"/>
  <circle cx="35" cy="18" r="3.2" fill="#526344"/><circle cx="19" cy="26" r="4" fill="#3E5233"/>
  <circle cx="31" cy="29" r="3.6" fill="#526344"/><circle cx="14" cy="35" r="3.2" fill="#3E5233"/>
  <rect x="10" y="40" width="28" height="3" fill="#6B6258"/>
</svg>`;

const screenIcon = `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M8 14 L18 11 L18 41 L8 44 Z" fill="#F2EDE2" stroke="#B8AD9C" stroke-width="1.4"/>
  <rect x="18" y="11" width="12" height="30" fill="#FAF6EC" stroke="#B8AD9C" stroke-width="1.4"/>
  <path d="M30 11 L40 14 L40 44 L30 41 Z" fill="#F2EDE2" stroke="#B8AD9C" stroke-width="1.4"/>
</svg>`;

const setting = `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle cx="22" cy="27" r="12" fill="#F3EFE6" stroke="#C9C2B4" stroke-width="1.6"/>
  <circle cx="22" cy="27" r="7.5" fill="#EDE8DC"/>
  <path d="M38 15 q4 3 0 7 l-1 12 h-2 l-1-12 q-4-4 0-7 Z" fill="#9FB6C4" fill-opacity="0.75"/>
  <rect x="6" y="18" width="6" height="18" rx="1" fill="#F7F4EC" stroke="#C9C2B4"/>
</svg>`;

// Diorite-grey planter silhouettes — one path per family, scaled per size.
const potSpeckle = `<circle cx="19" cy="26" r="0.8" fill="#5A5751"/><circle cx="27" cy="30" r="0.8" fill="#5A5751"/>
  <circle cx="22" cy="34" r="0.8" fill="#5A5751"/><circle cx="29" cy="24" r="0.8" fill="#5A5751"/><circle cx="17" cy="32" r="0.8" fill="#5A5751"/>`;

const harithPot = (tw: number, y0: number) => {
  const y1 = 42;
  const yk = y1 - (y1 - y0) / 3;
  const t = tw / 2;
  const b = t * 0.6;
  return `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M${24 - t} ${y0} L${24 + t} ${y0} L${24 + t} ${yk} L${24 + b} ${y1} L${24 - b} ${y1} L${24 - t} ${yk} Z" fill="#8F8C86" stroke="#6E6B65" stroke-width="1.6"/>
  <ellipse cx="24" cy="${y0}" rx="${t - 2}" ry="2.4" fill="#2E2A24"/>${potSpeckle}
</svg>`;
};

const codyPot = (tw: number, y0: number) => {
  const y1 = 42;
  const t = tw / 2;
  return `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M${24 - t} ${y0} L${24 + t} ${y0} L${24 + t} ${y1 - 12} Q${24 + t} ${y1} 24 ${y1} Q${24 - t} ${y1} ${24 - t} ${y1 - 12} Z" fill="#8F8C86" stroke="#6E6B65" stroke-width="1.6"/>
  <ellipse cx="24" cy="${y0}" rx="${t - 2}" ry="2.4" fill="#2E2A24"/>${potSpeckle}
</svg>`;
};

const jesslynPot = (tw: number, y0: number) => {
  const y1 = 42;
  const t = tw / 2;
  const b = t * 0.45;
  return `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M${24 - t} ${y0} L${24 + t} ${y0} Q${24 + t * 0.72} ${y1 - 8} ${24 + b} ${y1} L${24 - b} ${y1} Q${24 - t * 0.72} ${y1 - 8} ${24 - t} ${y0} Z" fill="#8F8C86" stroke="#6E6B65" stroke-width="1.6"/>
  <ellipse cx="24" cy="${y0}" rx="${t - 2}" ry="2.4" fill="#2E2A24"/>${potSpeckle}
</svg>`;
};

const fernIcon = `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M24 40 q-9 -5 -16 -1 M24 40 q-7 -10 -14 -13 M24 40 q-2 -13 -6 -20 M24 40 q1 -14 4 -21 M24 40 q7 -10 13 -14 M24 40 q9 -5 16 -2" stroke="#3E5A34" stroke-width="2.2" stroke-linecap="round" fill="none"/>
  <ellipse cx="24" cy="41" rx="6" ry="2.2" fill="#2E2A24"/>
</svg>`;

const boxwoodIcon = `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle cx="24" cy="24" r="14" fill="#44543A"/>
  <circle cx="17" cy="19" r="4" fill="#526344"/><circle cx="29" cy="16" r="4.4" fill="#3E5233"/>
  <circle cx="32" cy="26" r="3.8" fill="#526344"/><circle cx="20" cy="30" r="4.4" fill="#3E5233"/>
  <ellipse cx="24" cy="41" rx="6" ry="2.2" fill="#2E2A24"/>
</svg>`;

const snakeIcon = `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M18 41 L16 14 L21 20 Z" fill="#3C5232"/>
  <path d="M24 41 L24 6 L28 14 Z" fill="#59714A"/>
  <path d="M29 41 L33 12 L36 22 Z" fill="#3C5232"/>
  <path d="M13 41 L11 22 L16 28 Z" fill="#59714A"/>
  <ellipse cx="24" cy="41" rx="9" ry="2.2" fill="#2E2A24"/>
</svg>`;

const grassIcon = `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M24 41 q-10 -8 -18 -6 M24 41 q-8 -14 -13 -18 M24 41 q-3 -16 -6 -24 M24 41 q0 -18 2 -26 M24 41 q5 -15 9 -21 M24 41 q9 -11 15 -12 M24 41 q11 -6 17 -3" stroke="#6A7A4A" stroke-width="1.6" stroke-linecap="round" fill="none"/>
  <path d="M24 41 q-6 -13 -10 -16 M24 41 q4 -14 8 -18" stroke="#8A9464" stroke-width="1.4" stroke-linecap="round" fill="none"/>
  <ellipse cx="24" cy="41" rx="7" ry="2.2" fill="#2E2A24"/>
</svg>`;

const oliveIcon = `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M23 42 q1 -12 0 -20 q-0.5 -5 2 -9" stroke="#6E6154" stroke-width="2.6" stroke-linecap="round" fill="none"/>
  <circle cx="26" cy="12" r="8" fill="#7D8A6A"/>
  <circle cx="17" cy="16" r="5.4" fill="#8A967A"/>
  <circle cx="33" cy="18" r="5" fill="#71805E"/>
  <ellipse cx="24" cy="42" rx="6" ry="2.2" fill="#2E2A24"/>
</svg>`;

const mossTreeIcon = `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M24 42 q0.5 -14 0 -26" stroke="#7A7266" stroke-width="2.2" stroke-linecap="round" fill="none"/>
  <circle cx="24" cy="12" r="7" fill="#D9E4CF"/><circle cx="18" cy="15" r="4.5" fill="#C7D6BA"/><circle cx="30" cy="15" r="4.5" fill="#C7D6BA"/>
  <path d="M15 17 q-4 8 -3 17 M19 19 q-2 9 -1 16 M24 19 q0 9 1 15 M29 19 q2 9 1 16 M33 17 q4 8 3 17" stroke="#CFDDC2" stroke-width="1.6" stroke-linecap="round" fill="none"/>
  <ellipse cx="24" cy="42" rx="6" ry="2.2" fill="#2E2A24"/>
</svg>`;

const rosemaryIcon = `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M24 42 q-2 -14 -14 -24 M24 42 q-1 -16 -6 -30 M24 42 q0 -18 3 -34 M24 42 q3 -16 10 -28 M24 42 q4 -12 15 -20" stroke="#9CAB96" stroke-width="1.4" stroke-linecap="round" fill="none"/>
  <g fill="#BFCBB8"><circle cx="12" cy="20" r="1.6"/><circle cx="16" cy="26" r="1.6"/><circle cx="19" cy="14" r="1.6"/><circle cx="21" cy="22" r="1.6"/><circle cx="26" cy="10" r="1.6"/><circle cx="26" cy="20" r="1.6"/><circle cx="31" cy="16" r="1.6"/><circle cx="33" cy="24" r="1.6"/><circle cx="37" cy="21" r="1.6"/><circle cx="29" cy="28" r="1.6"/><circle cx="14" cy="32" r="1.6"/></g>
  <ellipse cx="24" cy="42" rx="6" ry="2.2" fill="#2E2A24"/>
</svg>`;

export const THUMBNAILS: Record<ItemType, string> = {
  table,
  tableSq,
  tableQ,
  tableC: table,
  tableCoffee,
  loungeSofa: lounge(40),
  loungeChair: lounge(22),
  chair,
  clothA: cloth('#F2EBDD'),
  clothB: cloth('#E4D5BB'),
  clothC: cloth('#F5F2E8'),
  lantern18: lantern('#3A3A3A', 0),
  lantern24: lantern('#3A3A3A', 3),
  lantern30: lantern('#3A3A3A', 6),
  lantern36: lantern('#8D8478', 8),
  hedge,
  screen: screenIcon,
  setting,
  figureW,
  figureM,
  planterHarithS: harithPot(26, 18),
  planterCodyM: codyPot(25, 19),
  planterJesslynXXS: jesslynPot(28, 18),
  planterCodyL: codyPot(30, 15),
  planterHarithM: harithPot(32, 12),
  plantFern: fernIcon,
  plantBoxwood: boxwoodIcon,
  plantSnake: snakeIcon,
  plantGrass: grassIcon,
  plantOlive: oliveIcon,
  plantMossTree: mossTreeIcon,
  plantRosemary: rosemaryIcon,
};
