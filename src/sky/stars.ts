/** Star field for the night sky: the bright named stars (so the familiar
 * patterns rise and set in the right places) plus a seeded scatter of faint
 * ones down to ~6th magnitude. Equatorial J2000 coordinates. */

export interface Star {
  /** right ascension, hours */
  ra: number;
  /** declination, degrees */
  dec: number;
  mag: number;
  /** linear Rec.709 tint, luminance ≈ 1 */
  rgb: [number, number, number];
}

// [RA h, Dec °, V mag, B−V]
const BRIGHT: [number, number, number, number][] = [
  [6.752, -16.716, -1.46, 0.0], // Sirius
  [14.261, 19.182, -0.05, 1.23], // Arcturus
  [18.616, 38.784, 0.03, 0.0], // Vega
  [5.278, 45.998, 0.08, 0.8], // Capella
  [5.242, -8.202, 0.13, -0.03], // Rigel
  [7.655, 5.225, 0.34, 0.42], // Procyon
  [5.919, 7.407, 0.5, 1.85], // Betelgeuse
  [19.846, 8.868, 0.77, 0.22], // Altair
  [4.599, 16.509, 0.85, 1.54], // Aldebaran
  [16.49, -26.432, 0.96, 1.83], // Antares
  [13.42, -11.161, 0.97, -0.23], // Spica
  [7.755, 28.026, 1.14, 1.0], // Pollux
  [22.961, -29.622, 1.16, 0.09], // Fomalhaut
  [20.69, 45.28, 1.25, 0.09], // Deneb
  [10.139, 11.967, 1.35, -0.11], // Regulus
  [6.977, -28.972, 1.5, -0.21], // Adhara
  [7.577, 31.888, 1.58, 0.03], // Castor
  [17.56, -37.104, 1.62, -0.22], // Shaula
  [5.419, 6.35, 1.64, -0.22], // Bellatrix
  [5.438, 28.608, 1.65, -0.13], // Elnath
  [5.604, -1.202, 1.69, -0.18], // Alnilam
  [5.679, -1.943, 1.74, -0.21], // Alnitak
  [5.533, -0.299, 2.23, -0.22], // Mintaka
  [5.796, -9.67, 2.09, -0.17], // Saiph
  [12.9, 55.96, 1.76, -0.02], // Alioth
  [3.405, 49.861, 1.79, 0.48], // Mirfak
  [11.062, 61.751, 1.79, 1.07], // Dubhe
  [7.14, -26.393, 1.83, 0.68], // Wezen
  [13.792, 49.313, 1.85, -0.1], // Alkaid
  [18.403, -34.385, 1.85, -0.03], // Kaus Australis
  [5.992, 44.947, 1.9, 0.08], // Menkalinan
  [6.628, 16.399, 1.93, 0.0], // Alhena
  [9.46, -8.659, 1.98, 1.44], // Alphard
  [6.378, -17.956, 1.98, -0.24], // Mirzam
  [2.53, 89.264, 1.98, 0.6], // Polaris
  [2.12, 23.462, 2.0, 1.15], // Hamal
  [0.727, -17.987, 2.04, 1.02], // Diphda
  [18.921, -26.297, 2.05, -0.13], // Nunki
  [1.162, 35.621, 2.05, 1.58], // Mirach
  [0.14, 29.091, 2.06, -0.11], // Alpheratz
  [17.582, 12.56, 2.08, 0.15], // Rasalhague
  [14.845, 74.156, 2.08, 1.47], // Kochab
  [2.065, 42.33, 2.1, 1.37], // Almach
  [3.136, 40.956, 2.12, -0.05], // Algol
  [11.818, 14.572, 2.14, 0.09], // Denebola
  [13.399, 54.925, 2.23, 0.02], // Mizar
  [17.943, 51.489, 2.23, 1.52], // Eltanin
  [20.37, 40.257, 2.23, 0.67], // Sadr
  [0.675, 56.537, 2.24, 1.17], // Schedar
  [0.153, 59.15, 2.28, 0.34], // Caph
  [16.006, -22.622, 2.29, -0.12], // Dschubba
  [11.031, 56.383, 2.37, 0.03], // Merak
  [21.736, 9.875, 2.39, 1.52], // Enif
  [23.063, 28.083, 2.42, 1.67], // Scheat
  [11.897, 53.695, 2.44, 0.04], // Phecda
  [0.945, 60.717, 2.47, -0.15], // Gamma Cas
  [23.08, 15.205, 2.49, 0.0], // Markab
  [3.038, 4.09, 2.54, 1.64], // Menkar
  [12.263, -17.542, 2.59, -0.11], // Gienah
  [15.283, -9.383, 2.61, -0.11], // Zubeneschamali
  [15.738, 6.426, 2.63, 1.17], // Unukalhai
  [1.43, 60.235, 2.68, 0.13], // Ruchbah
  [0.221, 15.184, 2.83, -0.23], // Algenib
  [19.512, 27.96, 3.08, 1.13], // Albireo
  [12.257, 57.033, 3.31, 0.08], // Megrez
  [1.907, 63.67, 3.37, -0.15], // Segin
  [3.791, 24.105, 2.87, -0.09], // Alcyone (Pleiades)
];

function tint(bv: number): [number, number, number] {
  // B−V → a gentle linear tint (blue-white … orange), luminance ≈ 1
  const t = Math.min(Math.max((bv + 0.3) / 2.1, 0), 1);
  const r = 0.78 + 0.32 * t;
  const g = 0.9 + 0.05 * t - 0.12 * t * t;
  const b = 1.25 - 0.8 * t;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return [r / y, g / y, b / y];
}

function build(): Star[] {
  const stars: Star[] = BRIGHT.map(([ra, dec, mag, bv]) => ({ ra, dec, mag, rgb: tint(bv) }));
  let seed = 0x5ea5eed;
  const rnd = () => {
    seed = (seed * 48271) % 2147483647;
    return seed / 2147483647;
  };
  // faint scatter: N(<m) ∝ 10^(0.5 m) → m = mMax + 2·log10(u)
  for (let i = 0; i < 3200; i++) {
    const ra = rnd() * 24;
    const dec = (Math.asin(2 * rnd() - 1) * 180) / Math.PI;
    const mag = Math.max(2.9, 6.2 + 2 * Math.log10(Math.max(rnd(), 1e-4)));
    const bv = -0.2 + 1.8 * rnd() * rnd();
    stars.push({ ra, dec, mag, rgb: tint(bv) });
  }
  return stars;
}

export const STAR_CATALOG: Star[] = build();
