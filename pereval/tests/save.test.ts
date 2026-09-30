import { describe, expect, it } from "vitest";
import { Game } from "../src/game/game";
import { clearSave, loadGame, loadScores, recordScore, saveGame, type ScoreEntry, type Storage } from "../src/game/save";

function memory(): Storage {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

describe("save", () => {
  it("round-trips a running game and forgets finished ones", () => {
    const store = memory();
    const g = Game.newGame(11, 1);
    g.move(1, 0) || g.move(0, 1) || g.move(-1, 0) || g.move(0, -1);
    saveGame(g.snapshot(), store);
    const loaded = loadGame(store)!;
    expect(loaded).not.toBeNull();
    expect(loaded.pos).toEqual(g.state.pos);
    const g2 = Game.fromState(loaded);
    expect(g2.state.members).toEqual(g.state.members);
    g2.abandon();
    saveGame(g2.snapshot(), store);
    expect(loadGame(store)).toBeNull();
    clearSave(store);
    expect(loadGame(store)).toBeNull();
  });

  it("keeps the ten best scores sorted", () => {
    const store = memory();
    for (let i = 0; i < 12; i++) {
      const e: ScoreEntry = { score: i * 10, rank: "x", category: 1, days: 5, checkpoints: 3, outcome: "won", reason: "", date: "2026-01-01" };
      recordScore(e, store);
    }
    const list = loadScores(store);
    expect(list).toHaveLength(10);
    expect(list[0].score).toBe(110);
    expect(list[9].score).toBe(20);
    const { place } = recordScore({ score: 1000, rank: "x", category: 1, days: 5, checkpoints: 3, outcome: "won", reason: "", date: "2026-01-01" }, store);
    expect(place).toBe(1);
  });
});
