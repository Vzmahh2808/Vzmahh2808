import { describe, expect, it } from "vitest";
import { freshAir, landingDamage, rampHeight, stepVertical, surfaceAt, type Ramp } from "../src/entities/jumps";
import { RAMPS, describeJump, finishJump, isCleanLanding, lipOf, startJump, trackJump } from "../src/game/stunts";
import { Rng } from "../src/core/rng";
import { generateCity, resolveCircleVsBuildings } from "../src/world/city";
import { generateIsland, landAt } from "../src/world/island";

const ramp: Ramp = { id: "t", name: "t", x: 0, z: 0, heading: 0, length: 11, width: 7, height: 2, goal: 35 };
const DT = 1 / 60;

/** Drive straight over a ramp at a constant speed; returns where and how the car came down. */
function fly(r: Ramp, speed: number) {
  const air = freshAir();
  const fx = Math.cos(r.heading);
  const fz = Math.sin(r.heading);
  let x = r.x - fx * 30;
  let z = r.z - fz * 30;
  let launched = false;
  for (let t = 0; t < 10; t += DT) {
    x += fx * speed * DT;
    z += fz * speed * DT;
    const ev = stepVertical(air, x, z, [r], DT);
    if (ev?.type === "launch") launched = true;
    if (ev?.type === "land" && launched) {
      const lip = lipOf(r);
      return { distance: Math.hypot(x - lip.x, z - lip.z), impact: ev.impact };
    }
  }
  return { distance: 0, impact: 0 };
}

describe("ramps", () => {
  it("rise along their length and are flat nowhere else", () => {
    expect(rampHeight(ramp, -1, 0)).toBeNull();
    expect(rampHeight(ramp, 0, 0)).toBe(0);
    expect(rampHeight(ramp, 5.5, 0)).toBeCloseTo(1);
    expect(rampHeight(ramp, 11, 3.5)).toBeCloseTo(2);
    expect(rampHeight(ramp, 5, 4)).toBeNull();
    expect(surfaceAt([ramp], 20, 0)).toEqual({ h: 0, ramp: null });
  });

  it("launch a fast car far and a slow one barely", () => {
    const fast = fly(ramp, 32);
    const slow = fly(ramp, 12);
    expect(fast.distance).toBeGreaterThan(ramp.goal);
    expect(slow.distance).toBeLessThan(15);
    expect(fast.impact).toBeGreaterThan(slow.impact);
  });

  it("are a wall from the tall end", () => {
    const air = freshAir();
    expect(stepVertical(air, 10.5, 0, [ramp], DT)).toEqual({ type: "blocked" });
    expect(air.y).toBe(0);
  });

  it("hard or crooked landings hurt", () => {
    expect(landingDamage(6, false)).toBe(0);
    expect(landingDamage(14, false)).toBeGreaterThan(0);
    expect(landingDamage(6, true)).toBeGreaterThan(0);
  });
});

describe("stunt scoring", () => {
  it("scores distance, air time, height and turns; unique only past the goal and clean", () => {
    const j = startJump(ramp, 11, 0, 0);
    for (let i = 0; i < 90; i++) trackJump(j, DT, 3, (i / 89) * Math.PI * 2);
    const r = finishJump(j, 11 + 40, 0, true);
    expect(r.distance).toBeCloseTo(40);
    expect(r.turns).toBe(1);
    expect(r.unique).toBe(true);
    expect(r.score).toBeGreaterThan(40 * 10 + 500);
    expect(describeJump(r)).toBe("40 м · 1.5 с · 360°");
    expect(finishJump(j, 11 + 20, 0, true).unique).toBe(false);
    expect(finishJump(j, 11 + 40, 0, false)).toMatchObject({ unique: false, score: 0 });
  });

  it("a landing is clean when the car faces its flight path", () => {
    expect(isCleanLanding(0, 20, 0, 8)).toBe(true);
    expect(isCleanLanding(Math.PI / 2, 20, 0, 8)).toBe(false);
    expect(isCleanLanding(0, 20, 0, 20)).toBe(false);
  });
});

describe("unique jumps in the world", () => {
  const city = generateCity(new Rng(20260924), 8);
  const island = generateIsland(new Rng(20260924));
  const world = { ...city, buildings: [...city.buildings, ...island.colliders] };

  for (const r of RAMPS) {
    it(`${r.id}: clear run-up, ramp and landing on dry road, goal reachable at speed`, () => {
      const fx = Math.cos(r.heading);
      const fz = Math.sin(r.heading);
      // 40 m of run-up, the ramp itself, and the whole landing zone past the goal.
      for (let d = -40; d <= r.length + r.goal + 15; d += 2) {
        const x = r.x + fx * d;
        const z = r.z + fz * d;
        expect(landAt(x, z, 278), `${r.id} at ${d}`).not.toBe("water");
        expect(resolveCircleVsBuildings(world, x, z, 1.8), `${r.id} at ${d}`).toBeNull();
      }
      expect(fly(r, 32).distance).toBeGreaterThan(r.goal);
    });
  }
});

import { freshSave, parseSave } from "../src/game/save";

describe("saving stunts", () => {
  it("keeps cleared jumps and the best score, dropping junk and duplicates", () => {
    const s = freshSave();
    s.stunts = { done: ["bridge", "north"], best: 1840 };
    expect(parseSave(JSON.stringify(s))!.stunts).toEqual(s.stunts);
    const junk = parseSave(JSON.stringify({ version: 1, stunts: { done: ["x", "x", 5], best: -3 } }))!;
    expect(junk.stunts).toEqual({ done: ["x"], best: 0 });
    expect(parseSave(JSON.stringify({ version: 1 }))!.stunts).toEqual({ done: [], best: 0 });
  });
});
