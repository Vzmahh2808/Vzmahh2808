import type { Rng } from "../core/rng";

/**
 * Pure city layout: a grid of blocks separated by roads. Units are metres, y is up,
 * the city is centred on the origin and lies in the XZ plane.
 */

export const ROAD_WIDTH = 16; // sidewalk + carriageway + sidewalk
export const SIDEWALK = 3;
export const LANE_WIDTH = 2.5;
export const BLOCK_SIZE = 44;
export const PITCH = BLOCK_SIZE + ROAD_WIDTH;

export interface Building {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  color: number;
  kind: "tower" | "office" | "house" | "shop" | "warehouse" | "container" | "rail" | "crane" | "lighthouse";
}

export interface Tree {
  x: number;
  z: number;
  scale: number;
}

export interface Lamp {
  x: number;
  z: number;
  /** Yaw so the lamp arm points over the road. */
  rot: number;
}

export interface Intersection {
  ix: number;
  iz: number;
  x: number;
  z: number;
}

export interface CityLayout {
  n: number;
  half: number;
  buildings: Building[];
  trees: Tree[];
  lamps: Lamp[];
  intersections: Intersection[];
  /** Spawn positions for parked cars: on the right sidewalk edge of streets. */
  parking: Array<{ x: number; z: number; rot: number }>;
}

const PALETTES: Record<"tower" | "office" | "house" | "shop", number[]> = {
  tower: [0x4a6fa5, 0x3b5a8a, 0x5c7fb8, 0x2f4a70, 0x6d8fc4],
  office: [0x8c9bab, 0x7a8797, 0xa4b0bd, 0x6c7886, 0xb7c2cc],
  house: [0xc98a5b, 0xb8744a, 0xd9a06f, 0x9c6a48, 0xe0b48a],
  shop: [0xc75b5b, 0x5bb0c7, 0xc7a55b, 0x8fc75b, 0xb35bc7],
};

/** Centre-line coordinate of road index i (0..n inclusive). */
export function roadCoord(n: number, i: number): number {
  return (i - n / 2) * PITCH;
}

export function isOnRoad(n: number, x: number, z: number): boolean {
  const half = (n / 2) * PITCH;
  if (Math.abs(x) > half + ROAD_WIDTH / 2 || Math.abs(z) > half + ROAD_WIDTH / 2) return false;
  const fx = mod(x + half + ROAD_WIDTH / 2, PITCH);
  const fz = mod(z + half + ROAD_WIDTH / 2, PITCH);
  return fx < ROAD_WIDTH || fz < ROAD_WIDTH;
}

function mod(a: number, b: number): number {
  return ((a % b) + b) % b;
}

export function generateCity(rng: Rng, n = 8): CityLayout {
  const half = (n / 2) * PITCH;
  const buildings: Building[] = [];
  const trees: Tree[] = [];
  const lamps: Lamp[] = [];
  const parking: CityLayout["parking"] = [];
  const intersections: Intersection[] = [];

  for (let iz = 0; iz <= n; iz++) {
    for (let ix = 0; ix <= n; ix++) {
      intersections.push({ ix, iz, x: roadCoord(n, ix), z: roadCoord(n, iz) });
    }
  }

  for (let bz = 0; bz < n; bz++) {
    for (let bx = 0; bx < n; bx++) {
      const x0 = roadCoord(n, bx) + ROAD_WIDTH / 2;
      const z0 = roadCoord(n, bz) + ROAD_WIDTH / 2;
      const distCentre = Math.hypot(bx - (n - 1) / 2, bz - (n - 1) / 2) / (n / 2);
      const roll = rng.next();
      if (roll < 0.08) {
        // Park block.
        const count = rng.int(10, 18);
        for (let i = 0; i < count; i++) {
          trees.push({ x: x0 + rng.int(3, BLOCK_SIZE - 3), z: z0 + rng.int(3, BLOCK_SIZE - 3), scale: 0.8 + rng.next() * 0.7 });
        }
        continue;
      }
      // Subdivide block into lots.
      const cols = rng.int(2, 3);
      const rows = rng.int(2, 3);
      const lotW = BLOCK_SIZE / cols;
      const lotD = BLOCK_SIZE / rows;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (rng.chance(0.12)) {
            trees.push({ x: x0 + c * lotW + lotW / 2, z: z0 + r * lotD + lotD / 2, scale: 1 });
            continue;
          }
          const margin = 2.5;
          const w = lotW - margin * 2 - rng.int(0, 3);
          const d = lotD - margin * 2 - rng.int(0, 3);
          const x = x0 + c * lotW + margin + (lotW - margin * 2 - w) / 2;
          const z = z0 + r * lotD + margin + (lotD - margin * 2 - d) / 2;
          let kind: "tower" | "office" | "house" | "shop";
          let h: number;
          const central = 1 - distCentre;
          if (rng.next() < central * 0.7) {
            kind = "tower";
            h = rng.int(30, 90);
          } else if (rng.next() < 0.45) {
            kind = "office";
            h = rng.int(14, 32);
          } else if (rng.next() < 0.5) {
            kind = "shop";
            h = rng.int(5, 9);
          } else {
            kind = "house";
            h = rng.int(6, 12);
          }
          buildings.push({ x: x + w / 2, z: z + d / 2, w, d, h, color: rng.pick(PALETTES[kind]), kind });
        }
      }
    }
  }

  // Lamps and parking along every road segment.
  for (let i = 0; i <= n; i++) {
    const c = roadCoord(n, i);
    for (let j = 0; j < n; j++) {
      const a = roadCoord(n, j) + ROAD_WIDTH / 2;
      for (let s = 6; s < BLOCK_SIZE; s += 16) {
        // Road along X at z = c.
        lamps.push({ x: a + s, z: c - ROAD_WIDTH / 2 + 1, rot: 0 });
        lamps.push({ x: a + s + 8, z: c + ROAD_WIDTH / 2 - 1, rot: Math.PI });
        // Road along Z at x = c.
        lamps.push({ x: c - ROAD_WIDTH / 2 + 1, z: a + s, rot: Math.PI / 2 });
        lamps.push({ x: c + ROAD_WIDTH / 2 - 1, z: a + s + 8, rot: -Math.PI / 2 });
      }
      if (rng.chance(0.5)) parking.push({ x: a + rng.int(8, BLOCK_SIZE - 8), z: c + ROAD_WIDTH / 2 - SIDEWALK - 1.4, rot: 0 });
      if (rng.chance(0.5)) parking.push({ x: c - ROAD_WIDTH / 2 + SIDEWALK + 1.4, z: a + rng.int(8, BLOCK_SIZE - 8), rot: Math.PI / 2 });
    }
  }

  return { n, half, buildings, trees, lamps, intersections, parking };
}

/** Axis-aligned collision test of a circle against buildings; returns push-out vector or null. */
export function resolveCircleVsBuildings(layout: CityLayout, x: number, z: number, r: number): { x: number; z: number } | null {
  let px = 0;
  let pz = 0;
  let hit = false;
  for (const b of layout.buildings) {
    const hw = b.w / 2 + r;
    const hd = b.d / 2 + r;
    const dx = x - b.x;
    const dz = z - b.z;
    if (Math.abs(dx) >= hw || Math.abs(dz) >= hd) continue;
    hit = true;
    const ox = hw - Math.abs(dx);
    const oz = hd - Math.abs(dz);
    if (ox < oz) px += Math.sign(dx || 1) * ox;
    else pz += Math.sign(dz || 1) * oz;
  }
  return hit ? { x: px, z: pz } : null;
}

/** Keep a point inside the city bounds (a grass verge beyond the outer road). */
export function clampToCity(layout: CityLayout, x: number, z: number): { x: number; z: number } {
  const lim = layout.half + ROAD_WIDTH / 2 + 30;
  return { x: Math.max(-lim, Math.min(lim, x)), z: Math.max(-lim, Math.min(lim, z)) };
}

export const ROAD_TOP = 0.05;
export const PAVEMENT_TOP = 0.25;

/** True on the asphalt part of a road (not the sidewalks). */
export function isOnCarriageway(n: number, x: number, z: number): boolean {
  const half = (n / 2) * PITCH;
  if (Math.abs(x) > half + ROAD_WIDTH / 2 || Math.abs(z) > half + ROAD_WIDTH / 2) return false;
  const fx = mod(x + half + ROAD_WIDTH / 2, PITCH);
  const fz = mod(z + half + ROAD_WIDTH / 2, PITCH);
  const inX = fx >= SIDEWALK && fx < ROAD_WIDTH - SIDEWALK;
  const inZ = fz >= SIDEWALK && fz < ROAD_WIDTH - SIDEWALK;
  return inX || inZ;
}

/** Height of the walkable surface at (x, z): asphalt, raised pavement, or the grass outside town. */
export function surfaceHeight(n: number, x: number, z: number): number {
  const half = (n / 2) * PITCH;
  if (isOnCarriageway(n, x, z)) return ROAD_TOP;
  const inside = Math.abs(x) <= half + ROAD_WIDTH / 2 - SIDEWALK && Math.abs(z) <= half + ROAD_WIDTH / 2 - SIDEWALK;
  return inside ? PAVEMENT_TOP : 0;
}
