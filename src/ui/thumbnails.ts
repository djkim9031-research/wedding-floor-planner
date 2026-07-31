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

export const THUMBNAILS: Record<ItemType, string> = {
  table,
  tableSq,
  tableQ,
  chair,
  clothA: cloth('#F2EBDD'),
  clothB: cloth('#E4D5BB'),
  figureW,
  figureM,
};
