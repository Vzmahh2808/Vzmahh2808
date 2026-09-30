import { describe, expect, it } from "vitest";
import { createSeason, simulateToNextPhase } from "../src/game/league";
import { rosterFor } from "../src/game/roster";
import { Keyboard } from "../src/input/keyboard";
import { createChunkWriter } from "../src/platform/sync";
import { check, takePuck } from "../src/sim/actions";
import { thinkAI } from "../src/sim/ai";
import { Match, defaultSettings } from "../src/sim/match";
import { DT, stepWorld } from "../src/sim/physics";
import { goalieId, makeWorld, skaterId } from "../src/sim/state";

/** Put a checker at speed right behind (or in front of) a victim and count the fouls over many seeds. */
function foulCounts(victimFacesChecker: boolean): { behind: number; interference: number } {
  const out = { behind: 0, interference: 0 };
  for (let seed = 1; seed <= 300; seed++) {
    const w = makeWorld(seed * 13 + 1);
    w.foulsOn = true;
    for (const s of w.skaters) if (s.role !== "G") s.active = false;
    const checker = w.skaters[skaterId(0, "C")];
    const victim = w.skaters[skaterId(1, "C")];
    checker.active = victim.active = true;
    // Victim at the origin; the checker comes from the left at 8 m/s.
    victim.pos.x = 0;
    victim.pos.y = 0;
    victim.vel.x = 0;
    victim.vel.y = 0;
    victim.heading = victimFacesChecker ? Math.PI : 0;
    checker.pos.x = -1.1;
    checker.pos.y = 0;
    checker.vel.x = 8;
    checker.vel.y = 0;
    checker.heading = 0;
    // Someone else has the puck so the hit is on a player without it.
    w.puck.pos.x = 15;
    w.puck.pos.y = 8;
    check(w, checker);
    for (const e of w.events) if (e.type === "foul") out[e.kind === "behind" ? "behind" : "interference"]++;
  }
  return out;
}

describe("review fixes", () => {
  it("a hit from behind is penalised as behind, a head-on hit is not", () => {
    const fromBehind = foulCounts(false); // victim skating away from the checker
    const headOn = foulCounts(true);
    expect(fromBehind.behind).toBeGreaterThan(80);
    expect(headOn.behind).toBe(0);
  });

  it("rosters are cached per club", () => {
    expect(rosterFor(3)).toBe(rosterFor(3));
    expect(rosterFor(3)).not.toBe(rosterFor(4));
  });

  it("shootout goals credit only the shooter", () => {
    let goals = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const m = new Match({ ...defaultSettings(), seed: seed * 91, humanHome: false });
      m.beginShootoutOnly();
      let guard = 0;
      while (m.phase !== "final" && guard++ < 60 * 60) {
        m.tick(1 / 60);
        for (const e of m.drainEvents()) {
          if (e.type !== "goal") continue;
          goals++;
          expect(e.assist).toEqual([]);
          expect(e.scorer).toBeGreaterThanOrEqual(0);
          expect(m.w.skaters[e.scorer].team).toBe(e.team);
        }
      }
    }
    expect(goals).toBeGreaterThan(0);
  });

  it("skaters keep moving while a goalie holds the puck", () => {
    const w = makeWorld(4);
    w.human = [false, false];
    const g = w.skaters[goalieId(0)];
    takePuck(w, g);
    g.gHold = 5;
    let moved = 0;
    for (let i = 0; i < 6; i++) {
      thinkAI(w, DT);
      for (const s of w.skaters) if (s.active && s.role !== "G" && Math.hypot(s.input.mx, s.input.my) > 0.05) moved++;
    }
    expect(moved).toBeGreaterThan(0);
    for (let i = 0; i < 240; i++) {
      thinkAI(w, DT);
      stepWorld(w, DT);
      if (w.puck.carrier !== g.id) break;
    }
  });

  it("simulating past the end of a season does not hang", () => {
    const s = createSeason(0, 21, 5);
    simulateToNextPhase(s);
    simulateToNextPhase(s);
    expect(s.phase).toBe("done");
    simulateToNextPhase(s); // must return
    expect(s.phase).toBe("done");
  });

  it("presses and releases during a stoppage do not fire when play resumes", () => {
    const target = new EventTarget();
    const kb = new Keyboard(target as unknown as Window);
    const m = new Match({ ...defaultSettings(), seed: 3, humanHome: true, humanAway: false });
    const key = (type: "keydown" | "keyup") => {
      const e = new Event(type) as Event & { code: string; repeat: boolean };
      e.code = "KeyF";
      e.repeat = false;
      target.dispatchEvent(e);
    };
    // Hold shoot during play, then release it while play is stopped.
    key("keydown");
    kb.apply(m, null);
    expect(m.humanInput[0].shootHeld).toBe(true);
    key("keyup");
    kb.discard(m, null);
    kb.apply(m, null);
    expect(m.humanInput[0].shootReleased).toBe(false);
    // A normal release in play still registers.
    key("keydown");
    kb.apply(m, null);
    key("keyup");
    kb.apply(m, null);
    expect(m.humanInput[0].shootReleased).toBe(true);
  });

  it("the cloud writer stores chunks before the count and coalesces writes", async () => {
    const log: string[] = [];
    let release: (() => void) | null = null;
    const set = (k: string, v: string) =>
      new Promise<boolean>((resolve) => {
        log.push(`${k}=${v.length}`);
        const done = () => resolve(true);
        if (k === "s0" && release === null && log.length === 1) release = done; // hold the very first write
        else done();
      });
    const write = createChunkWriter(set);
    write("a".repeat(9000)); // three chunks
    write("b".repeat(50)); // replaced by the next one
    write("c".repeat(60));
    expect(log).toEqual(["s0=4000"]);
    release!();
    await new Promise((r) => setTimeout(r, 20));
    // The first save finished in order, the count last; then only the newest queued save was written.
    expect(log.slice(0, 4)).toEqual(["s0=4000", "s1=4000", "s2=1000", "sn=1"]);
    expect(log.slice(4)).toEqual(["s0=60", "sn=1"]);
  });

  it("a failed chunk leaves the count unwritten", async () => {
    const log: string[] = [];
    const set = async (k: string) => {
      log.push(k);
      return k !== "s1";
    };
    const write = createChunkWriter(set);
    write("x".repeat(9000));
    await new Promise((r) => setTimeout(r, 20));
    expect(log).toEqual(["s0", "s1"]);
  });
});
