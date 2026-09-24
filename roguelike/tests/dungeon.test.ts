import { describe, expect, it } from "vitest";
import { Rng } from "../src/game/rng";
import { DEFAULT_DUNGEON, findTile, generateDungeon, idx, isPassable, roomCenter } from "../src/game/dungeon";
import { distanceMap, UNREACHABLE } from "../src/game/path";
import { Tile } from "../src/game/types";

describe("generateDungeon", () => {
  it("produces connected levels with stairs for many seeds", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const map = generateDungeon(new Rng(seed), DEFAULT_DUNGEON);
      expect(map.rooms.length).toBeGreaterThanOrEqual(2);
      const start = roomCenter(map.rooms[0]);
      const stairs = findTile(map, Tile.StairsDown);
      expect(stairs).not.toBeNull();
      const dist = distanceMap(map, [start]);
      // Every passable tile must be reachable from the start.
      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
          if (isPassable(map, x, y)) expect(dist[idx(map, x, y)]).toBeLessThan(UNREACHABLE);
        }
      }
      expect(dist[idx(map, stairs!.x, stairs!.y)]).toBeGreaterThan(5);
    }
  });

  it("keeps the outer border solid", () => {
    const map = generateDungeon(new Rng(3), DEFAULT_DUNGEON);
    for (let x = 0; x < map.width; x++) {
      expect(map.tiles[idx(map, x, 0)]).toBe(Tile.Wall);
      expect(map.tiles[idx(map, x, map.height - 1)]).toBe(Tile.Wall);
    }
    for (let y = 0; y < map.height; y++) {
      expect(map.tiles[idx(map, 0, y)]).toBe(Tile.Wall);
      expect(map.tiles[idx(map, map.width - 1, y)]).toBe(Tile.Wall);
    }
  });

  it("only places doors in wall gaps", () => {
    const map = generateDungeon(new Rng(11), DEFAULT_DUNGEON);
    let doors = 0;
    for (let y = 1; y < map.height - 1; y++) {
      for (let x = 1; x < map.width - 1; x++) {
        if (map.tiles[idx(map, x, y)] !== Tile.Door) continue;
        doors++;
        const n = map.tiles[idx(map, x, y - 1)] === Tile.Wall;
        const s = map.tiles[idx(map, x, y + 1)] === Tile.Wall;
        const w = map.tiles[idx(map, x - 1, y)] === Tile.Wall;
        const e = map.tiles[idx(map, x + 1, y)] === Tile.Wall;
        expect((n && s && !w && !e) || (w && e && !n && !s)).toBe(true);
      }
    }
    expect(doors).toBeGreaterThan(0);
  });
});
