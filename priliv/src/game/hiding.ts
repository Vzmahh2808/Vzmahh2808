/**
 * Hiding underground with a shovel. Digging takes a few seconds and only works
 * where the ground can be dug and nobody is close by; once in the hole the
 * police cannot see the player unless one of them walks right up to it. The
 * air lasts a limited time. Pure logic, so the rules are tested without the game.
 */

/** Seconds of digging before the player is under. */
export const DIG_TIME = 2.5;
/** Seconds the air lasts underground. */
export const AIR_TIME = 45;
/** Nobody on the force may be closer than this to start a hole. */
export const DIG_CLEARANCE = 18;
/** A cop this close to the hole finds the player. */
export const FIND_RADIUS = 5;

export type DigVerdict = "ok" | "road" | "water" | "moving" | "watched" | "mission";

/**
 * Whether the player may dig here right now. `nearestPolice` is the distance to
 * the closest cop or police car, and `busy` a running mission that is not an
 * escape (hiding out would just skip it).
 */
export function canDig(ground: "asphalt" | "pavement" | "grass" | "water" | "other", speed: number, nearestPolice: number, busy: boolean): DigVerdict {
  if (busy) return "mission";
  if (ground === "water" || ground === "other") return "water";
  if (ground === "asphalt") return "road";
  if (speed > 0.8) return "moving";
  if (nearestPolice < DIG_CLEARANCE) return "watched";
  return "ok";
}

export const DIG_MESSAGES: Record<Exclude<DigVerdict, "ok">, string> = {
  road: "Асфальт лопатой не взять. Копайте на тротуаре или траве",
  water: "Здесь не покопать",
  moving: "Встаньте на месте и держите G",
  watched: "Слишком близко к полиции: заметят",
  mission: "Сейчас не до этого: задание идёт",
};

export interface Hole {
  /** Where the hole is. */
  x: number;
  z: number;
  /** Seconds of digging done, 0..DIG_TIME. */
  dig: number;
  /** Underground now. */
  hidden: boolean;
  /** Seconds of air left while hidden. */
  air: number;
}

export function freshHole(): Hole {
  return { x: 0, z: 0, dig: 0, hidden: false, air: 0 };
}

export type HoleEvent = "dug" | "out-of-air" | "found" | null;

/**
 * Advance the hole by `dt`. While the dig key is held on valid ground the dig
 * progresses; releasing it fills the progress back. Once hidden the air runs
 * down and a cop within FIND_RADIUS of the hole finds the player.
 */
export function stepHole(h: Hole, dt: number, digging: boolean, nearestPolice: number): HoleEvent {
  if (h.hidden) {
    h.air -= dt;
    if (nearestPolice < FIND_RADIUS) {
      h.hidden = false;
      return "found";
    }
    if (h.air <= 0) {
      h.hidden = false;
      h.air = 0;
      return "out-of-air";
    }
    return null;
  }
  if (!digging) {
    h.dig = Math.max(0, h.dig - dt * 2);
    return null;
  }
  h.dig += dt;
  if (h.dig >= DIG_TIME) {
    h.dig = 0;
    h.hidden = true;
    h.air = AIR_TIME;
    return "dug";
  }
  return null;
}

/** Climb out on purpose. */
export function climbOut(h: Hole): void {
  h.hidden = false;
  h.dig = 0;
}
