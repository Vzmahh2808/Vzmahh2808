import { describe, expect, it } from "vitest";
import { CATEGORIES } from "../src/game/data";
import { Rng } from "../src/game/rng";
import type { Category } from "../src/game/types";
import { bfsDistances, generateWorld, isPassable, tileAt } from "../src/game/world";

const CATS: Category[] = [1, 2, 3];

describe("generateWorld", () => {
  it("makes start, finish and every checkpoint reachable on foot", () => {
    for (const cat of CATS) {
      for (let seed = 1; seed <= 25; seed++) {
        const w = generateWorld(new Rng(seed), cat);
        const dist = bfsDistances(w, w.start);
        expect(dist[w.finish.y * w.width + w.finish.x], `seed ${seed} cat ${cat} finish`).toBeGreaterThan(0);
        for (const cp of w.checkpoints) {
          expect(dist[cp.pos.y * w.width + cp.pos.x], `seed ${seed} cat ${cat} cp ${cp.id}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("places the right number of checkpoints, villages and at least one pass", () => {
    for (const cat of CATS) {
      for (let seed = 100; seed < 115; seed++) {
        const w = generateWorld(new Rng(seed), cat);
        expect(w.checkpoints).toHaveLength(CATEGORIES[cat].checkpoints);
        expect(tileAt(w, w.start)?.t).toBe("village");
        expect(tileAt(w, w.finish)?.t).toBe("village");
        expect(w.tiles.filter((t) => t.t === "pass").length).toBeGreaterThanOrEqual(1);
        expect(w.tiles.filter((t) => t.t === "rock").length).toBeGreaterThan(20);
        expect(w.tiles.filter((t) => t.t === "river").length).toBeGreaterThan(5);
        expect(w.tiles.filter((t) => t.t === "bridge").length).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("puts checkpoints on ordinary walkable ground, not on top of each other", () => {
    const w = generateWorld(new Rng(7), 2);
    const seen = new Set<string>();
    for (const cp of w.checkpoints) {
      const key = `${cp.pos.x},${cp.pos.y}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
      const t = tileAt(w, cp.pos)!;
      expect(isPassable(t.t)).toBe(true);
      expect(["meadow", "forest", "scree", "swamp"]).toContain(t.t);
    }
  });

  it("is deterministic for a seed", () => {
    const a = generateWorld(new Rng(42), 1);
    const b = generateWorld(new Rng(42), 1);
    expect(a.tiles).toEqual(b.tiles);
    expect(a.checkpoints).toEqual(b.checkpoints);
  });
});
