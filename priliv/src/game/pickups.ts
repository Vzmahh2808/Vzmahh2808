/**
 * Cash that falls from people the player knocks down: bills lie on the ground
 * for a while and are picked up by walking or driving over them. Pure logic.
 */

export interface Drop {
  x: number;
  z: number;
  amount: number;
  /** Seconds left before the bill blows away. */
  ttl: number;
}

export const DROP_LIFE = 40;
export const DROP_RADIUS = 1.9;
/** The most bills lying around at once; the oldest goes first. */
export const DROP_MAX = 16;

export class Drops {
  list: Drop[] = [];

  add(x: number, z: number, amount: number): Drop {
    const d: Drop = { x, z, amount, ttl: DROP_LIFE };
    this.list.push(d);
    while (this.list.length > DROP_MAX) this.list.shift();
    return d;
  }

  /** Age the bills and pick up any the player stands on; returns the money collected and the picked-up bills. */
  step(px: number, pz: number, dt: number): { money: number; taken: Drop[]; gone: Drop[] } {
    let money = 0;
    const taken: Drop[] = [];
    const gone: Drop[] = [];
    this.list = this.list.filter((d) => {
      d.ttl -= dt;
      if (Math.hypot(d.x - px, d.z - pz) < DROP_RADIUS) {
        money += d.amount;
        taken.push(d);
        return false;
      }
      if (d.ttl <= 0) {
        gone.push(d);
        return false;
      }
      return true;
    });
    return { money, taken, gone };
  }
}

/** How much a person drops, or 0 for nothing. */
export function dropAmount(roll: number, amountRoll: number): number {
  if (roll > 0.6) return 0;
  return 10 + Math.floor(amountRoll * 5) * 10;
}
