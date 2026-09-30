import type { Rng } from "../core/rng";
import type { Building, Post } from "./city";
import { RESORT, RESORT_ROADS, SOUTH_BRIDGE, type Rect } from "./island";
import { RAIL_HEIGHT, resortEdgeStrips, resortStrip, southStrip, stripColliders } from "./embankment";
import type { WalkGraph } from "./sidewalks";

/**
 * «Лазурный берег»: the resort island south of the city. Hotels and villas
 * around a palm boulevard, a plaza with a fountain, boutiques, a seafront
 * promenade and a marina. Pure data; meshes live in resortMesh.ts.
 */

export interface ResortLayout {
  /** Solid obstacles: buildings, the fountain rim and every railing (added to the city collider list). */
  colliders: Building[];
  /** Palm trunks and lamp posts, solid for cars and people. */
  posts: Post[];
  palms: Array<{ x: number; z: number; scale: number }>;
  lamps: Array<{ x: number; z: number }>;
  parking: Array<{ x: number; z: number; heading: number }>;
  fountain: { x: number; z: number; r: number };
  /** Where pedestrians walk. Node indexes start at 0; append with mergeWalkGraph. */
  walk: WalkGraph;
}

/** Fixed spots on the resort, kept off the city's `places()` because they are not on its grid. */
export const RESORT_PLACES = {
  /** Hotel «Лазурь»: rent a room on the boulevard. */
  hotel: { x: 0, z: 535 },
};

/** The three cross streets (not the boulevard): palms and lamps keep clear of their junctions. */
const CROSS_STREETS = RESORT_ROADS.filter((r) => r.x1 - r.x0 > 200);

/**
 * Circuits for the resort's moving traffic, keeping to the right: the east and
 * west halves each run boulevard, street A, a ring road and the seafront drive.
 */
export const RESORT_LOOPS: Array<Array<{ x: number; z: number }>> = [
  [{ x: 3, z: 493 }, { x: 165, z: 493 }, { x: 165, z: 647 }, { x: 3, z: 647 }],
  [{ x: -3, z: 493 }, { x: -3, z: 647 }, { x: -165, z: 647 }, { x: -165, z: 493 }],
];

const HOTEL_COLORS = [0xf6ead6, 0xf3d9c4, 0xe8f1f5, 0xf7f0e4, 0xd9e8f2];
const VILLA_COLORS = [0xf5e6d3, 0xf2c9a0, 0xe9f5e9, 0xf8e1e4, 0xfff3c4];
const SHOP_COLORS = [0xe17055, 0x00b5ad, 0xfdcb6e, 0xa29bfe, 0xff7675];

/** The four sorts of city block the generator can fill. */
type BlockStyle = "villas" | "hotels" | "plaza" | "boutiques";

interface Block {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  style: BlockStyle;
}

const COLUMNS: Array<[number, number]> = [
  [-158, -12],
  [12, 158],
];
const ROWS: Array<[number, number]> = [
  [430, 480],
  [500, 570],
  [590, 640],
];
const STYLES: BlockStyle[][] = [
  // [west, east] for each row
  ["villas", "villas"],
  ["hotels", "plaza"],
  ["boutiques", "hotels"],
];

export function resortBlocks(): Block[] {
  const blocks: Block[] = [];
  ROWS.forEach(([z0, z1], r) => COLUMNS.forEach(([x0, x1], c) => blocks.push({ x0, x1, z0, z1, style: STYLES[r][c] })));
  return blocks;
}

/** Width of the walking line outside a block. */
const WALK_MARGIN = 3;

function isClear(x: number, z: number, roads: Rect[], pad: number): boolean {
  return !roads.some((r) => x >= r.x0 - pad && x <= r.x1 + pad && z >= r.z0 - pad && z <= r.z1 + pad);
}

export function generateResort(rng: Rng): ResortLayout {
  const colliders: Building[] = [];
  const posts: Post[] = [];
  const palms: ResortLayout["palms"] = [];
  const lamps: ResortLayout["lamps"] = [];
  const box = (x: number, z: number, w: number, d: number, h: number, color: number, kind: Building["kind"]) => colliders.push({ x, z, w, d, h, color, kind });

  // Buildings by block style.
  let fountain = { x: 85, z: 535, r: 8 };
  for (const b of resortBlocks()) {
    const w = b.x1 - b.x0;
    const d = b.z1 - b.z0;
    const cx = (b.x0 + b.x1) / 2;
    const cz = (b.z0 + b.z1) / 2;
    if (b.style === "villas") {
      const n = 4;
      const lot = w / n;
      for (let i = 0; i < n; i++) {
        const vw = lot - 12 - rng.int(0, 4);
        const vd = 16 + rng.int(0, 4);
        box(b.x0 + lot * i + lot / 2, cz + rng.int(-4, 4), vw, vd, rng.int(6, 9), rng.pick(VILLA_COLORS), "house");
      }
    } else if (b.style === "hotels") {
      const n = 2;
      const lot = w / n;
      for (let i = 0; i < n; i++) {
        const hw = lot - 16 - rng.int(0, 6);
        const hd = Math.min(d - 14, 30 + rng.int(0, 8));
        box(b.x0 + lot * i + lot / 2, cz, hw, hd, rng.int(24, 44), rng.pick(HOTEL_COLORS), "tower");
      }
    } else if (b.style === "boutiques") {
      const n = 5;
      const lot = w / n;
      for (let i = 0; i < n; i++) box(b.x0 + lot * i + lot / 2, cz, lot - 6, 16 + rng.int(0, 4), rng.int(5, 8), rng.pick(SHOP_COLORS), "shop");
    } else {
      // Plaza: a fountain in the middle, palms in a ring around it.
      fountain = { x: cx, z: cz, r: 8 };
      box(cx, cz, 16, 16, 1.2, 0xb0bec5, "rail");
      for (let a = 0; a < 12; a++) {
        const ang = (a / 12) * Math.PI * 2;
        palms.push({ x: cx + Math.cos(ang) * 22, z: cz + Math.sin(ang) * 22, scale: 0.9 + rng.next() * 0.3 });
      }
      for (const px of [b.x0 + 14, b.x1 - 14]) for (const pz of [b.z0 + 12, b.z1 - 12]) palms.push({ x: px, z: pz, scale: 1 + rng.next() * 0.3 });
    }
    // Villa gardens and hotel forecourts get a few palms too.
    if (b.style === "villas") for (let i = 0; i < 6; i++) palms.push({ x: b.x0 + 8 + rng.next() * (w - 16), z: rng.chance(0.5) ? b.z0 + 5 : b.z1 - 5, scale: 0.8 + rng.next() * 0.4 });
  }

  // Palm-lined boulevard and streets: a palm every 14 m on both sides.
  for (let z = 436; z <= 646; z += 14) {
    for (const x of [-9.5, 9.5]) if (isClear(x, z, CROSS_STREETS, 4)) palms.push({ x, z, scale: 1 });
  }
  for (const zs of [490, 580]) {
    for (let x = -150; x <= 150; x += 14) {
      if (Math.abs(x) < 16) continue;
      for (const dz of [-8.5, 8.5]) palms.push({ x, z: zs + dz, scale: 0.95 });
    }
  }
  // Lamps: boulevard and streets.
  for (let z = 442; z <= 646; z += 24) for (const x of [-11.5, 11.5]) if (isClear(x, z, CROSS_STREETS, 3)) lamps.push({ x, z });
  for (const zs of [490, 580]) for (let x = -140; x <= 140; x += 28) if (Math.abs(x) > 18) lamps.push({ x: x + 7, z: zs - 8 });
  const keep = (p: { x: number; z: number }) => !colliders.some((c) => Math.abs(p.x - c.x) < c.w / 2 + 0.6 && Math.abs(p.z - c.z) < c.d / 2 + 0.6);
  const cleanPalms = palms.filter(keep);
  const cleanLamps = lamps.filter(keep);
  for (const p of cleanPalms) posts.push({ x: p.x, z: p.z, r: 0.35 });
  for (const l of cleanLamps) posts.push({ x: l.x, z: l.z, r: 0.28 });

  // Railings along the waterfront strips that belong to the resort and the south shore.
  for (const s of [southStrip(278), resortStrip(), ...resortEdgeStrips()]) colliders.push(...stripColliders(s));
  // The south bridge's own side rails, leaving both ends open.
  const bridgeLen = SOUTH_BRIDGE.z1 - SOUTH_BRIDGE.z0 - 24;
  for (const sx of [SOUTH_BRIDGE.x0 - 0.4, SOUTH_BRIDGE.x1 + 0.4]) {
    colliders.push({ x: sx, z: (SOUTH_BRIDGE.z0 + SOUTH_BRIDGE.z1) / 2, w: 0.6, d: bridgeLen, h: RAIL_HEIGHT, color: 0x9aa3ad, kind: "rail" });
  }

  // Cars along the kerbs, none where the hotel ring is or on the crossings.
  const parking: ResortLayout["parking"] = [];
  const spots: Array<[number, number, number]> = [];
  for (const z of [444, 466, 510, 552, 596, 620, 634]) {
    if (Math.abs(z - RESORT_PLACES.hotel.z) < 14) continue;
    spots.push([-4.6, z, Math.PI / 2], [4.6, z + 6, -Math.PI / 2]);
  }
  for (const [x, z, h] of [[-100, 487, 0], [-52, 493, Math.PI], [62, 487, 0], [110, 493, Math.PI], [-96, 577, 0], [-40, 583, Math.PI], [50, 577, 0], [104, 583, Math.PI]] as const) spots.push([x, z, h]);
  for (const [x, z, h] of spots) if (rng.chance(0.8)) parking.push({ x, z, heading: h });

  // Pedestrians: a walking line around every block, crossings between neighbours, and the promenade.
  const walk = buildResortWalk();
  return { colliders, posts, palms: cleanPalms, lamps: cleanLamps, parking, fountain, walk };
}

/** Walking network of the resort: same idea as the city's, a ring round each block joined at the crossings. */
export function buildResortWalk(): WalkGraph {
  const nodes: WalkGraph["nodes"] = [];
  const edges: number[][] = [];
  const add = (x: number, z: number) => {
    nodes.push({ x, z });
    edges.push([]);
    return nodes.length - 1;
  };
  const link = (a: number, b: number) => {
    edges[a].push(b);
    edges[b].push(a);
  };
  // ids[row][col] = [tl, tr, br, bl]
  const ids: number[][][] = ROWS.map(([z0, z1]) =>
    COLUMNS.map(([x0, x1]) => {
      const c = [add(x0 - WALK_MARGIN, z0 - WALK_MARGIN), add(x1 + WALK_MARGIN, z0 - WALK_MARGIN), add(x1 + WALK_MARGIN, z1 + WALK_MARGIN), add(x0 - WALK_MARGIN, z1 + WALK_MARGIN)];
      for (let i = 0; i < 4; i++) link(c[i], c[(i + 1) % 4]);
      return c;
    }),
  );
  for (let r = 0; r < ROWS.length; r++) {
    // Across the boulevard.
    link(ids[r][0][1], ids[r][1][0]);
    link(ids[r][0][2], ids[r][1][3]);
    // Across the streets.
    if (r + 1 < ROWS.length) {
      for (let c = 0; c < COLUMNS.length; c++) {
        link(ids[r][c][3], ids[r + 1][c][0]);
        link(ids[r][c][2], ids[r + 1][c][1]);
      }
    }
  }
  // The promenade, joined to the south corners of the last row.
  const promZ = RESORT.z1 - 19;
  const last = ids[ROWS.length - 1];
  const p = [COLUMNS[0][0] - WALK_MARGIN, COLUMNS[0][1] + WALK_MARGIN, COLUMNS[1][0] - WALK_MARGIN, COLUMNS[1][1] + WALK_MARGIN].map((x) => add(x, promZ));
  for (let i = 0; i + 1 < p.length; i++) link(p[i], p[i + 1]);
  link(p[0], last[0][3]);
  link(p[1], last[0][2]);
  link(p[2], last[1][3]);
  link(p[3], last[1][2]);
  // A short walk from the city side: the bridge end to the top of the boulevard.
  const gate = add(0, RESORT.z0 + 8);
  link(gate, ids[0][0][1]);
  link(gate, ids[0][1][0]);
  return { nodes, edges };
}

/** Append `extra` to `base` in place; returns the index of the first appended node. */
export function mergeWalkGraph(base: WalkGraph, extra: WalkGraph): number {
  const offset = base.nodes.length;
  base.nodes.push(...extra.nodes);
  for (const e of extra.edges) base.edges.push(e.map((i) => i + offset));
  return offset;
}
