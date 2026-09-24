import { describe, expect, it } from "vitest";
import { Game, xpToNext, scoreOf } from "../src/game/game";
import { findTile, idx } from "../src/game/dungeon";
import { MemoryStorage, loadGame, recordScore, saveGame, loadScores } from "../src/game/save";
import { Tile, MAX_DEPTH } from "../src/game/types";

describe("Game", () => {
  it("starts on depth 1 with a dagger, a potion, and the player on a free floor tile", () => {
    const g = Game.newGame(123);
    const { x, y } = g.player;
    expect(g.state.depth).toBe(1);
    expect(g.player.weapon?.defId).toBe("dagger");
    expect(g.player.inventory.map((i) => i.defId)).toEqual(["potion_heal"]);
    expect(g.state.map.tiles[idx(g.state.map, x, y)]).toBe(Tile.Floor);
    expect(g.monsterAt(x, y)).toBeUndefined();
    expect(g.isVisible(x, y)).toBe(true);
  });

  it("cannot walk into walls and a wall bump costs no turn", () => {
    const g = Game.newGame(5);
    const before = g.state.turn;
    // Find a wall direction.
    const p = g.player;
    let moved = false;
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
      let x = p.x;
      let y = p.y;
      while (g.state.map.tiles[idx(g.state.map, x + dx, y + dy)] !== Tile.Wall) {
        x += dx;
        y += dy;
      }
      p.x = x;
      p.y = y;
      expect(g.movePlayer(dx, dy)).toBe(false);
      moved = true;
      break;
    }
    expect(moved).toBe(true);
    expect(g.state.turn).toBe(before);
  });

  it("waiting advances the turn counter", () => {
    const g = Game.newGame(9);
    g.wait();
    g.wait();
    expect(g.state.turn).toBe(2);
  });

  it("descends when standing on stairs and rebuilds the level", () => {
    const g = Game.newGame(77);
    expect(g.descend()).toBe(false);
    const stairs = findTile(g.state.map, Tile.StairsDown)!;
    g.player.x = stairs.x;
    g.player.y = stairs.y;
    const oldTiles = g.state.map.tiles.slice();
    expect(g.descend()).toBe(true);
    expect(g.state.depth).toBe(2);
    expect(g.state.map.tiles).not.toEqual(oldTiles);
  });

  it("levels up when xp threshold is crossed", () => {
    const g = Game.newGame(31);
    const p = g.player;
    expect(xpToNext(1)).toBe(30);
    // Simulate kills via a fire scroll on adjacent weak monsters.
    p.inventory = [{ defId: "scroll_fire" }];
    g.state.monsters = [];
    for (let i = 0; i < 4; i++) {
      g.state.monsters.push({ id: 100 + i, defId: "rat", x: p.x + 1, y: p.y + i - 1, hp: 1, maxHp: 4, alert: 0, poison: 0 });
    }
    g.refreshFov();
    g.useItem(0);
    expect(g.player.kills).toBeGreaterThanOrEqual(3);
    expect(g.player.xp).toBeGreaterThanOrEqual(9);
  });

  it("equipping a weapon changes the attack range", () => {
    const g = Game.newGame(2);
    g.player.inventory = [];
    const [lo, hi] = g.attackRange();
    g.player.inventory.push({ defId: "axe" });
    expect(g.useItem(0)).toBe(true);
    expect(g.player.weapon?.defId).toBe("axe");
    const [lo2, hi2] = g.attackRange();
    expect(lo2).toBeGreaterThan(lo);
    expect(hi2).toBeGreaterThan(hi);
    // Swapping puts the old weapon back into the inventory.
    g.player.inventory.push({ defId: "dagger" });
    g.useItem(0);
    expect(g.player.weapon?.defId).toBe("dagger");
    expect(g.player.inventory.some((i) => i.defId === "axe")).toBe(true);
  });

  it("healing potion heals and is consumed", () => {
    const g = Game.newGame(4);
    g.player.hp = 5;
    g.player.inventory = [{ defId: "potion_heal" }];
    g.useItem(0);
    expect(g.player.hp).toBeGreaterThan(5);
    expect(g.player.inventory.length).toBe(0);
  });

  it("the final floor has the boss and picking up the amulet wins", () => {
    const g = Game.newGame(8);
    g.state.depth = MAX_DEPTH - 1;
    const stairs = findTile(g.state.map, Tile.StairsDown)!;
    g.player.x = stairs.x;
    g.player.y = stairs.y;
    g.descend();
    expect(g.state.depth).toBe(MAX_DEPTH);
    expect(g.state.monsters.some((m) => m.defId === "lord")).toBe(true);
    expect(findTile(g.state.map, Tile.StairsDown)).toBeNull();
    g.state.items.push({ x: g.player.x, y: g.player.y, item: { defId: "amulet" } });
    g.pickUp();
    expect(g.state.status).toBe("won");
    expect(scoreOf(g.state)).toBeGreaterThan(1000);
  });

  it("dies when hp reaches zero from poison", () => {
    const g = Game.newGame(12);
    g.state.monsters = [];
    g.player.hp = 1;
    g.player.poison = 3;
    g.wait();
    expect(g.state.status).toBe("dead");
    expect(g.state.deathCause).toBe("яд");
    expect(g.wait()).toBe(false);
  });

  it("round-trips through save and load with identical future", () => {
    const store = new MemoryStorage();
    const g = Game.newGame(555);
    for (let i = 0; i < 5; i++) g.wait();
    saveGame(g.snapshot(), store);
    const loaded = loadGame(store);
    expect(loaded).not.toBeNull();
    const g2 = Game.fromState(structuredClone(loaded!));
    for (let i = 0; i < 20; i++) {
      g.wait();
      g2.wait();
    }
    expect(g2.state.monsters).toEqual(g.state.monsters);
    expect(g2.state.turn).toBe(g.state.turn);
  });

  it("keeps a sorted, capped high-score table", () => {
    const store = new MemoryStorage();
    for (let i = 0; i < 15; i++) {
      recordScore({ score: i * 10, depth: 1, level: 1, turns: 100, outcome: "dead", cause: "крыса", date: "2026-01-01" }, store);
    }
    const scores = loadScores(store);
    expect(scores.length).toBe(10);
    expect(scores[0].score).toBe(140);
    expect(scores[9].score).toBe(50);
    const { rank } = recordScore({ score: 1000, depth: 10, level: 9, turns: 5000, outcome: "won", cause: "", date: "2026-01-02" }, store);
    expect(rank).toBe(0);
  });

  it("exploreTarget finds a frontier and pathTo walks explored tiles", () => {
    const g = Game.newGame(21);
    const target = g.exploreTarget();
    expect(target).not.toBeNull();
    const path = g.pathTo(target!.x, target!.y);
    expect(path.length).toBeGreaterThan(0);
    const last = path[path.length - 1];
    expect(last).toEqual(target);
  });
});
