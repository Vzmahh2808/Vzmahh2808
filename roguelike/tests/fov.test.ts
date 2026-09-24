import { describe, expect, it } from "vitest";
import { computeFov } from "../src/game/fov";
import { idx } from "../src/game/dungeon";
import { Tile, type TileMap } from "../src/game/types";

function mapFrom(rows: string[]): TileMap {
  const height = rows.length;
  const width = rows[0].length;
  const tiles: Tile[] = [];
  for (const row of rows) for (const ch of row) tiles.push(ch === "#" ? Tile.Wall : Tile.Floor);
  return { width, height, tiles, explored: new Array(width * height).fill(false), rooms: [] };
}

describe("computeFov", () => {
  it("sees the whole open room and its walls", () => {
    const map = mapFrom(["#######", "#.....#", "#.....#", "#.....#", "#######"]);
    const vis = computeFov(map, 3, 2, 8);
    for (let i = 0; i < map.tiles.length; i++) expect(vis[i]).toBe(true);
    expect(map.explored.every(Boolean)).toBe(true);
  });

  it("does not see through walls", () => {
    const map = mapFrom(["#########", "#...#...#", "#...#...#", "#...#...#", "#########"]);
    const vis = computeFov(map, 2, 2, 8);
    expect(vis[idx(map, 6, 2)]).toBe(false);
    expect(vis[idx(map, 4, 2)]).toBe(true);
    expect(vis[idx(map, 1, 1)]).toBe(true);
  });

  it("respects the radius", () => {
    const rows = Array.from({ length: 21 }, () => ".".repeat(21));
    const map = mapFrom(rows);
    const vis = computeFov(map, 10, 10, 3);
    expect(vis[idx(map, 13, 10)]).toBe(true);
    expect(vis[idx(map, 14, 10)]).toBe(false);
    expect(vis[idx(map, 10, 7)]).toBe(true);
    expect(vis[idx(map, 10, 6)]).toBe(false);
  });
});
