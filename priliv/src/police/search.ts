/**
 * How the police look for someone they cannot see. While they have eyes on the
 * player they chase the real position; once the player has been out of sight
 * for a couple of seconds they head for the last place he was seen instead of
 * knowing where he is. Pure logic, tested without the game.
 */

export interface Target {
  x: number;
  z: number;
  vx: number;
  vz: number;
}

/** Seconds the police keep tracking the true position after losing sight. */
export const SIGHT_MEMORY = 2;

/** Where pursuing units should drive: the player if seen recently, else the last known spot. */
export function pursuitTarget(actual: Target, lastKnown: { x: number; z: number }, unseen: number): Target {
  if (unseen < SIGHT_MEMORY) return actual;
  return { x: lastKnown.x, z: lastKnown.z, vx: 0, vz: 0 };
}

/** Whether a cop on foot has lost interest: far away and no sight of the player for a while. */
export function copGivesUp(distance: number, unseen: number): boolean {
  return distance > 20 && unseen > 4;
}

/** Reinforcements are only called in while the player is still being watched. */
export function mayReinforce(unseen: number): boolean {
  return unseen < 3;
}
