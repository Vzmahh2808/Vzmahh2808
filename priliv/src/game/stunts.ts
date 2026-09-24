/**
 * Unique stunt jumps and scoring. Ramps stand on traffic-free island roads and
 * on the bridge; each one has a distance to clear for its one-off bonus.
 */
import type { Ramp } from "../entities/jumps";
import type { Point } from "./missions";

const R = { length: 11, width: 7, height: 2 };

export const RAMPS: Ramp[] = [
  { id: "bridge", name: "Прыжок по мосту", x: 290, z: 0, heading: 0, ...R, width: 8, goal: 45 },
  { id: "north", name: "Северное кольцо", x: 540, z: 108, heading: 0, ...R, goal: 35 },
  { id: "south", name: "Южное кольцо", x: 500, z: -108, heading: Math.PI, ...R, goal: 35 },
  { id: "west", name: "Западное кольцо", x: 412, z: 40, heading: -Math.PI / 2, ...R, goal: 35 },
  { id: "east", name: "Восточное кольцо", x: 628, z: -40, heading: Math.PI / 2, ...R, goal: 35 },
];

export const STUNT_REWARD = 500;
export const ALL_STUNTS_BONUS = 2500;

/** Where the lip of a ramp is: the unique-jump distance is measured from here. */
export function lipOf(r: Ramp): Point {
  return { x: r.x + Math.cos(r.heading) * r.length, z: r.z + Math.sin(r.heading) * r.length };
}

export interface Jump {
  ramp: Ramp | null;
  from: Point;
  time: number;
  maxHeight: number;
  /** Yaw turned in the air, radians, absolute. */
  spin: number;
  lastHeading: number;
}

export function startJump(ramp: Ramp | null, x: number, z: number, heading: number): Jump {
  return { ramp, from: ramp ? lipOf(ramp) : { x, z }, time: 0, maxHeight: 0, spin: 0, lastHeading: heading };
}

export function trackJump(j: Jump, dt: number, height: number, heading: number): void {
  j.time += dt;
  j.maxHeight = Math.max(j.maxHeight, height);
  let d = heading - j.lastHeading;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  j.spin += Math.abs(d);
  j.lastHeading = heading;
}

export interface JumpResult {
  distance: number;
  time: number;
  height: number;
  /** Whole turns, a little generous: 330 degrees counts as a full turn. */
  turns: number;
  score: number;
  clean: boolean;
  /** Cleared the ramp's unique-jump distance and landed clean. */
  unique: boolean;
}

export function finishJump(j: Jump, x: number, z: number, clean: boolean): JumpResult {
  const distance = Math.hypot(x - j.from.x, z - j.from.z);
  const turns = Math.floor((j.spin + 0.5) / (Math.PI * 2));
  const score = clean ? Math.round(distance * 10 + j.time * 150 + j.maxHeight * 40 + turns * 500) : 0;
  const unique = clean && !!j.ramp && distance >= j.ramp.goal;
  return { distance, time: j.time, height: j.maxHeight, turns, score, clean, unique };
}

export function describeJump(r: JumpResult): string {
  const parts = [`${Math.round(r.distance)} м`, `${r.time.toFixed(1)} с`];
  if (r.turns > 0) parts.push(`${r.turns * 360}°`);
  return parts.join(" · ");
}

/** A landing is clean when the car comes down roughly facing where it flies. */
export function isCleanLanding(heading: number, vx: number, vz: number, impact: number): boolean {
  const speed = Math.hypot(vx, vz);
  if (impact > 16) return false;
  if (speed < 3) return true;
  let d = Math.atan2(vz, vx) - heading;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d) < 0.8;
}
