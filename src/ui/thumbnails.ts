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

const figure = `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle cx="24" cy="12" r="5.5" fill="#4A443D"/>
  <path d="M15 44 L16.5 26 Q17 20 24 20 Q31 20 31.5 26 L33 44 Z" fill="#4A443D"/>
</svg>`;

export const THUMBNAILS: Record<ItemType, string> = {
  table,
  tableSq,
  tableQ,
  clothA: cloth('#F2EBDD'),
  clothB: cloth('#E4D5BB'),
  figure,
};
