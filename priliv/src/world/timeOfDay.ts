/** Game clock and lighting keyed to the hour. Pure math so it can be unit-tested. */

/** Real seconds per game hour: a full day lasts 12 minutes. */
export const SECONDS_PER_HOUR = 30;

export interface Lighting {
  /** 0 in full daylight, 1 at deep night. */
  night: number;
  sunIntensity: number;
  sunColor: number;
  hemiIntensity: number;
  skyColor: number;
  groundColor: number;
  fogColor: number;
  /** Sun elevation above the horizon in radians (negative below). */
  sunElevation: number;
  lampsOn: boolean;
}

interface Key {
  h: number;
  sky: number;
  sun: number;
  sunI: number;
  hemiI: number;
  ground: number;
}

// Keyframes around the clock; values are interpolated between neighbours.
const KEYS: Key[] = [
  { h: 0, sky: 0x0b1020, sun: 0x6f86c9, sunI: 0.25, hemiI: 0.28, ground: 0x10131a },
  { h: 5, sky: 0x1a2140, sun: 0x8a8fd0, sunI: 0.3, hemiI: 0.32, ground: 0x151820 },
  { h: 6.5, sky: 0xf2a36b, sun: 0xffb27a, sunI: 1.2, hemiI: 0.6, ground: 0x3d3a2e },
  { h: 9, sky: 0x9cc7ec, sun: 0xfff0d8, sunI: 2.4, hemiI: 0.9, ground: 0x4f5a3a },
  { h: 16, sky: 0x9cc7ec, sun: 0xfff0d8, sunI: 2.4, hemiI: 0.9, ground: 0x4f5a3a },
  { h: 18.5, sky: 0xf08c5a, sun: 0xff9a5c, sunI: 1.3, hemiI: 0.6, ground: 0x3d3326 },
  { h: 20, sky: 0x2a2a52, sun: 0x8a8fd0, sunI: 0.35, hemiI: 0.35, ground: 0x1a1a24 },
  { h: 24, sky: 0x0b1020, sun: 0x6f86c9, sunI: 0.25, hemiI: 0.28, ground: 0x10131a },
];

export function wrapHour(h: number): number {
  return ((h % 24) + 24) % 24;
}

export function lerpColor(a: number, b: number, t: number): number {
  const k = Math.max(0, Math.min(1, t));
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = (b >> 16) & 255;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  const r = Math.round(ar + (br - ar) * k);
  const g = Math.round(ag + (bg - ag) * k);
  const bl = Math.round(ab + (bb - ab) * k);
  return (r << 16) | (g << 8) | bl;
}

/** Night factor: 0 between 7:30 and 17:30, 1 between 21:00 and 4:30, smooth in between. */
export function nightFactor(hour: number): number {
  const h = wrapHour(hour);
  const smooth = (t: number) => t * t * (3 - 2 * t);
  if (h >= 7.5 && h <= 17.5) return 0;
  if (h > 17.5 && h < 21) return smooth((h - 17.5) / 3.5);
  if (h >= 21 || h <= 4.5) return 1;
  return 1 - smooth((h - 4.5) / 3);
}

export function lightingAt(hour: number): Lighting {
  const h = wrapHour(hour);
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1].h <= h) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const t = (h - a.h) / (b.h - a.h);
  const night = nightFactor(h);
  // Sun rises at 6, peaks at 12, sets at 18.
  const sunElevation = Math.sin(((h - 6) / 12) * Math.PI) * (Math.PI / 2.4);
  return {
    night,
    sunIntensity: a.sunI + (b.sunI - a.sunI) * t,
    sunColor: lerpColor(a.sun, b.sun, t),
    hemiIntensity: a.hemiI + (b.hemiI - a.hemiI) * t,
    skyColor: lerpColor(a.sky, b.sky, t),
    groundColor: lerpColor(a.ground, b.ground, t),
    fogColor: lerpColor(a.sky, b.sky, t),
    sunElevation,
    lampsOn: night > 0.35,
  };
}

export function formatClock(hour: number): string {
  const h = wrapHour(hour);
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}
