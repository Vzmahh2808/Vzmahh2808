import type { Point, TileMap } from "./types";
import { idx, inBounds, isPassable } from "./dungeon";

export const DIRS8: readonly Point[] = [
  { x: 0, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: 0 },
  { x: -1, y: -1 },
];

export const UNREACHABLE = 1e9;

/**
 * Breadth-first distance map from one or more sources over passable tiles.
 * `blocked` may mark extra impassable cells (e.g. monsters). Diagonal moves are allowed
 * unless both orthogonal neighbours are walls (no squeezing through corners).
 */
export function distanceMap(
  map: TileMap,
  sources: Point[],
  blocked?: (x: number, y: number) => boolean,
  limit = UNREACHABLE,
): Int32Array {
  const dist = new Int32Array(map.width * map.height).fill(UNREACHABLE);
  const queue: number[] = [];
  for (const s of sources) {
    if (!inBounds(map, s.x, s.y)) continue;
    const i = idx(map, s.x, s.y);
    dist[i] = 0;
    queue.push(i);
  }
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    const cd = dist[cur];
    if (cd >= limit) continue;
    const cx = cur % map.width;
    const cy = Math.floor(cur / map.width);
    for (const d of DIRS8) {
      const nx = cx + d.x;
      const ny = cy + d.y;
      if (!canStep(map, cx, cy, nx, ny)) continue;
      if (blocked && blocked(nx, ny)) continue;
      const ni = idx(map, nx, ny);
      if (dist[ni] !== UNREACHABLE) continue;
      dist[ni] = cd + 1;
      queue.push(ni);
    }
  }
  return dist;
}

/** Movement rule shared by the player, monsters and pathfinding. */
export function canStep(map: TileMap, fx: number, fy: number, tx: number, ty: number): boolean {
  if (!isPassable(map, tx, ty)) return false;
  const dx = tx - fx;
  const dy = ty - fy;
  if (dx !== 0 && dy !== 0) {
    // Diagonal: forbid cutting a corner when both side tiles are impassable.
    if (!isPassable(map, fx + dx, fy) && !isPassable(map, fx, fy + dy)) return false;
  }
  return true;
}

/** Trace the descending-distance path from `from` toward any zero-distance source. */
export function pathFromDistance(map: TileMap, dist: Int32Array, from: Point): Point[] {
  const path: Point[] = [];
  let { x, y } = from;
  let guard = map.width * map.height;
  while (dist[idx(map, x, y)] > 0 && guard-- > 0) {
    let best: Point | null = null;
    let bestD = dist[idx(map, x, y)];
    for (const d of DIRS8) {
      const nx = x + d.x;
      const ny = y + d.y;
      if (!inBounds(map, nx, ny) || !canStep(map, x, y, nx, ny)) continue;
      const nd = dist[idx(map, nx, ny)];
      if (nd < bestD) {
        bestD = nd;
        best = { x: nx, y: ny };
      }
    }
    if (!best) return [];
    path.push(best);
    x = best.x;
    y = best.y;
  }
  return path;
}

export function chebyshev(a: Point, b: Point): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}
