import type { Rng } from "./rng";
import { Tile, type Point, type Room, type TileMap } from "./types";

export interface DungeonOptions {
  width: number;
  height: number;
  maxRooms: number;
  minRoomSize: number;
  maxRoomSize: number;
  extraConnections: number;
}

export const DEFAULT_DUNGEON: DungeonOptions = {
  width: 64,
  height: 40,
  maxRooms: 14,
  minRoomSize: 4,
  maxRoomSize: 10,
  extraConnections: 2,
};

export function roomCenter(r: Room): Point {
  return { x: Math.floor(r.x + r.w / 2), y: Math.floor(r.y + r.h / 2) };
}

export function idx(map: TileMap, x: number, y: number): number {
  return y * map.width + x;
}

export function inBounds(map: TileMap, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < map.width && y < map.height;
}

export function tileAt(map: TileMap, x: number, y: number): Tile {
  if (!inBounds(map, x, y)) return Tile.Wall;
  return map.tiles[idx(map, x, y)];
}

export function isPassable(map: TileMap, x: number, y: number): boolean {
  const t = tileAt(map, x, y);
  return t === Tile.Floor || t === Tile.Door || t === Tile.StairsDown;
}

export function blocksSight(map: TileMap, x: number, y: number): boolean {
  return tileAt(map, x, y) === Tile.Wall;
}

function roomsOverlap(a: Room, b: Room, margin: number): boolean {
  return (
    a.x - margin < b.x + b.w &&
    a.x + a.w + margin > b.x &&
    a.y - margin < b.y + b.h &&
    a.y + a.h + margin > b.y
  );
}

function carveRoom(map: TileMap, r: Room): void {
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      map.tiles[idx(map, x, y)] = Tile.Floor;
    }
  }
}

/** True when (x, y) lies on the one-tile ring just outside a room. */
function onRoomRing(rooms: Room[], x: number, y: number): boolean {
  for (const r of rooms) {
    const insideX = x >= r.x && x < r.x + r.w;
    const insideY = y >= r.y && y < r.y + r.h;
    if (insideX && insideY) return false;
    const onVertical = (x === r.x - 1 || x === r.x + r.w) && insideY;
    const onHorizontal = (y === r.y - 1 || y === r.y + r.h) && insideX;
    if (onVertical || onHorizontal) return true;
  }
  return false;
}

function carveLine(map: TileMap, rooms: Room[], from: Point, to: Point, doors: Set<number>): void {
  let { x, y } = from;
  const step = (nx: number, ny: number) => {
    const i = idx(map, nx, ny);
    if (map.tiles[i] === Tile.Wall) {
      map.tiles[i] = Tile.Floor;
      if (onRoomRing(rooms, nx, ny)) doors.add(i);
    }
  };
  step(x, y);
  while (x !== to.x) {
    x += Math.sign(to.x - x);
    step(x, y);
  }
  while (y !== to.y) {
    y += Math.sign(to.y - y);
    step(x, y);
  }
}

function connect(map: TileMap, rooms: Room[], a: Room, b: Room, rng: Rng, doors: Set<number>): void {
  const ca = roomCenter(a);
  const cb = roomCenter(b);
  if (rng.chance(0.5)) {
    carveLine(map, rooms, ca, { x: cb.x, y: ca.y }, doors);
    carveLine(map, rooms, { x: cb.x, y: ca.y }, cb, doors);
  } else {
    carveLine(map, rooms, ca, { x: ca.x, y: cb.y }, doors);
    carveLine(map, rooms, { x: ca.x, y: cb.y }, cb, doors);
  }
}

/** Doors only make sense where a corridor pierces a wall; drop ones that ended up in open space. */
function finalizeDoors(map: TileMap, doors: Set<number>): void {
  for (const i of doors) {
    const x = i % map.width;
    const y = Math.floor(i / map.width);
    const wallN = tileAt(map, x, y - 1) === Tile.Wall;
    const wallS = tileAt(map, x, y + 1) === Tile.Wall;
    const wallW = tileAt(map, x - 1, y) === Tile.Wall;
    const wallE = tileAt(map, x + 1, y) === Tile.Wall;
    const vertical = wallW && wallE && !wallN && !wallS;
    const horizontal = wallN && wallS && !wallW && !wallE;
    if (vertical || horizontal) map.tiles[i] = Tile.Door;
  }
}

export function generateDungeon(rng: Rng, opts: DungeonOptions = DEFAULT_DUNGEON): TileMap {
  const map: TileMap = {
    width: opts.width,
    height: opts.height,
    tiles: new Array<Tile>(opts.width * opts.height).fill(Tile.Wall),
    explored: new Array<boolean>(opts.width * opts.height).fill(false),
    rooms: [],
  };

  const attempts = opts.maxRooms * 8;
  for (let i = 0; i < attempts && map.rooms.length < opts.maxRooms; i++) {
    const w = rng.int(opts.minRoomSize, opts.maxRoomSize);
    const h = rng.int(opts.minRoomSize, Math.max(opts.minRoomSize, Math.floor(opts.maxRoomSize * 0.7)));
    const x = rng.int(1, opts.width - w - 2);
    const y = rng.int(1, opts.height - h - 2);
    const candidate: Room = { x, y, w, h };
    if (map.rooms.some((r) => roomsOverlap(r, candidate, 2))) continue;
    map.rooms.push(candidate);
    carveRoom(map, candidate);
  }

  // Guarantee at least two rooms so stairs can be far from the start.
  if (map.rooms.length < 2) {
    const fallback: Room[] = [
      { x: 2, y: 2, w: 6, h: 5 },
      { x: opts.width - 9, y: opts.height - 8, w: 6, h: 5 },
    ];
    for (const r of fallback) {
      if (!map.rooms.some((o) => roomsOverlap(o, r, 1))) {
        map.rooms.push(r);
        carveRoom(map, r);
      }
    }
  }

  const doors = new Set<number>();
  const ordered = [...map.rooms].sort((a, b) => roomCenter(a).x - roomCenter(b).x);
  for (let i = 0; i + 1 < ordered.length; i++) {
    connect(map, map.rooms, ordered[i], ordered[i + 1], rng, doors);
  }
  for (let i = 0; i < opts.extraConnections && ordered.length > 2; i++) {
    const a = rng.pick(ordered);
    const b = rng.pick(ordered);
    if (a !== b) connect(map, map.rooms, a, b, rng, doors);
  }
  finalizeDoors(map, doors);

  // Stairs go in the room farthest from the first (starting) room.
  const start = roomCenter(map.rooms[0]);
  let best = map.rooms[1] ?? map.rooms[0];
  let bestDist = -1;
  for (const r of map.rooms.slice(1)) {
    const c = roomCenter(r);
    const d = Math.abs(c.x - start.x) + Math.abs(c.y - start.y);
    if (d > bestDist) {
      bestDist = d;
      best = r;
    }
  }
  const stairs = roomCenter(best);
  map.tiles[idx(map, stairs.x, stairs.y)] = Tile.StairsDown;
  return map;
}

export function findTile(map: TileMap, tile: Tile): Point | null {
  for (let i = 0; i < map.tiles.length; i++) {
    if (map.tiles[i] === tile) return { x: i % map.width, y: Math.floor(i / map.width) };
  }
  return null;
}
