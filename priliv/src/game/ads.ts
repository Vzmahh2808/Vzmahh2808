/**
 * When ads may show. Rewarded ads are the player's choice and only need a
 * short breather between them; full-screen ads come only at natural breaks
 * (a failed mission, a respawn), never in the first minutes of a session and
 * never close together. Pure logic, times in seconds.
 */

/** No full-screen ad in the first minutes of a session. */
export const SESSION_GRACE = 180;
/** Seconds between any two ads before a full-screen one may show. */
export const INTERSTITIAL_GAP = 120;
/** Seconds an offer ("double the reward", "continue here") stays up. */
export const OFFER_TIME = 8;
/** The most a doubled mission reward may add. */
export const DOUBLE_CAP = 3000;

export class AdPolicy {
  /** Session time of the last ad of any kind. */
  lastAd = -Infinity;

  interstitialAllowed(t: number): boolean {
    return t >= SESSION_GRACE && t - this.lastAd >= INTERSTITIAL_GAP;
  }

  noteAd(t: number): void {
    this.lastAd = t;
  }
}

/** Extra money offered for watching an ad after a mission; 0 means no offer. */
export function doubleBonus(missionId: string, reward: number): number {
  if (reward <= 0 || missionId === "taxi") return 0;
  return Math.min(DOUBLE_CAP, reward);
}

/** Deaths where carrying on from the same spot makes sense (not under water). */
export function revivable(title: string): boolean {
  return title !== "Вы утонули" && title !== "Катер затонул";
}

/**
 * Watches the frame rate in "auto" quality and asks for lower settings once
 * if the game stays under `min` FPS for `window` seconds after a warm-up.
 */
export class FpsWatch {
  private time = 0;
  private acc = 0;
  private frames = 0;
  fired = false;

  constructor(
    private min = 28,
    private window = 5,
    private warmup = 4,
  ) {}

  /** Feed one frame's wall-clock seconds; true once when it is time to downgrade. */
  frame(dt: number): boolean {
    if (this.fired || dt <= 0) return false;
    this.time += dt;
    if (this.time < this.warmup) return false;
    this.acc += dt;
    this.frames++;
    if (this.acc < this.window) return false;
    const fps = this.frames / this.acc;
    this.acc = 0;
    this.frames = 0;
    if (fps >= this.min) return false;
    this.fired = true;
    return true;
  }
}
