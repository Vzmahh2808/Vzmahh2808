import { PITCH, resolveCircleVsBuildings, roadCoord, type CityLayout } from "../world/city";
import { forwardSpeed, speedOf, type CarInput, type CarState } from "../entities/carPhysics";
import { RESORT, SOUTH_BRIDGE } from "../world/island";

export type PoliceMode = "patrol" | "pursuit" | "roadblock";

export interface PoliceUnit {
  mode: PoliceMode;
  /** Next intersection on the route while the target is out of reach. */
  node: { ix: number; iz: number } | null;
  stuck: number;
  reverse: number;
  reverseSteer: number;
  /** Seconds this unit has had eyes on the player (for dropping a cop off). */
  engaged: number;
  copOut: boolean;
  /** Next junction on the resort's small street grid, while chasing over there. */
  rnode: { ix: number; iz: number; arrived?: boolean } | null;
}

export function makeUnit(mode: PoliceMode): PoliceUnit {
  return { mode, node: null, stuck: 0, reverse: 0, reverseSteer: 1, engaged: 0, copOut: false, rnode: null };
}

export interface GridNode {
  ix: number;
  iz: number;
}

export function nearestIntersection(n: number, x: number, z: number): GridNode {
  const clamp = (v: number) => Math.max(0, Math.min(n, v));
  return { ix: clamp(Math.round(x / PITCH + n / 2)), iz: clamp(Math.round(z / PITCH + n / 2)) };
}

/** One grid step from `from` toward `to`, along the axis with the larger gap. */
export function stepToward(from: GridNode, to: GridNode): GridNode {
  const dx = to.ix - from.ix;
  const dz = to.iz - from.iz;
  if (dx === 0 && dz === 0) return from;
  if (Math.abs(dx) >= Math.abs(dz)) return { ix: from.ix + Math.sign(dx), iz: from.iz };
  return { ix: from.ix, iz: from.iz + Math.sign(dz) };
}

/** Straight-line visibility between two ground points, sampled every `step` metres against buildings. */
export function lineOfSight(layout: CityLayout, ax: number, az: number, bx: number, bz: number, step = 3): boolean {
  const d = Math.hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.ceil(d / step));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (resolveCircleVsBuildings(layout, ax + (bx - ax) * t, az + (bz - az) * t, 0.05)) return false;
  }
  return true;
}

export interface Target {
  x: number;
  z: number;
  vx: number;
  vz: number;
}

const CHASE_RANGE = 45;

/** Where the south bridge lands on the resort: the way in for anyone coming from the city. */
export const RESORT_GATE = { x: (SOUTH_BRIDGE.x0 + SOUTH_BRIDGE.x1) / 2, z: RESORT.z0 + 14 };

/** Junctions of the resort's streets: the boulevard and both ring roads against the three cross streets. */
const RESORT_X = [-168, 0, 168];
const RESORT_Z = [490, 580, 650];

function nearestIndex(values: number[], v: number): number {
  let best = 0;
  for (let i = 1; i < values.length; i++) if (Math.abs(values[i] - v) < Math.abs(values[best] - v)) best = i;
  return best;
}

/** Where a chaser on the resort should head next when the target is out of sight. */
export function resortAim(car: { x: number; z: number }, target: { x: number; z: number }, unit: { rnode: { ix: number; iz: number; arrived?: boolean } | null }): { x: number; z: number } {
  // The first stretch after the bridge has no side streets: run down the boulevard to the first crossing.
  if (car.z < RESORT_Z[0] - 12) return { x: 0, z: RESORT_Z[0] };
  const goal = { ix: nearestIndex(RESORT_X, target.x), iz: nearestIndex(RESORT_Z, target.z) };
  if (!unit.rnode) unit.rnode = { ix: nearestIndex(RESORT_X, car.x), iz: nearestIndex(RESORT_Z, car.z) };
  const nx = RESORT_X[unit.rnode.ix];
  const nz = RESORT_Z[unit.rnode.iz];
  // A generous capture radius: at chase speed the turning circle is wider than a tight one would allow.
  if (Math.hypot(nx - car.x, nz - car.z) < 13) unit.rnode = stepToward(unit.rnode, goal);
  if (unit.rnode.ix === goal.ix && unit.rnode.iz === goal.iz) {
    // At the junction nearest the target: once there, stay on it (no drifting back out of range).
    if (unit.rnode.arrived || Math.hypot(RESORT_X[goal.ix] - car.x, RESORT_Z[goal.iz] - car.z) < 13) {
      unit.rnode.arrived = true;
      return { x: target.x, z: target.z };
    }
  }
  return { x: RESORT_X[unit.rnode.ix], z: RESORT_Z[unit.rnode.iz] };
}

/** True when the target is on the resort and this car is still on the city side of the bridge. */
export function mustCrossBridge(car: { z: number }, target: { z: number }): boolean {
  return target.z > RESORT.z0 - 10 && car.z < RESORT.z0 + 6;
}

function angleTo(car: CarState, x: number, z: number): number {
  let d = Math.atan2(z - car.z, x - car.x) - car.heading;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Pursuit driving: route along the street grid, then go straight for the target when in sight. */
export function policeDrive(car: CarState, unit: PoliceUnit, layout: CityLayout, target: Target, dt: number): CarInput {
  const input: CarInput = { throttle: 0, steer: 0, brake: false, handbrake: false };
  const n = layout.n;

  if (unit.reverse > 0) {
    unit.reverse -= dt;
    input.throttle = -1;
    input.steer = unit.reverseSteer;
    return input;
  }

  const dist = Math.hypot(target.x - car.x, target.z - car.z);
  // The resort lies across the strait: nothing to do but take the bridge, even with a clear view.
  const bridging = mustCrossBridge(car, target);
  const direct = !bridging && dist < CHASE_RANGE && lineOfSight(layout, car.x, car.z, target.x, target.z);
  let aimX: number;
  let aimZ: number;
  let cruise: number;
  if (direct) {
    const lead = Math.min(1, dist / 20);
    aimX = target.x + target.vx * lead;
    aimZ = target.z + target.vz * lead;
    cruise = dist < 10 ? Math.max(4, speedOf({ vx: target.vx, vz: target.vz } as CarState) + 3) : 45;
    unit.node = null;
  } else if (!bridging && car.z > RESORT.z0 && target.z > RESORT.z0) {
    // Both on the resort: its own little grid, not the city's.
    const a = resortAim(car, target, unit);
    aimX = a.x;
    aimZ = a.z;
    cruise = 26;
  } else {
    unit.rnode = null;
    const here = nearestIntersection(n, car.x, car.z);
    // Chasing onto the resort: the grid goal is the bridge head, the middle of the south edge.
    const goal = bridging ? { ix: n / 2, iz: n } : nearestIntersection(n, target.x, target.z);
    if (!unit.node) unit.node = here;
    const nx = roadCoord(n, unit.node.ix);
    const nz = roadCoord(n, unit.node.iz);
    if (Math.hypot(nx - car.x, nz - car.z) < 7) {
      unit.node = stepToward(unit.node, goal);
    }
    if (bridging && Math.abs(car.x - RESORT_GATE.x) < 12 && car.z > roadCoord(n, n) - 40) {
      // On the last stretch of city road or on the bridge itself: straight down the middle to the far end.
      aimX = RESORT_GATE.x;
      // Look a little ahead so a car pushed off the middle steers back onto the deck instead of scraping the rail.
      aimZ = Math.min(RESORT_GATE.z, car.z + 40);
    } else if (unit.node.ix === goal.ix && unit.node.iz === goal.iz && Math.hypot(roadCoord(n, goal.ix) - car.x, roadCoord(n, goal.iz) - car.z) < 7) {
      aimX = target.x;
      aimZ = target.z;
    } else {
      aimX = roadCoord(n, unit.node.ix);
      aimZ = roadCoord(n, unit.node.iz);
    }
    cruise = 30;
  }

  const diff = angleTo(car, aimX, aimZ);
  const fwd = forwardSpeed(car);
  // Box in a stopped target instead of shoving it along.
  const targetSpeed = Math.hypot(target.vx, target.vz);
  if (direct && dist < 8 && targetSpeed < 3) {
    input.steer = Math.max(-1, Math.min(1, diff * 2.5));
    input.brake = fwd > 0.5;
    unit.stuck = 0;
    return input;
  }
  input.steer = Math.max(-1, Math.min(1, diff * 2.5));
  const sharp = Math.abs(diff) > 0.6;
  const want = sharp ? Math.min(cruise, 11) : cruise;
  if (fwd < want) input.throttle = 1;
  else if (fwd > want + 4) input.brake = true;
  input.handbrake = sharp && fwd > 18 && Math.abs(diff) > 1.1;

  // Unstick: if pushing but not moving, back up with opposite lock.
  if (input.throttle > 0.5 && Math.abs(fwd) < 1) {
    unit.stuck += dt;
    if (unit.stuck > 1.2) {
      unit.stuck = 0;
      unit.reverse = 1.1;
      unit.reverseSteer = diff > 0 ? -1 : 1;
      unit.node = null;
    }
  } else {
    unit.stuck = Math.max(0, unit.stuck - dt);
  }
  return input;
}
