/**
 * Ramps and the vertical part of driving. The car model is flat; this adds a
 * height above the ground so cars can climb a ramp, leave its lip and fly.
 */

export interface Ramp {
  id: string;
  name: string;
  /** Foot of the ramp, centre of its low edge. */
  x: number;
  z: number;
  /** Direction the ramp climbs, radians. */
  heading: number;
  length: number;
  width: number;
  height: number;
  /** Distance in metres from the lip a unique jump must clear. */
  goal: number;
}

export interface Air {
  /** Height of the car above the ground. */
  y: number;
  vy: number;
  airborne: boolean;
  /** Vertical speed while climbing a ramp, carried into the launch. */
  climb: number;
  /** Ramp the car is on or was launched from. */
  ramp: Ramp | null;
}

export const GRAVITY = 11;
/** Extra lift at the lip, so a jump feels like a jump. */
export const LIP_KICK = 1.5;

export function freshAir(): Air {
  return { y: 0, vy: 0, airborne: false, climb: 0, ramp: null };
}

/** Height of a ramp's surface at (x, z), or null off its footprint. */
export function rampHeight(r: Ramp, x: number, z: number): number | null {
  const fx = Math.cos(r.heading);
  const fz = Math.sin(r.heading);
  const dx = x - r.x;
  const dz = z - r.z;
  const u = dx * fx + dz * fz;
  const v = -dx * fz + dz * fx;
  if (u < 0 || u > r.length || Math.abs(v) > r.width / 2) return null;
  return (u / r.length) * r.height;
}

/** Highest ramp surface under (x, z); 0 when there is none. */
export function surfaceAt(ramps: Ramp[], x: number, z: number): { h: number; ramp: Ramp | null } {
  let h = 0;
  let ramp: Ramp | null = null;
  for (const r of ramps) {
    const y = rampHeight(r, x, z);
    if (y !== null && y >= h) {
      h = y;
      ramp = r;
    }
  }
  return { h, ramp };
}

export type VerticalEvent = { type: "launch"; ramp: Ramp | null } | { type: "land"; impact: number } | { type: "blocked" };

/**
 * Follow the ground or fly. Call after the car moved horizontally. On the
 * ground the car sits on the surface; when the surface drops away under a car
 * that was climbing (the lip of a ramp) it takes off with its climb rate.
 */
export function stepVertical(air: Air, x: number, z: number, ramps: Ramp[], dt: number): VerticalEvent | null {
  const under = surfaceAt(ramps, x, z);
  if (!air.airborne) {
    // Driving into the tall end or the side of a ramp: it is a wall, not a step.
    if (under.h - air.y > 0.5) return { type: "blocked" };
    if (air.y - under.h > 0.12) {
      air.airborne = true;
      air.vy = Math.max(0, air.climb) + (air.climb > 0.5 ? LIP_KICK : 0);
      air.climb = 0;
      return { type: "launch", ramp: air.ramp };
    }
    air.climb = dt > 0 ? (under.h - air.y) / dt : 0;
    air.y = under.h;
    air.ramp = under.ramp;
    return null;
  }
  air.vy -= GRAVITY * dt;
  air.y += air.vy * dt;
  if (air.y <= under.h) {
    const impact = Math.max(0, -air.vy);
    air.y = under.h;
    air.vy = 0;
    air.airborne = false;
    air.climb = 0;
    air.ramp = under.ramp;
    return { type: "land", impact };
  }
  return null;
}

/** Damage from a landing: soft ones are free, flat drops off a tall jump hurt. */
export function landingDamage(impact: number, misaligned: boolean): number {
  const base = impact < 9 ? 0 : (impact - 9) * 4;
  return misaligned ? base + 15 : base;
}
