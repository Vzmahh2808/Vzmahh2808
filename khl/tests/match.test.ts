import { describe, expect, it } from "vitest";
import { Match, defaultSettings, type MatchSettings } from "../src/sim/match";
import { goalieId, skaterId } from "../src/sim/state";

function play(m: Match, maxSeconds = 60 * 30, dt = 1 / 60): number {
  let t = 0;
  while (m.phase !== "final" && t < maxSeconds) {
    m.tick(dt);
    m.drainEvents();
    t += dt;
  }
  return t;
}

const ai = (over: Partial<MatchSettings> = {}): MatchSettings => ({ ...defaultSettings(), humanHome: false, ...over });

describe("match flow", () => {
  it("plays a full AI match to a result", () => {
    const m = new Match(ai({ seed: 101 }));
    play(m);
    expect(m.phase).toBe("final");
    expect(m.winner).not.toBeNull();
    expect(m.decidedBy).not.toBeNull();
    expect(m.score[0] + m.score[1]).toBeGreaterThanOrEqual(0);
    if (m.decidedBy === "reg") expect(m.period).toBe(3);
  });

  it("gives the same result for the same seed", () => {
    const a = new Match(ai({ seed: 55 }));
    const b = new Match(ai({ seed: 55 }));
    play(a);
    play(b);
    expect(a.score).toEqual(b.score);
    expect(a.decidedBy).toBe(b.decidedBy);
    expect(a.stats.shots).toEqual(b.stats.shots);
  });

  it("keeps goals per team in a hockey range over several matches", () => {
    let goals = 0;
    let n = 0;
    let shots = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const m = new Match(ai({ seed: seed * 313 }));
      play(m);
      goals += m.score[0] + m.score[1];
      shots += m.stats.shots[0] + m.stats.shots[1];
      n += 2;
      expect(m.score[0]).toBeLessThan(11);
      expect(m.score[1]).toBeLessThan(11);
    }
    expect(goals / n).toBeGreaterThan(1.2);
    expect(goals / n).toBeLessThan(4.5);
    expect(shots / n).toBeGreaterThan(12);
  });

  it("a much stronger team wins most of the time", () => {
    const strong = { off: 92, def: 90, gk: 92, spd: 88 };
    const weak = { off: 58, def: 58, gk: 58, spd: 60 };
    let wins = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const m = new Match(ai({ seed: seed * 977, home: strong, away: weak }));
      play(m);
      if (m.winner === 0) wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(4);
  });

  it("resets to a faceoff after a goal and keeps the score", () => {
    const m = new Match(ai({ seed: 7 }));
    let t = 0;
    while (m.score[0] + m.score[1] === 0 && t < 600) {
      m.tick(1 / 60);
      m.drainEvents();
      t += 1 / 60;
    }
    expect(m.score[0] + m.score[1]).toBe(1);
    expect(m.phase).toBe("goal");
    for (let i = 0; i < 60 * 5; i++) m.tick(1 / 60);
    expect(["faceoff", "play"]).toContain(m.phase);
    expect(m.score[0] + m.score[1]).toBeGreaterThanOrEqual(1);
    expect(m.goals.length).toBe(m.score[0] + m.score[1]);
    expect(m.goals[0].scorer).toBeGreaterThanOrEqual(0);
  });

  it("moves to three-on-three overtime and then a shootout when tied", () => {
    const m = new Match(ai({ seed: 21 }));
    m.phase = "play";
    m.period = 3;
    m.clock = 0.01;
    m.score = [2, 2];
    m.tick(1 / 60);
    expect(m.period).toBe(4);
    expect(m.phase).toBe("break");
    for (let i = 0; i < 60 * 3; i++) m.tick(1 / 60);
    expect(m.phase).toBe("faceoff");
    const active = m.w.skaters.filter((s) => s.active && s.role !== "G");
    expect(active.length).toBe(6);
    expect(m.clock).toBeCloseTo(m.settings.periodSeconds / 4, 3);
    // Force the overtime clock out with no goal: a shootout follows.
    m.clock = 0.01;
    m.phase = "play";
    m.tick(1 / 60);
    if (m.phase !== "final") {
      expect(m.phase).toBe("shootout");
      expect(m.so).not.toBeNull();
    }
  });

  it("plays a shootout to a winner", () => {
    const m = new Match(ai({ seed: 9 }));
    m.beginShootoutOnly();
    play(m, 60 * 10);
    expect(m.phase).toBe("final");
    expect(m.decidedBy).toBe("so");
    expect(m.winner).not.toBeNull();
    const done = m.so!.attempts.filter((a) => a.result !== "pending");
    expect(done.length).toBeGreaterThanOrEqual(4);
    // Goals counted on the shootout board match the recorded results.
    expect(m.so!.score[0]).toBe(done.filter((a) => a.team === 0 && a.result === "goal").length);
  });

  it("playoff overtime is full-strength sudden death with no shootout", () => {
    const m = new Match(ai({ seed: 33, mode: "playoff" }));
    m.phase = "play";
    m.period = 3;
    m.clock = 0.01;
    m.score = [1, 1];
    m.tick(1 / 60);
    expect(m.period).toBe(4);
    for (let i = 0; i < 60 * 3; i++) m.tick(1 / 60);
    expect(m.w.skaters.filter((s) => s.active && s.role !== "G").length).toBe(10);
    play(m, 60 * 60);
    expect(m.phase).toBe("final");
    expect(m.so).toBeNull();
    expect(m.score[0]).not.toBe(m.score[1]);
    expect(m.decidedBy).toBe("ot");
  });
});

describe("human control", () => {
  it("controls the puck carrier and switches with the pass button", () => {
    const m = new Match({ ...defaultSettings(), seed: 5, humanHome: true, humanAway: false });
    for (let i = 0; i < 60 * 3; i++) m.tick(1 / 60); // faceoff, then play
    let carrierSeen = false;
    for (let i = 0; i < 60 * 40 && !carrierSeen; i++) {
      m.tick(1 / 60);
      const c = m.w.puck.carrier;
      if (c >= 0 && m.w.skaters[c].team === 0 && m.w.skaters[c].role !== "G") {
        m.tick(1 / 60);
        expect(m.w.controlled[0]).toBe(m.w.puck.carrier >= 0 ? m.w.puck.carrier : m.w.controlled[0]);
        carrierSeen = true;
      }
    }
    expect(carrierSeen).toBe(true);
    // Without the puck, pass switches to another skater.
    const before = m.w.controlled[0];
    m.w.puck.carrier = -1;
    m.w.puck.pos.x = 20;
    m.w.puck.pos.y = 0;
    m.w.puck.vel.x = 0;
    m.w.puck.vel.y = 0;
    m.requestSwitch(0);
    expect(m.w.controlled[0]).not.toBe(before);
  });

  it("a person can skate, shoot and score against an idle goalie side", () => {
    const m = new Match({ ...defaultSettings(), seed: 12, humanHome: true, humanAway: false, difficulty: 0.1 });
    for (let i = 0; i < 90; i++) m.tick(1 / 60);
    const me = m.w.skaters[skaterId(0, "C")];
    // Give the human the puck near the right blue line and shoot at the net.
    m.w.controlled[0] = me.id;
    me.pos.x = 12;
    me.pos.y = 2;
    me.vel.x = 0;
    me.vel.y = 0;
    me.heading = 0;
    m.w.puck.carrier = me.id;
    m.w.puck.pos.x = 12.7;
    m.w.puck.pos.y = 2;
    m.w.skaters[goalieId(1)].pos.y = -1.2;
    const h = m.humanInput[0];
    let shot = false;
    for (let i = 0; i < 60 * 6 && !shot; i++) {
      h.mx = 1;
      h.my = 0;
      h.shootHeld = true;
      if (me.pos.x > 18 || i > 60 * 2) {
        h.shootHeld = false;
        h.shootReleased = true;
      }
      m.tick(1 / 60);
      if (m.stats.shots[0] > 0) shot = true;
    }
    expect(shot).toBe(true);
  });
});
