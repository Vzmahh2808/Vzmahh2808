/**
 * When ads may show. A rewarded ad is the player's choice and needs only a
 * short breather; a full-screen ad comes only at a natural break (the
 * championship hub after a match), never in the first minutes of a session and
 * never close together. Pure logic, times in seconds.
 */

/** No full-screen ad in the first minutes of a session. */
export const SESSION_GRACE = 180;
/** Seconds between any two ads before a full-screen one may show. */
export const INTERSTITIAL_GAP = 120;
/** Seconds between rewarded ads. */
export const REWARD_GAP = 90;
/** Rating points a rewarded "boost" adds to every skill for one match. */
export const BOOST_POINTS = 6;

export class AdPolicy {
  /** Session time of the last ad of any kind. */
  lastAd = -Infinity;
  private lastReward = -Infinity;

  interstitialAllowed(t: number): boolean {
    return t >= SESSION_GRACE && t - this.lastAd >= INTERSTITIAL_GAP;
  }

  rewardAllowed(t: number): boolean {
    return t - this.lastReward >= REWARD_GAP;
  }

  noteAd(t: number, rewarded = false): void {
    this.lastAd = t;
    if (rewarded) this.lastReward = t;
  }
}

/** Ratings with the boost applied, capped at 99. */
export function boosted<T extends { off: number; def: number; gk: number; spd: number }>(r: T): T {
  const up = (v: number) => Math.min(99, v + BOOST_POINTS);
  return { ...r, off: up(r.off), def: up(r.def), gk: up(r.gk), spd: up(r.spd) };
}
