/** Which failed jobs may be started again on the spot. */

/** Jobs that cost money to enter or change the world when started (races with an entry fee, taxi fares) are not offered again. */
export function canRetry(missionId: string, isStreetRace: boolean, isTaxi: boolean): boolean {
  if (isStreetRace || isTaxi) return false;
  if (missionId === "taxi") return false;
  return true;
}

/** How long the "try again" card stays on screen, in seconds. */
export const RETRY_TIME = 20;
