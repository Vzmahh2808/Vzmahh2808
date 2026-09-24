import { describe, expect, it } from "vitest";
import { Rng } from "../src/game/rng";

describe("Rng", () => {
  it("is deterministic for a seed", () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it("int stays within inclusive bounds", () => {
    const r = new Rng(7);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = r.int(3, 6);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(6);
      seen.add(v);
    }
    expect(seen.size).toBe(4);
  });

  it("restores from saved state", () => {
    const r = new Rng(99);
    r.next();
    const s = r.getState();
    const x = r.next();
    const r2 = new Rng(0);
    r2.setState(s);
    expect(r2.next()).toBe(x);
  });

  it("weighted pick never returns zero-weight items", () => {
    const r = new Rng(1);
    const items = [
      { id: "a", w: 0 },
      { id: "b", w: 5 },
      { id: "c", w: 1 },
    ];
    for (let i = 0; i < 500; i++) expect(r.weighted(items, (it) => it.w).id).not.toBe("a");
  });
});
