import type { Point, Tile } from "./types";
import { DIRS4 } from "./world";

interface Grid {
  width: number;
  height: number;
  tiles: Tile[];
}

/**
 * Dijkstra over 4-connected tiles with a per-tile entry cost. Returns the path
 * excluding the start tile, or null when the target is unreachable.
 */
export function findPath(grid: Grid, from: Point, to: Point, costOf: (t: Tile, p: Point) => number): Point[] | null {
  const { width, height } = grid;
  if (to.x < 0 || to.y < 0 || to.x >= width || to.y >= height) return null;
  const n = width * height;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const startIdx = from.y * width + from.x;
  const goalIdx = to.y * width + to.x;
  dist[startIdx] = 0;
  // Binary heap of [cost, idx].
  const heap: [number, number][] = [[0, startIdx]];
  const push = (item: [number, number]) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = (): [number, number] => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  while (heap.length) {
    const [d, idx] = pop();
    if (done[idx]) continue;
    done[idx] = 1;
    if (idx === goalIdx) break;
    const x = idx % width;
    const y = (idx - x) / width;
    for (const dir of DIRS4) {
      const nx = x + dir.x;
      const ny = y + dir.y;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const ni = ny * width + nx;
      if (done[ni]) continue;
      const c = costOf(grid.tiles[ni], { x: nx, y: ny });
      if (!(c > 0) || !Number.isFinite(c)) continue;
      const nd = d + c;
      if (nd < dist[ni]) {
        dist[ni] = nd;
        prev[ni] = idx;
        push([nd, ni]);
      }
    }
  }
  if (!Number.isFinite(dist[goalIdx])) return null;
  const path: Point[] = [];
  for (let cur = goalIdx; cur !== startIdx; cur = prev[cur]) {
    path.push({ x: cur % width, y: Math.floor(cur / width) });
    if (cur < 0) return null;
  }
  return path.reverse();
}
