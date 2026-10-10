/** The exposure the raster view is actually using (EV100, compensation
 * applied). With Auto EV it differs from SkyState.ev100 by where the camera
 * is (inside the hall at night the track lights set the exposure, not the
 * sky), so Photo mode / exports that want "what I see" read it here. */

let current: number | null = null;
const subs = new Set<(ev100: number) => void>();

export function getViewEV100(): number | null {
  return current;
}

export function setViewEV100(ev100: number): void {
  if (current !== null && Math.abs(current - ev100) < 1e-4) return;
  current = ev100;
  for (const fn of subs) fn(ev100);
}

export function subscribeViewEV100(fn: (ev100: number) => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}
