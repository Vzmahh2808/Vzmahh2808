/**
 * Street races against AI drivers: tracks, the racer autopilot and the
 * standings. Pure logic on top of the car model, tested without Three.js.
 */
import { PITCH, roadCoord } from "../world/city";
import type { CarInput, CarSpec, CarState } from "../entities/carPhysics";
import type { Obstacle } from "../entities/traffic";
import type { Mission, Point } from "./missions";
import { raceRoute } from "./story";

export interface Track {
  id: string;
  name: string;
  note: string;
  /** Checkpoints of one lap; a loop ends back at `start`. */
  points: Point[];
  laps: number;
  start: Point;
  /** Direction the grid faces, radians. */
  heading: number;
  fee: number;
  /** Prize for first, second and third place. */
  prizes: [number, number, number];
  time: number;
}

export const RIVAL_COLORS = [0xe84393, 0x00cec9, 0xfdcb6e];
export const RIVAL_NAMES = ["Роза", "Бирюза", "Шафран"];
export const CHECKPOINT_RADIUS = 10;

export function tracks(n: number): Track[] {
  const c = n / 2;
  // The time-trial loop, with the last corner spelled out so the AI never cuts through a block.
  const trial = raceRoute(n);
  const ring = [...trial.slice(0, -1), { x: roadCoord(n, c + 2), z: roadCoord(n, c + 2) }, trial[trial.length - 1]];
  return [
    {
      id: "ring",
      name: "Городское кольцо",
      note: "2 круга по центру",
      points: ring,
      laps: 2,
      start: { x: roadCoord(n, c + 2) + PITCH / 2, z: roadCoord(n, c + 2) },
      heading: 0,
      fee: 100,
      prizes: [700, 300, 100],
      time: 180,
    },
    {
      id: "sprint",
      name: "Портовый спринт",
      note: "через мост и вокруг острова",
      points: [
        { x: 240, z: 0 },
        { x: 402, z: 0 },
        { x: 520, z: 0 },
        { x: 520, z: 108 },
        { x: 628, z: 108 },
        { x: 628, z: -108 },
        { x: 412, z: -108 },
        { x: 412, z: 0 },
        { x: 470, z: 0 },
      ],
      laps: 1,
      start: { x: roadCoord(n, 2) + 20, z: 0 },
      heading: 0,
      fee: 150,
      prizes: [900, 400, 150],
      time: 110,
    },
  ];
}

/** Checkpoints of the whole race, all laps in a row. */
export function raceCheckpoints(t: Track): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < t.laps; i++) out.push(...t.points);
  return out;
}

/** Grid slot i: two abreast, rows three car lengths apart behind the start line. */
export function gridSlot(t: Track, i: number): { x: number; z: number; heading: number } {
  const fx = Math.cos(t.heading);
  const fz = Math.sin(t.heading);
  const back = 4 + Math.floor(i / 2) * 8;
  const side = i % 2 === 0 ? -2.3 : 2.3;
  return { x: t.start.x - fx * back - fz * side, z: t.start.z - fz * back + fx * side, heading: t.heading };
}

export function streetRaceMission(t: Track): Mission {
  return {
    id: `street-${t.id}`,
    title: t.name,
    brief: `Уличная гонка против трёх соперников: ${t.note}. Призы: $${t.prizes[0]}, $${t.prizes[1]}, $${t.prizes[2]}.`,
    reward: 0,
    time: t.time,
    steps: [{ kind: "race", points: raceCheckpoints(t), radius: CHECKPOINT_RADIUS, text: "Обгоните соперников" }],
  };
}

// ---------------------------------------------------------------- racer autopilot

export interface Racer {
  /** Next checkpoint in the full race list. */
  index: number;
  /** Lateral line on the road, metres from the centre line; each racer keeps its own. */
  line: number;
  /** Current lateral offset while dodging. */
  offset: number;
  stuck: number;
  reverse: number;
  /** Driving skill 0..1: how late it brakes for corners. */
  skill: number;
}

export function makeRacer(line: number, skill: number): Racer {
  return { index: 0, line, offset: line, stuck: 0, reverse: 0, skill };
}

function wrap(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** Safe speed through a checkpoint given how sharply the route turns there. */
export function cornerSpeed(prev: Point, at: Point, next: Point | undefined, skill: number): number {
  if (!next) return 60;
  const a1 = Math.atan2(at.z - prev.z, at.x - prev.x);
  const a2 = Math.atan2(next.z - at.z, next.x - at.x);
  const turn = Math.abs(wrap(a2 - a1));
  if (turn < 0.2) return 60;
  return (9 + skill * 4) + (Math.PI - turn) * 6;
}

/**
 * Drive one racer for a frame: aim at the next checkpoint on its own line,
 * brake in time for corners, sidestep slower cars and back out when stuck.
 */
export function racerInput(car: CarState, spec: CarSpec, r: Racer, points: Point[], start: Point, obstacles: Obstacle[], dt: number): CarInput {
  if (r.index >= points.length) return { throttle: 0, steer: 0, brake: true, handbrake: false };
  const target = points[r.index];
  const prev = r.index > 0 ? points[r.index - 1] : start;
  const dist = Math.hypot(target.x - car.x, target.z - car.z);
  if (dist < CHECKPOINT_RADIUS - 1) {
    r.index++;
    return racerInput(car, spec, r, points, start, obstacles, dt);
  }
  const speed = Math.hypot(car.vx, car.vz);
  const fx = Math.cos(car.heading);
  const fz = Math.sin(car.heading);

  // Look for slower cars in the way and pick a side to pass on.
  let limit = Infinity;
  let dodge = r.line;
  for (const o of obstacles) {
    const dx = o.x - car.x;
    const dz = o.z - car.z;
    const ahead = dx * fx + dz * fz;
    const lateral = -dx * fz + dz * fx;
    // Only what is really in front, in this car's own lane; a car alongside is not in the way.
    if (ahead < 2 || ahead > 22 || Math.abs(lateral) > 1.1 + o.r * 0.8) continue;
    const theirs = o.vx * fx + o.vz * fz;
    if (theirs > speed - 1) continue;
    dodge = lateral > 0 ? -3.2 : 3.2;
    if (ahead < 9) limit = Math.min(limit, Math.max(2, theirs + ahead * 0.4));
  }
  r.offset += (dodge - r.offset) * Math.min(1, dt * 2.5);

  // Aim point: the checkpoint shifted onto the racer's line across the segment.
  const sl = Math.hypot(target.x - prev.x, target.z - prev.z) || 1;
  const px = -(target.z - prev.z) / sl;
  const pz = (target.x - prev.x) / sl;
  const aimX = target.x + px * r.offset;
  const aimZ = target.z + pz * r.offset;
  const diff = wrap(Math.atan2(aimZ - car.z, aimX - car.x) - car.heading);

  if (r.reverse > 0) {
    r.reverse -= dt;
    return { throttle: -1, steer: -Math.sign(diff), brake: false, handbrake: false };
  }

  // Brake early enough to make the corner at the checkpoint.
  const vCorner = cornerSpeed(prev, target, points[r.index + 1], r.skill);
  const decel = 12 + r.skill * 6;
  const allowed = Math.min(limit, spec.maxSpeed, Math.sqrt(vCorner * vCorner + 2 * decel * Math.max(0, dist - 4)));
  // Big heading error at speed: slow down to turn.
  const aligned = Math.abs(diff) > 0.9 ? Math.max(8, allowed * 0.5) : allowed;
  let throttle = speed < aligned ? 1 : speed > aligned + 2 ? -1 : 0.2;
  const steer = Math.max(-1, Math.min(1, diff * 2.2));

  // Stuck against something: reverse out for a moment.
  if (throttle > 0 && speed < 1.2) r.stuck += dt;
  else r.stuck = Math.max(0, r.stuck - dt);
  if (r.stuck > 1.4) {
    r.stuck = 0;
    r.reverse = 1.1;
    throttle = -1;
  }
  return { throttle, steer, brake: false, handbrake: Math.abs(diff) > 1.2 && speed > 12 };
}

// ---------------------------------------------------------------- standings

export interface Entrant {
  id: string;
  next: number;
  finished: boolean;
  finishTime: number;
  order: number;
}

export class RaceStandings {
  entrants: Entrant[];
  private finishedCount = 0;

  constructor(
    ids: string[],
    private points: Point[],
  ) {
    this.entrants = ids.map((id) => ({ id, next: 0, finished: false, finishTime: 0, order: 0 }));
  }

  /** Record where an entrant is; returns true when this call finished its race. */
  update(id: string, x: number, z: number, time: number): boolean {
    const e = this.entrants.find((q) => q.id === id);
    if (!e || e.finished) return false;
    const p = this.points[e.next];
    if (Math.hypot(x - p.x, z - p.z) >= CHECKPOINT_RADIUS) return false;
    e.next++;
    if (e.next < this.points.length) return false;
    e.finished = true;
    e.finishTime = time;
    e.order = ++this.finishedCount;
    return true;
  }

  /** Entrants best first: finishers by order, then by checkpoints passed, then by distance to the next one. */
  ranking(pos: Record<string, Point>): Entrant[] {
    const dist = (e: Entrant) => {
      const p = this.points[Math.min(e.next, this.points.length - 1)];
      const q = pos[e.id];
      return q ? Math.hypot(q.x - p.x, q.z - p.z) : Infinity;
    };
    return [...this.entrants].sort((a, b) => {
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      if (a.finished) return a.order - b.order;
      if (a.next !== b.next) return b.next - a.next;
      return dist(a) - dist(b);
    });
  }

  place(id: string, pos: Record<string, Point>): number {
    return this.ranking(pos).findIndex((e) => e.id === id) + 1;
  }
}
