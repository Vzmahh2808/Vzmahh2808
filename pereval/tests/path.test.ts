import { describe, expect, it } from "vitest";
import { findPath } from "../src/game/path";
import type { Tile } from "../src/game/types";

function grid(rows: string[]): { width: number; height: number; tiles: Tile[] } {
  const tiles: Tile[] = [];
  for (const row of rows) for (const ch of row) tiles.push({ t: ch === "#" ? "rock" : ch === "~" ? "swamp" : "meadow", h: 0 });
  return { width: rows[0].length, height: rows.length, tiles };
}
const cost = (t: Tile) => (t.t === "rock" ? 0 : t.t === "swamp" ? 3 : 1);

describe("findPath", () => {
  it("walks around walls", () => {
    const g = grid(["....", ".##.", "...."]);
    const p = findPath(g, { x: 0, y: 1 }, { x: 3, y: 1 }, cost);
    expect(p).not.toBeNull();
    expect(p![p!.length - 1]).toEqual({ x: 3, y: 1 });
    expect(p!.length).toBe(5);
    for (const q of p!) expect(g.tiles[q.y * g.width + q.x].t).not.toBe("rock");
  });

  it("prefers cheaper terrain over shorter distance", () => {
    const g = grid(["....", ".~~.", "...."]);
    const p = findPath(g, { x: 0, y: 1 }, { x: 3, y: 1 }, cost);
    expect(p!.some((q) => g.tiles[q.y * g.width + q.x].t === "swamp")).toBe(false);
  });

  it("returns null when the target is walled off or outside", () => {
    const g = grid(["..#.", "..#.", "..#."]);
    expect(findPath(g, { x: 0, y: 0 }, { x: 3, y: 2 }, cost)).toBeNull();
    expect(findPath(g, { x: 0, y: 0 }, { x: 9, y: 9 }, cost)).toBeNull();
  });
});
