/**
 * Gang members on foot. A thug stands guard until he sees the player or hears
 * gunfire, then runs in to shooting range, stops when close and shoots at a
 * steady, slightly random pace. Pure logic, so it is tested without the game.
 */
import { hitChance } from "../game/weapons";

export interface ThugBrain {
  alerted: boolean;
  /** Seconds until the next shot. */
  fireTimer: number;
}

/** Spots the player at this distance with a clear line. */
export const THUG_SIGHT = 32;
/** Opens fire inside this distance. */
export const THUG_FIRE_RANGE = 26;
/** Stops walking in this close. */
export const THUG_STAND = 13;
export const THUG_RUN = 5.8;
export const THUG_WALK = 2.2;

export interface ThugIntent {
  /** Walking speed, m/s. */
  speed: number;
  /** Direction to face, or null to keep the current one. */
  heading: number | null;
  fire: boolean;
}

export function freshBrain(alerted = false): ThugBrain {
  return { alerted, fireTimer: alerted ? 0.8 : 0 };
}

/**
 * One step of a thug's decision. `los` is a clear line to the target, `noise`
 * true when shots were fired nearby, `rand` a 0..1 random source.
 */
export function thugIntent(b: ThugBrain, x: number, z: number, tx: number, tz: number, los: boolean, noise: boolean, dt: number, rand: () => number): ThugIntent {
  const d = Math.hypot(tx - x, tz - z);
  if (!b.alerted) {
    if (!((los && d < THUG_SIGHT) || noise)) return { speed: 0, heading: null, fire: false };
    b.alerted = true;
    // A moment to react before the first shot.
    b.fireTimer = 0.6 + rand() * 0.6;
  }
  const heading = Math.atan2(tz - z, tx - x);
  if (!los || d > THUG_FIRE_RANGE) {
    b.fireTimer = Math.max(b.fireTimer, 0.4);
    return { speed: THUG_RUN, heading, fire: false };
  }
  b.fireTimer -= dt;
  const speed = d > THUG_STAND ? THUG_WALK : 0;
  if (b.fireTimer > 0) return { speed, heading, fire: false };
  b.fireTimer = 0.8 + rand() * 0.7;
  return { speed, heading, fire: true };
}

/** Chance an enemy shot lands: worse than the player's aim, and worse again at range. */
export function enemyHitChance(distance: number): number {
  return hitChance(distance, 30) * 0.55;
}
