import { BLOCK_SIZE, ROAD_WIDTH, roadCoord, type CityLayout } from "./city";

/** Distance from the kerb-side block edge to the walking line, inside the sidewalk band. */
export const WALK_INSET = 2.2;

export interface WalkNode {
  x: number;
  z: number;
}

export interface WalkGraph {
  nodes: WalkNode[];
  edges: number[][];
}

/**
 * Walking network: a ring of four corner nodes around every block, joined to the
 * facing corners of neighbouring blocks by crosswalks.
 */
export function buildWalkGraph(layout: CityLayout): WalkGraph {
  const n = layout.n;
  const nodes: WalkNode[] = [];
  const edges: number[][] = [];
  const id = (bx: number, bz: number, corner: number) => (bz * n + bx) * 4 + corner;
  // Corner order: 0 = (-x,-z), 1 = (+x,-z), 2 = (+x,+z), 3 = (-x,+z).
  for (let bz = 0; bz < n; bz++) {
    for (let bx = 0; bx < n; bx++) {
      const x0 = roadCoord(n, bx) + ROAD_WIDTH / 2 - WALK_INSET;
      const z0 = roadCoord(n, bz) + ROAD_WIDTH / 2 - WALK_INSET;
      const x1 = roadCoord(n, bx) + ROAD_WIDTH / 2 + BLOCK_SIZE + WALK_INSET;
      const z1 = roadCoord(n, bz) + ROAD_WIDTH / 2 + BLOCK_SIZE + WALK_INSET;
      nodes.push({ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 });
      for (let c = 0; c < 4; c++) edges.push([]);
    }
  }
  const link = (a: number, b: number) => {
    edges[a].push(b);
    edges[b].push(a);
  };
  for (let bz = 0; bz < n; bz++) {
    for (let bx = 0; bx < n; bx++) {
      for (let c = 0; c < 4; c++) link(id(bx, bz, c), id(bx, bz, (c + 1) % 4));
      if (bx + 1 < n) {
        link(id(bx, bz, 1), id(bx + 1, bz, 0));
        link(id(bx, bz, 2), id(bx + 1, bz, 3));
      }
      if (bz + 1 < n) {
        link(id(bx, bz, 3), id(bx, bz + 1, 0));
        link(id(bx, bz, 2), id(bx, bz + 1, 1));
      }
    }
  }
  return { nodes, edges };
}

export function nearestNode(g: WalkGraph, x: number, z: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < g.nodes.length; i++) {
    const d = (g.nodes[i].x - x) ** 2 + (g.nodes[i].z - z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}
