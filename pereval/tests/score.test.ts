import { describe, expect, it } from "vitest";
import { Game } from "../src/game/game";
import { rankFor, scoreBreakdown } from "../src/game/score";

describe("score", () => {
  it("maps points to ranks", () => {
    expect(rankFor(0)).toBe("Без разряда");
    expect(rankFor(400)).toBe("3-й разряд");
    expect(rankFor(2500)).toBe("Мастер спорта");
  });

  it("rewards checkpoints, finishing early and category", () => {
    const g = Game.newGame(3, 2);
    const s = g.state;
    const before = scoreBreakdown(s).total;
    s.checkpoints.forEach((c) => (c.taken = true));
    s.status = "won";
    s.day = 6;
    const b = scoreBreakdown(s);
    expect(b.total).toBeGreaterThan(before);
    expect(b.checkpoints).toBe(150 * s.checkpoints.length);
    expect(b.finish).toBe(300);
    expect(b.daysLeft).toBe((s.deadline - 6) * 40);
    expect(b.factor).toBe(1.3);
    s.stats.falls = 3;
    expect(scoreBreakdown(s).total).toBeLessThan(b.total);
  });
});
