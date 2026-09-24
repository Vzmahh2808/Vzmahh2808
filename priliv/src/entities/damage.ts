import type { CarState } from "./carPhysics";

export const BURN_TIME = 6;
export const CAR_BLAST_RADIUS = 13;
export const CAR_BLAST_POWER = 110;

export type Condition = "ok" | "smoking" | "heavy" | "burning" | "wrecked";

export function conditionOf(c: CarState): Condition {
  if (c.wrecked) return "wrecked";
  if (c.burning) return "burning";
  if (c.health < 30) return "heavy";
  if (c.health < 60) return "smoking";
  return "ok";
}

/**
 * Advance fire state. Returns "ignite" on the frame a car catches fire and
 * "explode" on the frame it blows up; null otherwise.
 */
export function stepDamage(c: CarState, dt: number): "ignite" | "explode" | null {
  if (c.wrecked) return null;
  if (c.health > 0) return null;
  c.health = 0;
  if (!c.burning) {
    c.burning = true;
    c.fire = BURN_TIME;
    return "ignite";
  }
  c.fire -= dt;
  if (c.fire <= 0) {
    c.fire = 0;
    c.burning = false;
    c.wrecked = true;
    return "explode";
  }
  return null;
}

/** Linear falloff blast damage. */
export function blastDamage(dist: number, radius: number, power: number): number {
  if (dist >= radius) return 0;
  return power * (1 - dist / radius);
}

/** Apply an explosion at (x, z) to a car: damage plus an outward shove. Returns damage dealt. */
export function applyBlastToCar(c: CarState, x: number, z: number, radius = CAR_BLAST_RADIUS, power = CAR_BLAST_POWER): number {
  const dx = c.x - x;
  const dz = c.z - z;
  const d = Math.hypot(dx, dz);
  const dmg = blastDamage(d, radius, power);
  if (dmg <= 0) return 0;
  const nx = d > 0.01 ? dx / d : 1;
  const nz = d > 0.01 ? dz / d : 0;
  c.vx += nx * dmg * 0.18;
  c.vz += nz * dmg * 0.18;
  if (!c.wrecked) c.health = Math.max(0, c.health - dmg);
  return dmg;
}
