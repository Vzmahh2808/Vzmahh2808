export type Crime = "hitPed" | "carjack" | "stealCop" | "ramCop" | "hitCop" | "explosion" | "killCop";

export const CRIME_HEAT: Record<Crime, number> = {
  hitPed: 1,
  carjack: 1.5,
  stealCop: 6,
  ramCop: 3,
  hitCop: 5,
  explosion: 5,
  killCop: 12,
};

/** Heat needed for 1..5 stars. */
export const STAR_HEAT = [1, 4, 10, 20, 35];
export const MAX_STARS = 5;

export function starsFor(heat: number): number {
  let s = 0;
  for (const t of STAR_HEAT) if (heat >= t) s++;
  return s;
}

/** Seconds out of police sight needed to shake off `level` stars. */
export function evadeTime(level: number): number {
  return 10 + level * 5;
}

/**
 * Wanted level. Stars only ever go up from crimes; they drop to zero when the
 * player stays out of sight long enough, dies, or is arrested.
 */
export class Wanted {
  heat = 0;
  level = 0;
  unseen = 0;

  get searching(): boolean {
    return this.level > 0 && this.unseen > 1.5;
  }

  /** Commit a crime; returns true when the star count went up. */
  add(crime: Crime): boolean {
    this.heat += CRIME_HEAT[crime];
    const next = Math.max(this.level, starsFor(this.heat));
    const up = next > this.level;
    this.level = next;
    this.unseen = 0;
    return up;
  }

  /** Force at least `stars` stars (debug and scripted events). */
  atLeast(stars: number): void {
    const s = Math.min(MAX_STARS, stars);
    if (s <= this.level) return;
    this.heat = Math.max(this.heat, STAR_HEAT[s - 1]);
    this.level = s;
    this.unseen = 0;
  }

  /** Advance the escape timer. Returns true on the frame the player escapes. */
  update(dt: number, seen: boolean): boolean {
    if (this.level === 0) return false;
    if (seen) {
      this.unseen = 0;
      return false;
    }
    this.unseen += dt;
    if (this.unseen >= evadeTime(this.level)) {
      this.clear();
      return true;
    }
    return false;
  }

  /** Fraction of the escape timer elapsed, for the HUD. */
  escapeProgress(): number {
    return this.level === 0 ? 0 : Math.min(1, this.unseen / evadeTime(this.level));
  }

  clear(): void {
    this.heat = 0;
    this.level = 0;
    this.unseen = 0;
  }
}
