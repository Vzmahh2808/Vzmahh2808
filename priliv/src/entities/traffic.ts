import type { Rng } from "../core/rng";
import { LANE_WIDTH, ROAD_WIDTH, roadCoord, type CityLayout } from "../world/city";
import { lightFor, signalSpeedLimit } from "../world/signals";
import { forwardSpeed, makeCar, pickKind, type CarInput, type CarState } from "./carPhysics";

export interface Obstacle {
  x: number;
  z: number;
  r: number;
  vx: number;
  vz: number;
}

export interface TrafficCar {
  state: CarState;
  kind: string;
  color: number;
  /** Current segment: from intersection (ax, az) to (bx, bz) in grid indices. */
  a: { ix: number; iz: number };
  b: { ix: number; iz: number };
  /** Set for cars on a fixed circuit (the resort has no street grid): the waypoints and the one being chased. */
  loop?: { points: Array<{ x: number; z: number }>; i: number };
  /** Idle timer after a crash. */
  stunned: number;
  input: CarInput;
}

const CRUISE = 13; // m/s
const TURN_SPEED = 5;
const LANE_OFFSET = LANE_WIDTH / 2; // inner lane

function laneTarget(layout: CityLayout, a: TrafficCar["a"], b: TrafficCar["b"]): { x: number; z: number; dx: number; dz: number } {
  const ax = roadCoord(layout.n, a.ix);
  const az = roadCoord(layout.n, a.iz);
  const bx = roadCoord(layout.n, b.ix);
  const bz = roadCoord(layout.n, b.iz);
  const dx = Math.sign(bx - ax);
  const dz = Math.sign(bz - az);
  // Right-hand traffic: right of direction (dx,dz) is (-dz, dx).
  const rx = -dz;
  const rz = dx;
  return { x: bx + rx * LANE_OFFSET, z: bz + rz * LANE_OFFSET, dx, dz };
}

function nextIntersection(rng: Rng, n: number, a: TrafficCar["a"], b: TrafficCar["b"]): TrafficCar["b"] {
  const dirs = [
    { ix: 1, iz: 0 },
    { ix: -1, iz: 0 },
    { ix: 0, iz: 1 },
    { ix: 0, iz: -1 },
  ];
  const straight = { ix: b.ix - a.ix, iz: b.iz - a.iz };
  const options = dirs
    .map((d) => ({ ix: b.ix + d.ix, iz: b.iz + d.iz, d }))
    .filter((o) => o.ix >= 0 && o.ix <= n && o.iz >= 0 && o.iz <= n)
    .filter((o) => !(o.ix === a.ix && o.iz === a.iz));
  if (options.length === 0) return a;
  const ahead = options.find((o) => o.d.ix === straight.ix && o.d.iz === straight.iz);
  if (ahead && rng.chance(0.55)) return { ix: ahead.ix, iz: ahead.iz };
  const pick = rng.pick(options);
  return { ix: pick.ix, iz: pick.iz };
}

export function spawnTraffic(rng: Rng, layout: CityLayout, count: number, colors: number[]): TrafficCar[] {
  const cars: TrafficCar[] = [];
  for (let i = 0; i < count; i++) {
    const a = { ix: rng.int(0, layout.n), iz: rng.int(0, layout.n) };
    const b = nextIntersection(rng, layout.n, { ix: -99, iz: -99 }, a);
    if (b.ix === a.ix && b.iz === a.iz) continue;
    const t = laneTarget(layout, a, b);
    const ax = roadCoord(layout.n, a.ix) - t.dz * LANE_OFFSET;
    const az = roadCoord(layout.n, a.iz) + t.dx * LANE_OFFSET;
    const f = rng.next() * 0.7 + 0.15;
    const x = ax + (t.x - ax) * f;
    const z = az + (t.z - az) * f;
    const kind = pickKind(() => rng.next());
    const state = makeCar(x, z, Math.atan2(t.dz, t.dx));
    state.vx = Math.cos(state.heading) * 8;
    state.vz = Math.sin(state.heading) * 8;
    cars.push({ state, kind, color: rng.pick(colors), a, b, stunned: 0, input: { throttle: 0, steer: 0, brake: false, handbrake: false } });
  }
  return cars;
}

/** A car on a closed circuit, placed a fraction `t` (0..1) of the way round it. */
export function spawnLoopCar(rng: Rng, points: Array<{ x: number; z: number }>, t: number, kinds: string[], colors: number[]): TrafficCar {
  // Find the leg containing the fraction of total length.
  const lens = points.map((p, i) => Math.hypot(points[(i + 1) % points.length].x - p.x, points[(i + 1) % points.length].z - p.z));
  const total = lens.reduce((a, b) => a + b, 0);
  let d = (((t % 1) + 1) % 1) * total;
  let leg = 0;
  while (d > lens[leg]) d -= lens[leg++];
  const a = points[leg];
  const b = points[(leg + 1) % points.length];
  const f = d / (lens[leg] || 1);
  const state = makeCar(a.x + (b.x - a.x) * f, a.z + (b.z - a.z) * f, Math.atan2(b.z - a.z, b.x - a.x));
  state.vx = Math.cos(state.heading) * 6;
  state.vz = Math.sin(state.heading) * 6;
  return {
    state,
    kind: rng.pick(kinds),
    color: rng.pick(colors),
    a: { ix: 0, iz: 0 },
    b: { ix: 0, iz: 0 },
    loop: { points, i: (leg + 1) % points.length },
    stunned: 0,
    input: { throttle: 0, steer: 0, brake: false, handbrake: false },
  };
}

/** How far ahead the nearest obstacle in the car's corridor is (Infinity when clear). */
function obstacleAhead(s: CarState, obstacles: Obstacle[]): number {
  const fx = Math.cos(s.heading);
  const fz = Math.sin(s.heading);
  let nearest = Infinity;
  for (const o of obstacles) {
    const dx = o.x - s.x;
    const dz = o.z - s.z;
    const ahead = dx * fx + dz * fz;
    const side = Math.abs(-dx * fz + dz * fx);
    if (ahead > 0 && ahead < 16 && side < o.r + 1.4) nearest = Math.min(nearest, ahead - o.r);
  }
  return nearest;
}

const LOOP_CRUISE = 11;

/** Steer a car round its circuit, slowing for corners and for anything in the way. */
function driveLoop(car: TrafficCar, obstacles: Obstacle[], dt: number): void {
  const s = car.state;
  const inp = car.input;
  const loop = car.loop!;
  if (car.stunned > 0) {
    car.stunned -= dt;
    inp.throttle = 0;
    inp.brake = true;
    return;
  }
  let target = loop.points[loop.i];
  if (Math.hypot(target.x - s.x, target.z - s.z) < 7) {
    loop.i = (loop.i + 1) % loop.points.length;
    target = loop.points[loop.i];
  }
  let diff = Math.atan2(target.z - s.z, target.x - s.x) - s.heading;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  inp.steer = Math.max(-1, Math.min(1, diff * 2.2));
  const nearest = obstacleAhead(s, obstacles);
  let speed = Math.abs(diff) > 0.4 || Math.hypot(target.x - s.x, target.z - s.z) < 14 ? TURN_SPEED : LOOP_CRUISE;
  if (nearest < 12) speed = Math.min(speed, Math.max(0, (nearest - 3) * 1.2));
  const v = forwardSpeed(s);
  inp.brake = v > speed + 1.5 || (speed < 1 && v > 0.2);
  inp.throttle = v < speed - 0.5 ? 0.8 : 0;
  inp.handbrake = false;
}

/** Decide throttle/steer for one AI car. `obstacles` are everything it should not hit. */
/** Distance before the intersection centre where the car's nose should stop at a red. */
const STOP_LINE = ROAD_WIDTH / 2 + 2;

export function driveTraffic(car: TrafficCar, layout: CityLayout, rng: Rng, obstacles: Obstacle[], dt: number, time?: number, halfLength = 2.2): void {
  if (car.loop) {
    driveLoop(car, obstacles, dt);
    return;
  }
  const s = car.state;
  const inp = car.input;
  if (car.stunned > 0) {
    car.stunned -= dt;
    inp.throttle = 0;
    inp.brake = true;
    return;
  }
  const t = laneTarget(layout, car.a, car.b);
  const toX = t.x - s.x;
  const toZ = t.z - s.z;
  const along = toX * t.dx + toZ * t.dz;
  if (along < 2.5) {
    const nb = nextIntersection(rng, layout.n, car.a, car.b);
    car.a = car.b;
    car.b = nb;
  }
  const nt = laneTarget(layout, car.a, car.b);
  // Aim at a point a few metres ahead along the lane, which keeps the car centred.
  const aheadX = s.x + (nt.x - s.x) * 0.0 + nt.dx * 6;
  const aheadZ = s.z + nt.dz * 6;
  // Lane centre line: project the car onto the lane and pull toward it.
  const laneX = nt.dx !== 0 ? aheadX : nt.x;
  const laneZ = nt.dz !== 0 ? aheadZ : nt.z;
  const desired = Math.atan2(laneZ - s.z, laneX - s.x);
  let diff = desired - s.heading;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  inp.steer = Math.max(-1, Math.min(1, diff * 2.2));

  // Obstacle check in a corridor ahead.
  const nearest = obstacleAhead(s, obstacles);
  const distToNode = Math.hypot(nt.x - s.x, nt.z - s.z);
  const turning = Math.abs(diff) > 0.35 || distToNode < 10;
  let target = turning ? TURN_SPEED : CRUISE;
  if (nearest < 12) target = Math.min(target, Math.max(0, (nearest - 3) * 1.2));
  const v = forwardSpeed(s);
  if (time !== undefined) {
    // Obey the light at the intersection ahead.
    const bx = roadCoord(layout.n, car.b.ix);
    const bz = roadCoord(layout.n, car.b.iz);
    const toNode = (bx - s.x) * nt.dx + (bz - s.z) * nt.dz;
    const axis = nt.dx !== 0 ? "x" : "z";
    const gap = toNode - STOP_LINE - halfLength;
    if (gap < 40) {
      const limit = signalSpeedLimit(lightFor(axis, time, car.b.ix, car.b.iz), gap, Math.max(0, v));
      target = Math.min(target, limit);
    }
  }
  // A car told to stop (a red light, a blocked lane) is held still rather than left to coast.
  inp.brake = v > target + 1.5 || (target < 1 && v > 0.2);
  inp.throttle = v < target - 0.5 ? 0.8 : 0;
  inp.handbrake = false;
}
