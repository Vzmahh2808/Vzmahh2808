import { beforeAll, describe, expect, it } from "vitest";
import { greedyAgent, greedyChoice } from "../src/agent/greedy";
import { needsDecision, nextStep } from "../src/agent/intents";
import { observe, type Observation } from "../src/agent/observe";
import { ArenaSession, runAgent } from "../src/agent/session";
import { Game } from "../src/game/game";
import { applyAction, verifyReplay } from "../src/game/replay";
import { decodeActions } from "../src/game/actions";

const ALL_CODES = ["1", "2", "3", "4", "6", "7", "8", "9", "5", "g", ">", ..."abcdefghijkl".split("").flatMap((c) => ["u" + c, "d" + c])];

function clone(g: Game): Game {
  return Game.fromState(JSON.parse(JSON.stringify(g.snapshot())));
}

function accepted(g: Game): string[] {
  return ALL_CODES.filter((code) => applyAction(clone(g), decodeActions(code)[0]));
}

/** Game states sampled along greedy runs, to test against realistic positions. */
function sampleStates(seeds: number[], turns: number, every: number): Game[] {
  const out: Game[] = [];
  for (const seed of seeds) {
    const g = Game.newGame(seed);
    while (g.state.status === "playing" && g.state.turn < turns) {
      if (g.state.turn % every === 0) out.push(clone(g));
      applyAction(g, decodeActions(greedyChoice(observe(g)))[0]);
    }
    out.push(clone(g));
  }
  return out;
}

describe("observe", () => {
  let states: Game[] = [];
  beforeAll(() => {
    states = sampleStates([1000, 1001, 1002], 900, 30);
  }, 60_000);

  it("lists exactly the actions the engine accepts", () => {
    expect(states.length).toBeGreaterThan(20);
    for (const g of states) expect(observe(g).legal.sort()).toEqual(accepted(g).sort());
  });

  it("shows only what the character can see or remembers", () => {
    for (const g of states) {
      const obs = observe(g);
      const map = g.state.map;
      expect(JSON.stringify(obs)).not.toMatch(/"seed"|rngState/);
      expect(obs.map).toHaveLength(map.height);
      expect(obs.map.every((row) => row.length === map.width)).toBe(true);
      expect(obs.monsters.map((m) => m.id).sort()).toEqual(g.visibleMonsters().map((m) => m.id).sort());
      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
          if (!map.explored[y * map.width + x]) expect(obs.map[y][x]).toBe(" ");
        }
      }
      expect(obs.map[g.player.y][g.player.x]).toBe("@");
    }
  });

  it("gives hints that are legal steps", () => {
    for (const g of states) {
      const { legal, hints } = observe(g);
      if (hints.explore) expect(legal).toContain(hints.explore);
      if (hints.stairs) expect(legal).toContain(hints.stairs);
    }
  });

  it("has no legal actions once the game is over", () => {
    const g = Game.newGame(3);
    g.state.status = "dead";
    expect(observe(g).legal).toEqual([]);
  });
});

describe("ArenaSession", () => {
  it("rejects malformed, multiple and refused actions without spending turns", () => {
    const s = new ArenaSession(42);
    expect(s.act("x").accepted).toBe(false);
    expect(s.act("55").accepted).toBe(false);
    expect(s.act(">").accepted).toBe(false);
    expect(s.act("5")).toEqual({ accepted: true });
    expect(s.game.state.turn).toBe(1);
    expect(s.rejected).toBe(3);
    expect(s.decisions).toBe(4);
    expect(s.replay().actions).toBe("5");
  });

  it("ends at the rejection and turn limits", () => {
    const stubborn = new ArenaSession(42, { maxRejected: 3 });
    for (let i = 0; i < 3; i++) stubborn.act(">");
    expect(stubborn.endReason).toBe("rejected-limit");
    expect(stubborn.act("5").accepted).toBe(false);

    const slow = new ArenaSession(42, { maxTurns: 5 });
    for (let i = 0; i < 10; i++) slow.act("5");
    expect(slow.endReason).toBe("turn-limit");
    expect(slow.game.state.turn).toBe(5);
  });
});

describe("runAgent", () => {
  it("plays a run whose replay verifies to the same result", async () => {
    const result = await runAgent(greedyAgent, 1001, { maxTurns: 400 });
    expect(result.decisions).toBeGreaterThan(0);
    expect(result.rejected).toBe(0);
    expect(verifyReplay(result.replay)).toEqual({ ok: true, summary: result.summary });
  });

  it("reports every decision to onStep", async () => {
    let steps = 0;
    const result = await runAgent({ name: "waiter", act: () => "5" }, 7, { maxTurns: 10, onStep: () => steps++ });
    expect(steps).toBe(result.decisions);
    expect(result.endReason === "turn-limit" || result.endReason === "dead").toBe(true);
  });
});

describe("intents", () => {
  const base = observe(Game.newGame(11));

  it("runs one-shot intents once and multi-step intents until they finish", () => {
    const withPotion: Observation = { ...base, legal: [...base.legal] };
    expect(nextStep(withPotion, { kind: "use", slot: "a" }, 0)).toBe("ua");
    expect(nextStep(withPotion, { kind: "use", slot: "a" }, 1)).toBeNull();
    expect(nextStep(base, { kind: "explore" }, 5)).toBe(base.hints.explore ?? null);
    expect(nextStep({ ...base, monsters: [] }, { kind: "fight" }, 0)).toBeNull();
    expect(nextStep(base, { kind: "step", direction: "x" }, 0)).toBeNull();
  });

  it("asks for a new decision when a monster appears or health halves", () => {
    const monster = { id: 99, kind: "rat", name: "крыса", glyph: "r", x: 1, y: 1, hp: 4, maxHp: 4, distance: 3 };
    expect(needsDecision(base, base)).toBe(false);
    expect(needsDecision(base, { ...base, monsters: [monster] })).toBe(true);
    const hurt = { ...base, player: { ...base.player, hp: Math.floor(base.player.maxHp / 2) - 1 } };
    expect(needsDecision(base, hurt)).toBe(true);
    expect(needsDecision(base, { ...base, depth: base.depth + 1 })).toBe(true);
  });
});
