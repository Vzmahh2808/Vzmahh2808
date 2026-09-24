import type { Rng } from "../core/rng";
import { nearestNode, type WalkGraph } from "../world/sidewalks";

export type PedState = "walk" | "flee" | "down" | "gone";

export interface Ped {
  id: number;
  x: number;
  z: number;
  /** Height above ground while airborne after a hit. */
  y: number;
  vx: number;
  vy: number;
  vz: number;
  heading: number;
  speed: number;
  state: PedState;
  from: number;
  to: number;
  timer: number;
  /** 0 = upright, 1 = lying flat. */
  fall: number;
  walkSpeed: number;
  look: number;
}

export interface Threat {
  x: number;
  z: number;
  radius: number;
}

export const FLEE_SPEED = 5.8;
export const DOWN_TIME = 8;
const GRAVITY = 18;

export function spawnPeds(rng: Rng, g: WalkGraph, count: number): Ped[] {
  const peds: Ped[] = [];
  for (let i = 0; i < count; i++) {
    const from = rng.int(0, g.nodes.length - 1);
    const to = rng.pick(g.edges[from]);
    const t = rng.next();
    const a = g.nodes[from];
    const b = g.nodes[to];
    peds.push({
      id: i,
      x: a.x + (b.x - a.x) * t,
      z: a.z + (b.z - a.z) * t,
      y: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      heading: Math.atan2(b.z - a.z, b.x - a.x),
      speed: 0,
      state: "walk",
      from,
      to,
      timer: 0,
      fall: 0,
      walkSpeed: 1.1 + rng.next() * 0.6,
      look: rng.int(0, 1_000_000),
    });
  }
  return peds;
}

function turnToward(p: Ped, ang: number, rate: number, dt: number): void {
  let d = ang - p.heading;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  p.heading += d * Math.min(1, rate * dt);
}

/** Put a ped back on the network, e.g. after it stands up or when respawning. */
export function rejoinNetwork(p: Ped, g: WalkGraph, rng: Rng): void {
  p.to = nearestNode(g, p.x, p.z);
  p.from = rng.pick(g.edges[p.to]);
}

/** Launch a ped after being hit by a car moving at (vx, vz). */
export function knockPed(p: Ped, vx: number, vz: number): void {
  if (p.state === "down" || p.state === "gone") return;
  const sp = Math.hypot(vx, vz);
  p.state = "down";
  p.vx = vx * 0.75;
  p.vz = vz * 0.75;
  p.vy = 2.5 + sp * 0.18;
  p.timer = DOWN_TIME;
  p.heading = Math.atan2(-vz, -vx);
}

export function scare(p: Ped, from: { x: number; z: number }, seconds = 4): void {
  if (p.state === "down" || p.state === "gone") return;
  p.state = "flee";
  p.timer = Math.max(p.timer, seconds);
  p.heading = Math.atan2(p.z - from.z, p.x - from.x);
}

/**
 * Advance one ped. `collide` returns a push-out vector when (x, z) is inside a solid.
 */
export function stepPed(
  p: Ped,
  g: WalkGraph,
  rng: Rng,
  dt: number,
  threats: Threat[],
  collide?: (x: number, z: number) => { x: number; z: number } | null,
): void {
  if (p.state === "gone") return;

  if (p.state === "down") {
    p.vy -= GRAVITY * dt;
    p.y = Math.max(0, p.y + p.vy * dt);
    const friction = p.y > 0 ? 0.2 : 4;
    p.vx *= Math.max(0, 1 - friction * dt);
    p.vz *= Math.max(0, 1 - friction * dt);
    if (p.y === 0 && p.vy < 0) p.vy = 0;
    p.x += p.vx * dt;
    p.z += p.vz * dt;
    p.fall = Math.min(1, p.fall + dt * 4);
    p.speed = 0;
    p.timer -= dt;
    if (p.timer <= 0) p.state = "gone";
  } else {
    for (const t of threats) {
      const d = Math.hypot(p.x - t.x, p.z - t.z);
      if (d < t.radius) scare(p, t, 3 + Math.random() * 2);
    }
    p.fall = Math.max(0, p.fall - dt * 2);
    if (p.state === "flee") {
      p.timer -= dt;
      p.speed += (FLEE_SPEED - p.speed) * Math.min(1, dt * 6);
      p.heading += (rng.next() - 0.5) * dt * 1.5;
      if (p.timer <= 0) {
        p.state = "walk";
        rejoinNetwork(p, g, rng);
      }
    } else {
      const target = g.nodes[p.to];
      const dx = target.x - p.x;
      const dz = target.z - p.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.6) {
        const options = g.edges[p.to].filter((n) => n !== p.from);
        const next = options.length ? rng.pick(options) : p.from;
        p.from = p.to;
        p.to = next;
      } else {
        turnToward(p, Math.atan2(dz, dx), 8, dt);
      }
      p.speed += (p.walkSpeed - p.speed) * Math.min(1, dt * 4);
    }
    p.x += Math.cos(p.heading) * p.speed * dt;
    p.z += Math.sin(p.heading) * p.speed * dt;
  }

  if (collide) {
    const push = collide(p.x, p.z);
    if (push) {
      p.x += push.x;
      p.z += push.z;
      if (p.state === "flee") p.heading += Math.PI / 2;
      if (p.state === "down") {
        p.vx *= -0.3;
        p.vz *= -0.3;
      }
    }
  }
}
