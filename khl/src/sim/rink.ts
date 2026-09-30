/**
 * Rink geometry in metres. Centre ice is (0, 0), X runs along the length and
 * Y across. Home (team 0) defends the goal on the left and attacks right.
 */
import type { Vec } from "../core/vec";

export const HX = 30; // half length, 60 m
export const HY = 13; // half width, 26 m
export const CORNER = 8.5;
export const GOAL_LINE_X = 26; // 4 m from the end boards
export const GOAL_HALF = 0.915; // 1.83 m mouth
export const GOAL_DEPTH = 1.0;
export const BLUE_X = 7.14; // 22.86 m from the end boards
export const CREASE_R = 1.83;
export const DOT_X = 20; // faceoff dots in the attacking zones (6 m from the goal line)
export const DOT_Y = 6.7;
export const PUCK_R = 0.038;

export type TeamId = 0 | 1;

/** X of the goal line a team defends. */
export const goalX = (team: TeamId): number => (team === 0 ? -GOAL_LINE_X : GOAL_LINE_X);
/** +1 when the team attacks toward +X. */
export const attackDir = (team: TeamId): 1 | -1 => (team === 0 ? 1 : -1);

/** Signed distance to the boards: negative inside, positive outside. */
export function rinkSdf(x: number, y: number): number {
  const qx = Math.abs(x) - (HX - CORNER);
  const qy = Math.abs(y) - (HY - CORNER);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - CORNER;
}

/** Outward unit normal of the boards nearest to (x, y). */
export function rinkNormal(x: number, y: number, out: Vec): Vec {
  const qx = Math.abs(x) - (HX - CORNER);
  const qy = Math.abs(y) - (HY - CORNER);
  const sx = x < 0 ? -1 : 1;
  const sy = y < 0 ? -1 : 1;
  if (qx > 0 && qy > 0) {
    const l = Math.hypot(qx, qy) || 1;
    out.x = (sx * qx) / l;
    out.y = (sy * qy) / l;
  } else if (qx > qy) {
    out.x = sx;
    out.y = 0;
  } else {
    out.x = 0;
    out.y = sy;
  }
  return out;
}

const tmp: Vec = { x: 0, y: 0 };

/**
 * Keep a circle inside the boards. Reflects the velocity component into the
 * wall by `restitution` and removes `tangentLoss` of the sliding speed.
 * Returns the impact speed into the wall, or 0 if there was no contact.
 */
export function collideRink(p: Vec, v: Vec, radius: number, restitution: number, tangentLoss: number): number {
  const d = rinkSdf(p.x, p.y);
  if (d <= -radius) return 0;
  const n = rinkNormal(p.x, p.y, tmp);
  const pen = d + radius;
  p.x -= n.x * pen;
  p.y -= n.y * pen;
  const vn = v.x * n.x + v.y * n.y;
  if (vn <= 0) return 0;
  const tx = v.x - vn * n.x;
  const ty = v.y - vn * n.y;
  const keep = 1 - tangentLoss;
  v.x = tx * keep - restitution * vn * n.x;
  v.y = ty * keep - restitution * vn * n.y;
  return vn;
}

/** A thin wall of a net. */
export interface Seg {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

export interface Net {
  team: TeamId;
  /** X of the goal line. */
  lineX: number;
  /** +1 if the net sits behind the line toward +X, -1 toward -X. */
  out: 1 | -1;
  /** Back and side walls the puck bounces off. */
  walls: Seg[];
  /** Front face, closed for skaters only. */
  front: Seg;
  /** Posts (circles). */
  posts: Vec[];
}

export function makeNet(team: TeamId): Net {
  const lineX = goalX(team);
  const out = (lineX < 0 ? -1 : 1) as 1 | -1;
  const backX = lineX + out * GOAL_DEPTH;
  const h = GOAL_HALF;
  return {
    team,
    lineX,
    out,
    walls: [
      { ax: backX, ay: -h, bx: backX, by: h },
      { ax: lineX, ay: -h, bx: backX, by: -h },
      { ax: lineX, ay: h, bx: backX, by: h },
    ],
    front: { ax: lineX, ay: -h, bx: lineX, by: h },
    posts: [
      { x: lineX, y: -h },
      { x: lineX, y: h },
    ],
  };
}

export const NETS: [Net, Net] = [makeNet(0), makeNet(1)];

/** Closest point on a segment to (px, py). */
export function closestOnSeg(s: Seg, px: number, py: number, out: Vec): Vec {
  const dx = s.bx - s.ax;
  const dy = s.by - s.ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - s.ax) * dx + (py - s.ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  out.x = s.ax + dx * t;
  out.y = s.ay + dy * t;
  return out;
}

/** Push a circle out of a segment and bounce its velocity. Returns the impact speed. */
export function collideSeg(s: Seg, p: Vec, v: Vec, radius: number, restitution: number): number {
  closestOnSeg(s, p.x, p.y, tmp);
  const dx = p.x - tmp.x;
  const dy = p.y - tmp.y;
  const d = Math.hypot(dx, dy);
  if (d >= radius) return 0;
  let nx: number;
  let ny: number;
  if (d > 1e-9) {
    nx = dx / d;
    ny = dy / d;
  } else {
    // Centre exactly on the wall: use the segment normal facing the velocity.
    const sx = s.bx - s.ax;
    const sy = s.by - s.ay;
    const sl = Math.hypot(sx, sy) || 1;
    nx = -sy / sl;
    ny = sx / sl;
    if (nx * v.x + ny * v.y > 0) {
      nx = -nx;
      ny = -ny;
    }
  }
  p.x += nx * (radius - d);
  p.y += ny * (radius - d);
  const vn = v.x * nx + v.y * ny;
  if (vn >= 0) return 0;
  v.x -= (1 + restitution) * vn * nx;
  v.y -= (1 + restitution) * vn * ny;
  return -vn;
}

/** Push a circle out of a fixed point (a post) and bounce. Returns the impact speed. */
export function collidePoint(c: Vec, radius: number, p: Vec, v: Vec, pr: number, restitution: number): number {
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  const d = Math.hypot(dx, dy);
  const rr = radius + pr;
  if (d >= rr) return 0;
  const nx = d > 1e-9 ? dx / d : 1;
  const ny = d > 1e-9 ? dy / d : 0;
  p.x = c.x + nx * rr;
  p.y = c.y + ny * rr;
  const vn = v.x * nx + v.y * ny;
  if (vn >= 0) return 0;
  v.x -= (1 + restitution) * vn * nx;
  v.y -= (1 + restitution) * vn * ny;
  return -vn;
}
