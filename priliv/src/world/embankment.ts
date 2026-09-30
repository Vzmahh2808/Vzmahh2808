import type { Building } from "./city";
import { BRIDGE, CITY_EAST_SHORE, CITY_SOUTH_SHORE, PIERS, RESORT, RESORT_PIERS, SOUTH_BRIDGE } from "./island";

/**
 * Waterfronts: paved promenades between a road and the sea, fenced by a railing
 * (леер) with gaps only where a bridge or a marina pier meets the shore. A strip
 * runs along one axis; the sea lies on the `dir` side of `shore`. Plain data; the
 * meshes live in embankmentMesh.ts.
 */

/** Where the paving starts (the edge of the outer road) and where the quay wall stands. */
export const PROMENADE_X0 = 248;
export const RAIL_X = CITY_EAST_SHORE - 1.4;
export const RAIL_HEIGHT = 1.1;
export const RAIL_THICKNESS = 0.3;
/** How far behind the shore line the railing stands. */
export const RAIL_OFFSET = 1.4;

export interface Span {
  z0: number;
  z1: number;
}

export interface Strip {
  /** True when the strip runs along x (the shore is a z coordinate). */
  alongX: boolean;
  /** Coordinate of the shore line on the other axis. */
  shore: number;
  /** +1 when the sea is on the higher side of `shore`. */
  dir: 1 | -1;
  /** Extent of the strip along its axis. */
  from: number;
  to: number;
  /** Paving depth measured back from the shore. */
  depth: number;
  /** Openings along the axis (bridge, piers); z0/z1 here mean "start/end". */
  gaps: Span[];
}

/** The railed stretches between `from` and `to`, leaving out the gaps. */
export function spansBetween(from: number, to: number, gaps: Span[]): Span[] {
  const spans: Span[] = [];
  let z = from;
  for (const g of [...gaps].sort((a, b) => a.z0 - b.z0)) {
    if (g.z0 > z) spans.push({ z0: z, z1: g.z0 });
    z = Math.max(z, g.z1);
  }
  if (z < to) spans.push({ z0: z, z1: to });
  return spans;
}

export function stripSpans(s: Strip): Span[] {
  return spansBetween(s.from, s.to, s.gaps);
}

/** Position of the railing line. */
export function railLine(s: Strip): number {
  return s.shore - s.dir * RAIL_OFFSET;
}

/** Solid rails for collisions, as thin "rail" buildings. */
export function stripColliders(s: Strip): Building[] {
  const line = railLine(s);
  return stripSpans(s).map((sp) => {
    const mid = (sp.z0 + sp.z1) / 2;
    const len = sp.z1 - sp.z0;
    return s.alongX
      ? { x: mid, z: line, w: len, d: RAIL_THICKNESS, h: RAIL_HEIGHT, color: 0xcfd8dc, kind: "rail" as const }
      : { x: line, z: mid, w: RAIL_THICKNESS, d: len, h: RAIL_HEIGHT, color: 0xcfd8dc, kind: "rail" as const };
  });
}

/** Benches and lamp posts along a strip (positions along its axis, kept clear of the gaps). */
export function stripFurniture(s: Strip, from = s.from, to = s.to): { benches: number[]; lamps: number[] } {
  const clear = (z: number, pad: number) => s.gaps.every((g) => z < g.z0 - pad || z > g.z1 + pad);
  const benches: number[] = [];
  const lamps: number[] = [];
  for (let z = from + 20; z < to - 10; z += 36) if (clear(z, 3)) benches.push(z);
  for (let z = from + 8; z < to - 6; z += 24) if (clear(z, 3)) lamps.push(z);
  return { benches, lamps };
}

// ------------------------------------------------------------------ east shore

/** Stretches of the east shore that are open: the bridge road and the marina pier (with a little room either side). */
export function shoreGaps(): Span[] {
  const marina = PIERS[PIERS.length - 1];
  return [
    { z0: BRIDGE.z0 - 3, z1: BRIDGE.z1 + 3 },
    { z0: marina.z0 - 4, z1: marina.z1 + 4 },
  ].sort((a, b) => a.z0 - b.z0);
}

export function eastStrip(limit: number): Strip {
  return { alongX: false, shore: CITY_EAST_SHORE, dir: 1, from: -limit, to: limit, depth: CITY_EAST_SHORE - PROMENADE_X0, gaps: shoreGaps() };
}

/** The railed stretches along the whole east shore from -limit to +limit. */
export function railSpans(limit: number): Span[] {
  return stripSpans(eastStrip(limit));
}

export function embankmentColliders(limit: number): Building[] {
  return stripColliders(eastStrip(limit));
}

/** Benches and lamp posts along the east promenade. */
export function promenadeFurniture(limit: number): { benches: number[]; lamps: number[] } {
  return stripFurniture(eastStrip(limit), -limit, limit);
}

// ------------------------------------------------------------------ south shore and resort

/** The city's southern promenade, open only where the south bridge lands. */
export function southStrip(limit: number): Strip {
  return { alongX: true, shore: CITY_SOUTH_SHORE, dir: 1, from: -limit, to: CITY_EAST_SHORE, depth: 20, gaps: [{ z0: SOUTH_BRIDGE.x0 - 3, z1: SOUTH_BRIDGE.x1 + 3 }] };
}

/** The resort's seafront promenade, open at the two marina piers. */
export function resortStrip(): Strip {
  return {
    alongX: true,
    shore: RESORT.z1,
    dir: 1,
    from: RESORT.x0,
    to: RESORT.x1,
    depth: 38,
    gaps: RESORT_PIERS.map((p) => ({ z0: p.x0 - 4, z1: p.x1 + 4 })),
  };
}

/** Bare railings round the rest of the resort's shore (no paving), open only where the bridge lands. */
export function resortEdgeStrips(): Strip[] {
  return [
    { alongX: false, shore: RESORT.x0, dir: -1, from: RESORT.z0, to: RESORT.z1, depth: 0, gaps: [] },
    { alongX: false, shore: RESORT.x1, dir: 1, from: RESORT.z0, to: RESORT.z1, depth: 0, gaps: [] },
    { alongX: true, shore: RESORT.z0, dir: -1, from: RESORT.x0, to: RESORT.x1, depth: 0, gaps: [{ z0: SOUTH_BRIDGE.x0 - 3, z1: SOUTH_BRIDGE.x1 + 3 }] },
  ];
}

/** Every waterfront strip with railings, for colliders and meshes. */
export function allStrips(limit: number): Strip[] {
  return [eastStrip(limit), southStrip(limit), resortStrip(), ...resortEdgeStrips()];
}
