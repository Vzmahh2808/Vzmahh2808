import { beforeAll, describe, expect, it } from "vitest";
import { ActionFormatError, decodeActions, encodeAction, encodeActions, type Action } from "../src/game/actions";
import { Game } from "../src/game/game";
import { RULES_VERSION, replayOf, summarize, verifyReplay, type Replay } from "../src/game/replay";
import { MemoryStorage, loadGame, saveGame } from "../src/game/save";
import { playBot } from "../scripts/bot";

/** Game state minus the message log, which also holds messages from rejected actions. */
function outcome(g: Game): string {
  return JSON.stringify({ ...g.snapshot(), log: [] });
}

function replayFor(g: Game): Replay {
  const r = replayOf(g);
  if (!r) throw new Error("run is not replayable");
  return r;
}

describe("action encoding", () => {
  it("round-trips every kind of action", () => {
    const actions: Action[] = [
      { type: "move", dx: -1, dy: -1 },
      { type: "move", dx: 0, dy: -1 },
      { type: "move", dx: 1, dy: 1 },
      { type: "wait" },
      { type: "pickup" },
      { type: "descend" },
      { type: "use", index: 0 },
      { type: "use", index: 11 },
      { type: "drop", index: 3 },
    ];
    const text = encodeActions(actions);
    expect(text).toBe("7835g>uauldd");
    expect(decodeActions(text)).toEqual(actions);
  });

  it("rejects unknown symbols and a missing slot letter with their offset", () => {
    expect(() => decodeActions("88x")).toThrow(ActionFormatError);
    try {
      decodeActions("66u");
    } catch (e) {
      expect((e as ActionFormatError).offset).toBe(3);
    }
    expect(() => decodeActions("u0")).toThrow(ActionFormatError);
  });

  it("refuses to encode moves longer than one step", () => {
    expect(() => encodeAction({ type: "move", dx: 2, dy: 0 })).toThrow();
    expect(() => encodeAction({ type: "move", dx: 0, dy: 0 })).toThrow();
  });
});

describe("recording", () => {
  it("records accepted actions and skips rejected ones", () => {
    const g = Game.newGame(42);
    expect(g.state.actions).toBe("");
    g.wait();
    expect(g.descend()).toBe(false);
    expect(g.pickUp()).toBe(false);
    expect(g.state.actions).toBe("5");
  });

  it("rejects jumps and zero steps without spending a turn", () => {
    const g = Game.newGame(42);
    const { x, y } = g.player;
    expect(g.movePlayer(2, 0)).toBe(false);
    expect(g.movePlayer(0, 0)).toBe(false);
    expect(g.player).toMatchObject({ x, y });
    expect(g.state.turn).toBe(0);
    expect(g.state.actions).toBe("");
  });

  it("keeps recording across a save and resume", () => {
    const g = Game.newGame(7);
    g.wait();
    g.wait();
    const store = new MemoryStorage();
    saveGame(g.snapshot(), store);
    const resumed = Game.fromState(loadGame(store)!);
    resumed.wait();
    resumed.useItem(0);
    expect(resumed.state.actions).toBe("555ua");
    const result = verifyReplay(replayFor(resumed));
    expect(result).toEqual({ ok: true, summary: summarize(resumed) });
  });

  it("does not offer a replay for saves made before recording existed", () => {
    const g = Game.newGame(7);
    delete g.state.actions;
    g.wait();
    expect(g.state.actions).toBeUndefined();
    expect(replayOf(g)).toBeNull();
  });
});

describe("verifyReplay", () => {
  let runs: Game[] = [];
  beforeAll(() => {
    runs = [1000, 1001, 1002].map((seed) => playBot(seed));
  }, 30_000);

  it("reproduces full bot games exactly from seed and actions", () => {
    for (const live of runs) {
      const replay = replayFor(live);
      const result = verifyReplay(replay);
      expect(result).toEqual({ ok: true, summary: summarize(live) });

      const again = Game.newGame(replay.seed);
      for (const a of decodeActions(replay.actions)) {
        if (a.type === "move") again.movePlayer(a.dx, a.dy);
        else if (a.type === "wait") again.wait();
        else if (a.type === "pickup") again.pickUp();
        else if (a.type === "descend") again.descend();
        else if (a.type === "use") again.useItem(a.index);
        else again.dropItem(a.index);
      }
      expect(outcome(again)).toBe(outcome(live));
    }
  });

  it("covers stairs, pickups and item use in the recorded games", () => {
    const all = runs.map((g) => g.state.actions).join("");
    for (const code of [">", "g", "u"]) expect(all).toContain(code);
    expect(runs.some((g) => g.state.depth > 2)).toBe(true);
  });

  it("rejects an action the engine would refuse", () => {
    const replay = replayFor(runs[0]);
    const result = verifyReplay({ ...replay, actions: ">" + replay.actions });
    expect(result).toMatchObject({ ok: false, action: 0 });
  });

  it("rejects actions after the game has ended", () => {
    const finished = runs.find((g) => g.state.status !== "playing")!;
    const replay = replayFor(finished);
    const n = decodeActions(replay.actions).length;
    const result = verifyReplay({ ...replay, actions: replay.actions + "5" });
    expect(result).toMatchObject({ ok: false, action: n });
  });

  it("gives a different outcome when the seed is swapped", () => {
    const replay = replayFor(runs[0]);
    const result = verifyReplay({ ...replay, seed: replay.seed + 1 });
    if (result.ok) expect(result.summary).not.toEqual(summarize(runs[0]));
    else expect(result.action).toBeGreaterThanOrEqual(0);
  });

  it("rejects bad metadata and overlong or malformed replays", () => {
    const replay = replayFor(runs[0]);
    expect(verifyReplay({ ...replay, rules: RULES_VERSION + 1 })).toMatchObject({ ok: false, action: -1 });
    expect(verifyReplay({ ...replay, seed: -1 })).toMatchObject({ ok: false, action: -1 });
    expect(verifyReplay({ ...replay, seed: 1.5 })).toMatchObject({ ok: false, action: -1 });
    expect(verifyReplay({ ...replay, actions: "88?" })).toMatchObject({ ok: false, action: -1 });
    expect(verifyReplay(replay, 10)).toMatchObject({ ok: false, action: -1 });
  });
});
