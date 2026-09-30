import { CATEGORIES, CP_NAMES, TERRAIN } from "./data";
import type { Rng } from "./rng";
import type { Category, Checkpoint, Point, Terrain, Tile } from "./types";

export interface World {
  width: number;
  height: number;
  tiles: Tile[];
  start: Point;
  finish: Point;
  checkpoints: Checkpoint[];
}

export const DIRS4: readonly Point[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

export function inBounds(w: number, h: number, p: Point): boolean {
  return p.x >= 0 && p.y >= 0 && p.x < w && p.y < h;
}

export function tileAt(world: { width: number; height: number; tiles: Tile[] }, p: Point): Tile | null {
  if (!inBounds(world.width, world.height, p)) return null;
  return world.tiles[p.y * world.width + p.x];
}

export function isPassable(t: Terrain): boolean {
  return TERRAIN[t].passable;
}

export function samePoint(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}

/** Smooth value noise: random lattice + bilinear interpolation, three octaves. */
function noiseField(rng: Rng, w: number, h: number): number[] {
  const out = new Array<number>(w * h).fill(0);
  const octaves = [
    { cell: 7, amp: 1 },
    { cell: 3.5, amp: 0.45 },
    { cell: 1.7, amp: 0.2 },
  ];
  for (const o of octaves) {
    const gw = Math.ceil(w / o.cell) + 2;
    const gh = Math.ceil(h / o.cell) + 2;
    const lattice: number[] = [];
    for (let i = 0; i < gw * gh; i++) lattice.push(rng.next());
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const fx = x / o.cell;
        const fy = y / o.cell;
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const tx = smooth(fx - x0);
        const ty = smooth(fy - y0);
        const v00 = lattice[y0 * gw + x0];
        const v10 = lattice[y0 * gw + x0 + 1];
        const v01 = lattice[(y0 + 1) * gw + x0];
        const v11 = lattice[(y0 + 1) * gw + x0 + 1];
        const v = lerp(lerp(v00, v10, tx), lerp(v01, v11, tx), ty);
        out[y * w + x] += v * o.amp;
      }
    }
  }
  return out;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function percentile(sorted: number[], share: number): number {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * share)));
  return sorted[i];
}

/** Breadth-first distances over passable tiles, 4-connected. -1 = unreachable. */
export function bfsDistances(world: { width: number; height: number; tiles: Tile[] }, from: Point, passable: (t: Tile) => boolean = (t) => isPassable(t.t)): Int32Array {
  const { width, height } = world;
  const dist = new Int32Array(width * height).fill(-1);
  const queue: number[] = [from.y * width + from.x];
  dist[queue[0]] = 0;
  for (let qi = 0; qi < queue.length; qi++) {
    const idx = queue[qi];
    const x = idx % width;
    const y = (idx - x) / width;
    for (const d of DIRS4) {
      const nx = x + d.x;
      const ny = y + d.y;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const ni = ny * width + nx;
      if (dist[ni] !== -1 || !passable(world.tiles[ni])) continue;
      dist[ni] = dist[idx] + 1;
      queue.push(ni);
    }
  }
  return dist;
}

/** Labels connected components of passable tiles; returns labels (-1 for impassable) and the count. */
function components(w: number, h: number, tiles: Tile[]): { labels: Int32Array; count: number } {
  const labels = new Int32Array(w * h).fill(-1);
  let count = 0;
  for (let i = 0; i < tiles.length; i++) {
    if (labels[i] !== -1 || !isPassable(tiles[i].t)) continue;
    const stack = [i];
    labels[i] = count;
    while (stack.length) {
      const idx = stack.pop()!;
      const x = idx % w;
      const y = (idx - x) / w;
      for (const d of DIRS4) {
        const nx = x + d.x;
        const ny = y + d.y;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (labels[ni] === -1 && isPassable(tiles[ni].t)) {
          labels[ni] = count;
          stack.push(ni);
        }
      }
    }
    count++;
  }
  return { labels, count };
}

/**
 * Connects every component to the largest one by carving the shortest corridor
 * through rock (and, failing that, lakes). The highest tile of a corridor becomes a
 * pass, the rest becomes scree, so ridges stay ridges and gaps become saddles.
 */
function connectComponents(w: number, h: number, tiles: Tile[]): void {
  for (let guard = 0; guard < 64; guard++) {
    const { labels, count } = components(w, h, tiles);
    if (count <= 1) return;
    const sizes = new Array<number>(count).fill(0);
    for (const l of labels) if (l >= 0) sizes[l]++;
    let main = 0;
    for (let i = 1; i < count; i++) if (sizes[i] > sizes[main]) main = i;

    const carveThrough = (allowLake: boolean): boolean => {
      const prev = new Int32Array(w * h).fill(-2);
      const queue: number[] = [];
      for (let i = 0; i < tiles.length; i++) {
        if (labels[i] === main) {
          prev[i] = -1;
          queue.push(i);
        }
      }
      let hit = -1;
      for (let qi = 0; qi < queue.length && hit < 0; qi++) {
        const idx = queue[qi];
        const x = idx % w;
        const y = (idx - x) / w;
        for (const d of DIRS4) {
          const nx = x + d.x;
          const ny = y + d.y;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const ni = ny * w + nx;
          if (prev[ni] !== -2) continue;
          const t = tiles[ni].t;
          if (labels[ni] >= 0 && labels[ni] !== main) {
            prev[ni] = idx;
            hit = ni;
            break;
          }
          if (t === "rock" || (allowLake && t === "lake")) {
            prev[ni] = idx;
            queue.push(ni);
          }
        }
      }
      if (hit < 0) return false;
      const path: number[] = [];
      for (let cur = prev[hit]; cur >= 0 && labels[cur] !== main; cur = prev[cur]) path.push(cur);
      if (path.length === 0) return true;
      let top = path[0];
      for (const i of path) if (tiles[i].h > tiles[top].h) top = i;
      for (const i of path) {
        if (tiles[i].t === "lake") tiles[i] = { t: "swamp", h: tiles[i].h };
        else tiles[i] = { t: i === top ? "pass" : "scree", h: tiles[i].h };
      }
      return true;
    };
    if (!carveThrough(false) && !carveThrough(true)) return;
  }
}

function traceRiver(rng: Rng, w: number, h: number, tiles: Tile[], source: number): number[] {
  const path: number[] = [];
  let cur = source;
  const seen = new Set<number>();
  for (let step = 0; step < w + h; step++) {
    seen.add(cur);
    const x = cur % w;
    const y = (cur - x) / w;
    let best = -1;
    // Allow a slight climb so a river does not die in the first noise pocket.
    let bestH = tiles[cur].h + 0.04;
    for (const d of rng.shuffle([...DIRS4])) {
      const nx = x + d.x;
      const ny = y + d.y;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) return path;
      const ni = ny * w + nx;
      if (seen.has(ni)) continue;
      const t = tiles[ni].t;
      if (t === "rock" || t === "pass" || t === "peak") continue;
      // Keep the channel one tile wide: the next tile may touch only the current one.
      const touchesPath = DIRS4.some((e) => {
        const ax = nx + e.x;
        const ay = ny + e.y;
        const ai = ay * w + ax;
        return ax >= 0 && ay >= 0 && ax < w && ay < h && ai !== cur && seen.has(ai);
      });
      if (touchesPath) continue;
      if (t === "lake" || t === "river") {
        path.push(ni);
        return path;
      }
      if (tiles[ni].h < bestH) {
        bestH = tiles[ni].h;
        best = ni;
      }
    }
    if (best < 0) return path;
    path.push(best);
    cur = best;
  }
  return path;
}

/** Farthest-point sampling over BFS distance, so checkpoints spread across the map. */
function pickCheckpoints(rng: Rng, world: World, count: number): Point[] {
  const { width, height, tiles } = world;
  const candidates: number[] = [];
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i].t;
    if (t === "meadow" || t === "forest" || t === "scree" || t === "swamp") candidates.push(i);
  }
  const anchors: Point[] = [world.start, world.finish];
  const chosen: Point[] = [];
  const fields = [world.start, world.finish].map((p) => bfsDistances(world, p));
  for (let k = 0; k < count; k++) {
    let best = -1;
    let bestScore = -1;
    for (const idx of candidates) {
      let minD = Infinity;
      for (const f of fields) {
        const d = f[idx];
        if (d < 0) {
          minD = -1;
          break;
        }
        minD = Math.min(minD, d);
      }
      if (minD < 0) continue;
      const score = minD + rng.next() * 2;
      if (score > bestScore) {
        bestScore = score;
        best = idx;
      }
    }
    if (best < 0) break;
    const p = { x: best % width, y: Math.floor(best / width) };
    chosen.push(p);
    anchors.push(p);
    fields.push(bfsDistances(world, p));
  }
  void height;
  return chosen;
}

/**
 * Extra passes through ridges, so the route usually has a choice of saddles.
 * A candidate is a short run of rock (up to three tiles) with walkable ground on
 * both ends, far from existing passes. The lowest of the shortest runs is carved:
 * its highest tile becomes the pass, the rest scree.
 */
function addSaddles(w: number, h: number, tiles: Tile[], count: number): void {
  const grid = { width: w, height: h, tiles };
  const open = (p: Point) => {
    const t = tileAt(grid, p);
    return t !== null && isPassable(t.t) && t.t !== "pass" && t.t !== "peak";
  };
  const passes: Point[] = [];
  for (let i = 0; i < tiles.length; i++) if (tiles[i].t === "pass") passes.push({ x: i % w, y: Math.floor(i / w) });
  for (let k = 0; k < count; k++) {
    let best: number[] | null = null;
    let bestKey = Infinity;
    for (let i = 0; i < tiles.length; i++) {
      if (tiles[i].t !== "rock") continue;
      const x = i % w;
      const y = (i - x) / w;
      if (passes.some((p) => Math.abs(p.x - x) + Math.abs(p.y - y) < 6)) continue;
      for (const d of [
        { x: 1, y: 0 },
        { x: 0, y: 1 },
      ]) {
        // Only start runs at their first rock tile so each run is considered once.
        if (tiles[(y - d.y) * w + (x - d.x)]?.t === "rock" && inBounds(w, h, { x: x - d.x, y: y - d.y })) continue;
        if (!open({ x: x - d.x, y: y - d.y })) continue;
        const run: number[] = [];
        let cx = x;
        let cy = y;
        while (run.length < 3 && inBounds(w, h, { x: cx, y: cy }) && tiles[cy * w + cx].t === "rock") {
          run.push(cy * w + cx);
          cx += d.x;
          cy += d.y;
        }
        if (!open({ x: cx, y: cy })) continue;
        let top = run[0];
        for (const r of run) if (tiles[r].h > tiles[top].h) top = r;
        const key = run.length * 10 + tiles[top].h;
        if (key < bestKey) {
          bestKey = key;
          best = run;
        }
      }
    }
    if (!best) return;
    let top = best[0];
    for (const r of best) if (tiles[r].h > tiles[top].h) top = r;
    for (const r of best) tiles[r] = { t: r === top ? "pass" : "scree", h: tiles[r].h };
    passes.push({ x: top % w, y: Math.floor(top / w) });
  }
}

export function generateWorld(rng: Rng, category: Category): World {
  const def = CATEGORIES[category];
  const w = def.width;
  const h = def.height;
  const field = noiseField(rng, w, h);
  const rng0 = rng.next();
  // Bias: a mountain band across the middle so the route has to cross a ridge.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cx = (x / (w - 1)) * 2 - 1;
      const cy = (y / (h - 1)) * 2 - 1;
      // The ridge wanders: its centre line is shifted by a slow sine so it is not a straight wall.
      const wobble = Math.sin(cy * 2.3 + rng0 * 6.28) * 0.18;
      const band = Math.exp(-(((cx - wobble) * 1.15) ** 2) * 2.5) * 0.55;
      const edge = Math.abs(cx) > 0.9 ? -0.3 : 0;
      field[y * w + x] += band + edge;
    }
  }
  const sorted = [...field].sort((a, b) => a - b);
  const lo = sorted[0];
  const hi = sorted[sorted.length - 1];
  const rockLine = percentile(sorted, 1 - def.rockShare);
  const glacierLine = percentile(sorted, 1 - def.rockShare - 0.05);
  const screeLine = percentile(sorted, 1 - def.rockShare - 0.18);
  const forestLine = percentile(sorted, 0.3);
  const swampLine = percentile(sorted, 0.09);
  const lakeLine = percentile(sorted, 0.035);

  const tiles: Tile[] = field.map((v) => {
    const hn = (v - lo) / Math.max(1e-6, hi - lo);
    let t: Terrain;
    if (v >= rockLine) t = "rock";
    else if (v >= glacierLine) t = "glacier";
    else if (v >= screeLine) t = "scree";
    else if (v >= forestLine) t = "forest";
    else if (v >= swampLine) t = "meadow";
    else if (v >= lakeLine) t = "swamp";
    else t = "lake";
    return { t, h: hn };
  });

  // Rivers from high ground down to a lake or the map edge.
  const sources: number[] = [];
  for (let i = 0; i < tiles.length; i++) if (tiles[i].t === "scree" || tiles[i].t === "glacier") sources.push(i);
  rng.shuffle(sources);
  let rivers = 0;
  for (const src of sources) {
    if (rivers >= def.rivers) break;
    const path = traceRiver(rng, w, h, tiles, src);
    if (path.length < 8) continue;
    const bridgeAt = path[rng.int(1, path.length - 2)];
    for (const i of path) {
      if (tiles[i].t === "lake" || tiles[i].t === "river" || tiles[i].t === "bridge") continue;
      tiles[i] = { t: i === bridgeAt ? "bridge" : "river", h: tiles[i].h };
    }
    rivers++;
  }

  // Peaks: rock tiles that touch passable ground become optional summits.
  let peaks = 0;
  const rockIdx: number[] = [];
  for (let i = 0; i < tiles.length; i++) if (tiles[i].t === "rock") rockIdx.push(i);
  rockIdx.sort((a, b) => tiles[b].h - tiles[a].h);
  for (const i of rockIdx) {
    if (peaks >= def.peaks) break;
    const x = i % w;
    const y = (i - x) / w;
    const touches = DIRS4.some((d) => {
      const n = tileAt({ width: w, height: h, tiles }, { x: x + d.x, y: y + d.y });
      return n !== null && (n.t === "scree" || n.t === "glacier");
    });
    if (!touches) continue;
    tiles[i] = { t: "peak", h: tiles[i].h };
    peaks++;
  }

  // Start and finish villages: lowland tiles near the left and right edges.
  const villageSpot = (xMin: number, xMax: number): Point => {
    const opts: Point[] = [];
    for (let y = 1; y < h - 1; y++) {
      for (let x = xMin; x <= xMax; x++) {
        const t = tiles[y * w + x].t;
        if (t === "meadow" || t === "forest") opts.push({ x, y });
      }
    }
    if (opts.length === 0) {
      const p = { x: xMin, y: Math.floor(h / 2) };
      tiles[p.y * w + p.x] = { t: "meadow", h: 0.2 };
      return p;
    }
    return rng.pick(opts);
  };
  const start = villageSpot(1, 3);
  const finish = villageSpot(w - 4, w - 2);
  tiles[start.y * w + start.x] = { t: "village", h: tiles[start.y * w + start.x].h };
  tiles[finish.y * w + finish.x] = { t: "village", h: tiles[finish.y * w + finish.x].h };

  connectComponents(w, h, tiles);
  addSaddles(w, h, tiles, category);

  const world: World = { width: w, height: h, tiles, start, finish, checkpoints: [] };
  const names = rng.shuffle([...CP_NAMES]);
  world.checkpoints = pickCheckpoints(rng, world, def.checkpoints).map((pos, i) => ({ id: i + 1, pos, name: names[i % names.length], taken: false }));
  return world;
}
