import type { Building } from "./city";
import { BRIDGE, CITY_EAST_SHORE, PIERS } from "./island";

/**
 * The city's waterfront: a paved promenade between the outer road and the sea,
 * fenced by a railing (леер) with gaps only where the bridge and the marina pier
 * meet the shore. Plain data; the meshes live in embankmentMesh.ts.
 */

/** Where the paving starts (the edge of the outer road) and where the quay wall stands. */
export const PROMENADE_X0 = 248;
export const RAIL_X = CITY_EAST_SHORE - 1.4;
export const RAIL_HEIGHT = 1.1;
export const RAIL_THICKNESS = 0.3;

export interface Span {
  z0: number;
  z1: number;
}

/** Stretches of the shore that are open: the bridge road and the marina pier (with a little room either side). */
export function shoreGaps(): Span[] {
  const marina = PIERS[PIERS.length - 1];
  return [
    { z0: BRIDGE.z0 - 3, z1: BRIDGE.z1 + 3 },
    { z0: marina.z0 - 4, z1: marina.z1 + 4 },
  ].sort((a, b) => a.z0 - b.z0);
}

/** The railed stretches along the whole shore from -limit to +limit. */
export function railSpans(limit: number): Span[] {
  const spans: Span[] = [];
  let z = -limit;
  for (const g of shoreGaps()) {
    if (g.z0 > z) spans.push({ z0: z, z1: g.z0 });
    z = Math.max(z, g.z1);
  }
  if (z < limit) spans.push({ z0: z, z1: limit });
  return spans;
}

/** Solid rails for collisions, as thin "rail" buildings. */
export function embankmentColliders(limit: number): Building[] {
  return railSpans(limit).map((s) => ({
    x: RAIL_X,
    z: (s.z0 + s.z1) / 2,
    w: RAIL_THICKNESS,
    d: s.z1 - s.z0,
    h: RAIL_HEIGHT,
    color: 0xcfd8dc,
    kind: "rail" as const,
  }));
}

/** Benches and lamp posts along the promenade (z positions, kept clear of the gaps). */
export function promenadeFurniture(limit: number): { benches: number[]; lamps: number[] } {
  const gaps = shoreGaps();
  const clear = (z: number, pad: number) => gaps.every((g) => z < g.z0 - pad || z > g.z1 + pad);
  const benches: number[] = [];
  const lamps: number[] = [];
  for (let z = -limit + 20; z < limit - 10; z += 36) if (clear(z, 3)) benches.push(z);
  for (let z = -limit + 8; z < limit - 6; z += 24) if (clear(z, 3)) lamps.push(z);
  return { benches, lamps };
}
