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

export const THUMBNAILS: Record<ItemType, string> = {
  table,
  tableSq,
  tableQ,
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
};
