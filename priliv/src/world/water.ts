import { ISLAND, landAt } from "./island";
import type { Point } from "../game/missions";

/** Open water a boat may float on: not land, not a pier, not the bridge, inside the world. */
export function isBoatWater(x: number, z: number, cityLimit: number): boolean {
  if (x > ISLAND.x1 + 58 || Math.abs(z) > cityLimit - 2) return false;
  return landAt(x, z, cityLimit) === "water";
}

export interface Dock {
  kind: string;
  color: number;
  x: number;
  z: number;
  heading: number;
}

/** Boats moored beside the piers, bows pointing out to sea. */
export const DOCKS: Dock[] = [
  // City marina, both sides of the pier.
  { kind: "motorboat", color: 0xf5f6fa, x: 284, z: -161.5, heading: 0 },
  { kind: "speedboat", color: 0xe84118, x: 284, z: -146.5, heading: 0 },
  // Island piers.
  { kind: "motorboat", color: 0x0097e6, x: 455.5, z: -138, heading: -Math.PI / 2 },
  { kind: "speedboat", color: 0xfbc531, x: 515.5, z: -138, heading: -Math.PI / 2 },
  { kind: "motorboat", color: 0x44bd32, x: 575.5, z: -138, heading: -Math.PI / 2 },
];

/** Start of the regatta, just off the city marina. */
export const MARINA: Point = { x: 304, z: -172 };

/** Point-to-point regatta: out of the marina, round the lighthouse, finish north of the bridge. */
export const REGATTA: Point[] = [
  { x: 360, z: -190 },
  { x: 470, z: -175 },
  { x: 610, z: -168 },
  { x: 686, z: -80 },
  { x: 688, z: 0 },
  { x: 686, z: 80 },
  { x: 600, z: 165 },
  { x: 460, z: 165 },
  { x: 365, z: 150 },
  { x: 330, z: 60 },
];

export const REGATTA_TIME = 95;

/** Where police boats come from when the player takes to the water. */
export const POLICE_BOAT_SPAWNS: Point[] = [
  { x: 300, z: 220 },
  { x: 300, z: -230 },
  { x: 560, z: 200 },
  { x: 560, z: -210 },
  { x: 690, z: 0 },
];

/** Crossroads of the waterways around the island, for boats that cannot see their target. */
export const WATER_NODES: Point[] = [
  { x: 330, z: 40 },
  { x: 334, z: 200 },
  { x: 520, z: 190 },
  { x: 684, z: 140 },
  { x: 688, z: 0 },
  { x: 684, z: -140 },
  { x: 520, z: -190 },
  { x: 334, z: -210 },
  { x: 330, z: -40 },
];

/** True if a straight run from a to b stays on water, with some room on both sides. */
export function clearWater(a: Point, b: Point, isWater: (x: number, z: number) => boolean, margin = 3): boolean {
  const d = Math.hypot(b.x - a.x, b.z - a.z);
  const n = Math.max(1, Math.ceil(d / 4));
  const px = d > 0 ? -(b.z - a.z) / d : 0;
  const pz = d > 0 ? (b.x - a.x) / d : 0;
  for (let i = 0; i <= n; i++) {
    const x = a.x + ((b.x - a.x) * i) / n;
    const z = a.z + ((b.z - a.z) * i) / n;
    if (!isWater(x, z) || !isWater(x + px * margin, z + pz * margin) || !isWater(x - px * margin, z - pz * margin)) return false;
  }
  return true;
}

/**
 * Next point to steer for on the way from `from` to `to`: the target itself if
 * it is in plain sight, otherwise the first node of the shortest node route.
 */
export function routeOnWater(from: Point, to: Point, isWater: (x: number, z: number) => boolean): Point {
  if (clearWater(from, to, isWater, 1.5)) return to;
  const nodes = WATER_NODES;
  const n = nodes.length;
  const dist = new Array<number>(n).fill(Infinity);
  const first = new Array<number>(n).fill(-1);
  const done = new Array<boolean>(n).fill(false);
  for (let i = 0; i < n; i++) {
    if (clearWater(from, nodes[i], isWater, 1.5)) {
      dist[i] = Math.hypot(nodes[i].x - from.x, nodes[i].z - from.z);
      first[i] = i;
    }
  }
  let best = Infinity;
  let bestFirst = -1;
  for (;;) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0) break;
    done[u] = true;
    if (clearWater(nodes[u], to, isWater, 1.5)) {
      const total = dist[u] + Math.hypot(to.x - nodes[u].x, to.z - nodes[u].z);
      if (total < best) {
        best = total;
        bestFirst = first[u];
      }
    }
    for (let v = 0; v < n; v++) {
      if (done[v] || !clearWater(nodes[u], nodes[v], isWater)) continue;
      const nd = dist[u] + Math.hypot(nodes[v].x - nodes[u].x, nodes[v].z - nodes[u].z);
      if (nd < dist[v]) {
        dist[v] = nd;
        first[v] = first[u];
      }
    }
  }
  return bestFirst >= 0 ? nodes[bestFirst] : to;
}
