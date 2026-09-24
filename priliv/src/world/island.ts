import type { Rng } from "../core/rng";
import type { Building } from "./city";

/**
 * The port island east of the city, joined by a bridge. Everything here is
 * plain data: rectangles for land and roads, and colliders for buildings.
 */

export interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export const ISLAND_TOP = 0.25;
export const WATER_LEVEL = 0.02;

/** City shoreline on the east side: land stops a little past the outer road. */
export const CITY_EAST_SHORE = 268;

export const BRIDGE: Rect = { x0: 240, x1: 402, z0: -7, z1: 7 };
export const ISLAND: Rect = { x0: 400, x1: 640, z0: -120, z1: 120 };
export const CAPE: Rect = { x0: 638, x1: 672, z0: -16, z1: 16 };

/** Road centre lines on the island, each 12 m wide. */
export const ISLAND_ROADS: Rect[] = [
  { x0: 400, x1: 640, z0: -6, z1: 6 }, // main street from the bridge
  { x0: 638, x1: 668, z0: -6, z1: 6 }, // cape road to the lighthouse
  { x0: 514, x1: 526, z0: -114, z1: 114 }, // cross street
  { x0: 406, x1: 418, z0: -114, z1: 114 }, // west ring
  { x0: 622, x1: 634, z0: -114, z1: 114 }, // east ring
  { x0: 406, x1: 634, z0: 102, z1: 114 }, // north ring
  { x0: 406, x1: 634, z0: -114, z1: -102 }, // south ring
];

export const LIGHTHOUSE = { x: 664, z: 0 };

export function inRect(r: Rect, x: number, z: number, pad = 0): boolean {
  return x >= r.x0 - pad && x <= r.x1 + pad && z >= r.z0 - pad && z <= r.z1 + pad;
}

/** Wooden piers: three on the island's south shore and the city marina on the east shore. */
export const PIERS: Rect[] = [
  { x0: 440, x1: 452, z0: -150, z1: -120 },
  { x0: 500, x1: 512, z0: -150, z1: -120 },
  { x0: 560, x1: 572, z0: -150, z1: -120 },
  { x0: 266, x1: 296, z0: -158, z1: -150 },
];
export const PIER_TOP = 0.35;

export type Land = "city" | "bridge" | "island" | "pier" | "water";

/** What is under (x, z). The city is solid ground except past its east shore. */
export function landAt(x: number, z: number, cityLimit: number): Land {
  if (inRect(BRIDGE, x, z)) return "bridge";
  if (PIERS.some((p) => inRect(p, x, z))) return "pier";
  if (inRect(ISLAND, x, z) || inRect(CAPE, x, z)) return "island";
  if (Math.abs(z) <= cityLimit && x >= -cityLimit && x <= CITY_EAST_SHORE) return "city";
  return "water";
}

export function onIslandRoad(x: number, z: number): boolean {
  return ISLAND_ROADS.some((r) => inRect(r, x, z));
}

/** Keep things inside the playable world (the far edges are hard walls, the rest is water). */
export function clampWorld(x: number, z: number, cityLimit: number): { x: number; z: number } {
  return { x: Math.max(-cityLimit, Math.min(ISLAND.x1 + 60, x)), z: Math.max(-cityLimit, Math.min(cityLimit, z)) };
}

export interface IslandLayout {
  /** Solid obstacles; also appended to the city collider list. */
  colliders: Building[];
  containers: Array<{ x: number; z: number; y: number; rot: number; color: number }>;
  cranes: Array<{ x: number; z: number; rot: number }>;
  piers: Rect[];
  parking: Array<{ x: number; z: number; heading: number }>;
}

const CONTAINER_COLORS = [0xc0392b, 0x2980b9, 0x27ae60, 0xe67e22, 0x8e44ad, 0x16a085, 0xd35400, 0x7f8c8d];

export function generateIsland(rng: Rng): IslandLayout {
  const colliders: Building[] = [];
  const containers: IslandLayout["containers"] = [];
  const cranes: IslandLayout["cranes"] = [];
  const box = (x: number, z: number, w: number, d: number, h: number, color: number, kind: Building["kind"]) =>
    colliders.push({ x, z, w, d, h, color, kind });

  // Bridge rails.
  box((BRIDGE.x0 + BRIDGE.x1) / 2 + 6, BRIDGE.z1 + 0.4, BRIDGE.x1 - BRIDGE.x0 - 12, 0.6, 1.1, 0x9aa3ad, "rail");
  box((BRIDGE.x0 + BRIDGE.x1) / 2 + 6, BRIDGE.z0 - 0.4, BRIDGE.x1 - BRIDGE.x0 - 12, 0.6, 1.1, 0x9aa3ad, "rail");

  // Quadrants between the ring, the main street and the cross street.
  const quads = [
    { x0: 422, x1: 510, z0: 10, z1: 98, kind: "warehouse" },
    { x0: 530, x1: 618, z0: 10, z1: 98, kind: "yard" },
    { x0: 422, x1: 510, z0: -98, z1: -10, kind: "yard" },
    { x0: 530, x1: 618, z0: -98, z1: -10, kind: "warehouse" },
  ];
  for (const q of quads) {
    if (q.kind === "warehouse") {
      const n = 2;
      const d = (q.z1 - q.z0 - 12) / n;
      for (let i = 0; i < n; i++) {
        const z = q.z0 + 6 + d * i + d / 2;
        box((q.x0 + q.x1) / 2, z, q.x1 - q.x0 - 10, d - 8, rng.int(9, 13), rng.pick([0x8d99ae, 0x6c7a89, 0xa4b0be, 0x95a5a6]), "warehouse");
      }
    } else {
      // Container stacks in rows, with lanes left free between them.
      for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 3; col++) {
          if (rng.chance(0.15)) continue;
          const cx = q.x0 + 12 + col * 28;
          const cz = q.z0 + 10 + row * 22;
          const height = rng.int(1, 3);
          for (let k = 0; k < height; k++) containers.push({ x: cx, z: cz, y: k * 2.6, rot: 0, color: rng.pick(CONTAINER_COLORS) });
          box(cx, cz, 12.2, 2.5, height * 2.6, 0x000000, "container");
        }
      }
      cranes.push({ x: (q.x0 + q.x1) / 2, z: (q.z0 + q.z1) / 2, rot: 0 });
    }
  }
  // Lighthouse on the cape.
  box(LIGHTHOUSE.x, LIGHTHOUSE.z, 5, 5, 26, 0xf5f6fa, "lighthouse");

  const piers = PIERS.slice();
  const parking = [
    { x: 470, z: 3, heading: 0 },
    { x: 590, z: -3, heading: Math.PI },
    { x: 520 + 3, z: 60, heading: Math.PI / 2 },
    { x: 520 - 3, z: -60, heading: -Math.PI / 2 },
  ];
  return { colliders, containers, cranes, piers, parking };
}
