/**
 * Guns: specs, a magazine-and-reload state machine, and auto-aim. Pure logic,
 * so firing rates, ammo and target choice are tested without the renderer.
 */

export interface WeaponSpec {
  id: string;
  name: string;
  /** Damage to people (they have 100 health). */
  damage: number;
  /** Damage to vehicles per hit. */
  carDamage: number;
  /** Shots per second while the trigger is held. */
  rate: number;
  range: number;
  /** Half-angle of the auto-aim cone, radians. */
  cone: number;
  magazine: number;
  /** Seconds to reload. */
  reload: number;
  price: number;
  /** Price of one magazine of ammo. */
  ammoPrice: number;
  /** Story mission that must be done before the shop sells it. */
  unlock?: string;
}

export const WEAPONS: Record<string, WeaponSpec> = {
  pistol: { id: "pistol", name: "Пистолет", damage: 34, carDamage: 7, rate: 3, range: 45, cone: 0.35, magazine: 12, reload: 1.2, price: 800, ammoPrice: 60 },
  smg: { id: "smg", name: "Пистолет-пулемёт", damage: 20, carDamage: 5, rate: 10, range: 38, cone: 0.3, magazine: 30, reload: 1.8, price: 3000, ammoPrice: 120 },
};

WEAPONS.shotgun = { id: "shotgun", name: "Дробовик", damage: 75, carDamage: 14, rate: 1.3, range: 24, cone: 0.55, magazine: 6, reload: 2.2, price: 5000, ammoPrice: 150, unlock: "ch6-finale" };

export const WEAPON_ORDER = ["pistol", "smg", "shotgun"];

export class Gun {
  /** Rounds in the magazine. */
  mag: number;
  cooldown = 0;
  /** Seconds left of a reload, 0 when not reloading. */
  reloading = 0;

  constructor(
    public spec: WeaponSpec,
    /** Rounds carried outside the magazine; the constructor takes all the ammo and loads from it. */
    public reserve: number,
  ) {
    this.mag = 0;
    this.refill();
  }

  get total(): number {
    return this.mag + this.reserve;
  }

  /** Move rounds from the reserve into the magazine. */
  private refill(): void {
    const take = Math.min(this.spec.magazine - this.mag, this.reserve);
    this.mag += take;
    this.reserve -= take;
  }

  startReload(): boolean {
    if (this.reloading > 0 || this.mag >= this.spec.magazine || this.reserve <= 0) return false;
    this.reloading = this.spec.reload;
    return true;
  }

  /**
   * Advance time with the trigger held or not; returns how many shots fired
   * this step. An empty magazine starts a reload by itself.
   */
  update(dt: number, trigger: boolean): number {
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        this.reloading = 0;
        this.refill();
      }
      return 0;
    }
    if (!trigger) return 0;
    let shots = 0;
    while (this.cooldown <= 0 && this.mag > 0) {
      this.mag--;
      shots++;
      this.cooldown += 1 / this.spec.rate;
    }
    if (this.mag === 0) this.startReload();
    return shots;
  }
}

export interface AimCandidate {
  id: number;
  x: number;
  z: number;
}

function wrap(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * The best target in front of the shooter: inside range and the aim cone,
 * with a clear line, preferring what is near the centre and close by.
 */
export function pickTarget<T extends AimCandidate>(
  ox: number,
  oz: number,
  heading: number,
  candidates: T[],
  range: number,
  cone: number,
  clear: (x: number, z: number) => boolean = () => true,
): T | null {
  let best: T | null = null;
  let bestScore = Infinity;
  for (const c of candidates) {
    const d = Math.hypot(c.x - ox, c.z - oz);
    if (d > range || d < 0.3) continue;
    const off = Math.abs(wrap(Math.atan2(c.z - oz, c.x - ox) - heading));
    if (off > cone) continue;
    const score = off / cone + d / range;
    if (score < bestScore && clear(c.x, c.z)) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}

/** Hit chance falls off with distance; close shots nearly always land. */
export function hitChance(distance: number, range: number): number {
  return Math.max(0.35, 1 - (distance / range) * 0.55);
}
