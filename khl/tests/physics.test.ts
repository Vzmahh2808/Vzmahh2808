import { describe, expect, it } from "vitest";
import { pass, shoot, takePuck } from "../src/sim/actions";
import { DT, stepWorld } from "../src/sim/physics";
import { HX, HY, rinkSdf, GOAL_LINE_X } from "../src/sim/rink";
import { goalieId, makeWorld, skaterId, type World } from "../src/sim/state";

function run(w: World, seconds: number): void {
  for (let i = 0; i < seconds / DT; i++) stepWorld(w);
}

function clearIce(w: World): void {
  // Park everyone far from the puck's path except the two goalies.
  for (const s of w.skaters) {
    if (s.role === "G") continue;
    s.pos.x = -20 + (s.id % 6) * 8;
    s.pos.y = s.team === 0 ? -12 : 12;
  }
}

describe("rink", () => {
  it("has the expected size", () => {
    expect(HX * 2).toBe(60);
    expect(HY * 2).toBe(26);
    expect(rinkSdf(0, 0)).toBeLessThan(0);
    expect(rinkSdf(HX + 1, 0)).toBeGreaterThan(0);
    // The corner is cut: the point at the rectangle's corner is outside.
    expect(rinkSdf(HX - 0.5, HY - 0.5)).toBeGreaterThan(0);
  });
});

describe("puck", () => {
  it("never leaves the rink whatever the shot", () => {
    const w = makeWorld(7);
    clearIce(w);
    for (let n = 0; n < 40; n++) {
      w.puck.pos.x = (w.rng.next() - 0.5) * 40;
      w.puck.pos.y = (w.rng.next() - 0.5) * 20;
      const a = w.rng.next() * Math.PI * 2;
      const sp = 5 + w.rng.next() * 40;
      w.puck.vel.x = Math.cos(a) * sp;
      w.puck.vel.y = Math.sin(a) * sp;
      w.puck.carrier = -1;
      for (let i = 0; i < 4 * 120; i++) {
        stepWorld(w);
        w.events.length = 0;
        expect(rinkSdf(w.puck.pos.x, w.puck.pos.y)).toBeLessThan(0.05);
        if (Math.abs(w.puck.pos.x) > GOAL_LINE_X + 0.01 && Math.abs(w.puck.pos.y) < 0.9) break; // in a net
      }
    }
  });

  it("slows down on the ice and bounces off the boards", () => {
    const w = makeWorld(3);
    clearIce(w);
    w.puck.pos.x = 0;
    w.puck.pos.y = 0;
    w.puck.vel.x = 0;
    w.puck.vel.y = 20;
    run(w, 0.7);
    // Hit the side boards (13 m away) and came back with less speed.
    expect(w.puck.vel.y).toBeLessThan(0);
    expect(Math.abs(w.puck.vel.y)).toBeLessThan(20);
  });

  it("scores when it crosses the goal mouth and not when it hits the post", () => {
    const w = makeWorld(5);
    clearIce(w);
    w.skaters[goalieId(1)].pos.y = 8; // goalie out of the way (still clamps to the crease)
    w.puck.pos.x = 15;
    w.puck.pos.y = 0;
    w.puck.vel.x = 30;
    w.puck.vel.y = 0;
    w.puck.lastTeam = 0;
    w.skaters[goalieId(1)].active = false;
    run(w, 1);
    expect(w.events.some((e) => e.type === "goal" && e.team === 0)).toBe(true);

    const w2 = makeWorld(5);
    clearIce(w2);
    w2.skaters[goalieId(1)].active = false;
    w2.puck.pos.x = 20;
    w2.puck.pos.y = 0.915;
    w2.puck.vel.x = 30;
    w2.puck.vel.y = 0;
    w2.puck.lastTeam = 0;
    run(w2, 0.6);
    expect(w2.events.some((e) => e.type === "goal")).toBe(false);
    expect(w2.events.some((e) => e.type === "post")).toBe(true);
  });
});

describe("passing and shooting", () => {
  it("delivers a pass to a teammate who then carries it", () => {
    const w = makeWorld(11);
    clearIce(w);
    const a = w.skaters[skaterId(0, "C")];
    const b = w.skaters[skaterId(0, "RW")];
    a.pos.x = -5;
    a.pos.y = 0;
    b.pos.x = 5;
    b.pos.y = 0;
    a.heading = 0;
    takePuck(w, a);
    w.puck.pos.x = a.pos.x + 0.7;
    w.puck.pos.y = 0;
    pass(w, a, b);
    run(w, 1.5);
    expect(w.puck.carrier).toBe(b.id);
  });

  it("a slap shot is faster than a wrist shot", () => {
    const speedFor = (charge: number): number => {
      const w = makeWorld(1);
      clearIce(w);
      const a = w.skaters[skaterId(0, "C")];
      a.pos.x = 10;
      a.pos.y = 0;
      a.heading = 0;
      takePuck(w, a);
      shoot(w, a, charge);
      return Math.hypot(w.puck.vel.x, w.puck.vel.y);
    };
    expect(speedFor(0.85)).toBeGreaterThan(speedFor(0.05) + 8);
    expect(speedFor(0.85)).toBeGreaterThan(30);
    expect(speedFor(0.85)).toBeLessThan(45);
  });

  it("a skater picks up a loose puck they skate onto", () => {
    const w = makeWorld(2);
    clearIce(w);
    const a = w.skaters[skaterId(0, "C")];
    a.pos.x = 0;
    a.pos.y = 0;
    a.heading = 0;
    w.puck.pos.x = 3;
    w.puck.pos.y = 0;
    w.puck.vel.x = 0;
    w.puck.vel.y = 0;
    a.input.mx = 1;
    a.input.my = 0;
    run(w, 1.2);
    expect(w.puck.carrier).toBe(a.id);
  });
});
