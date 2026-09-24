import { describe, expect, it } from "vitest";
import { Rng } from "../src/core/rng";
import { generateCity, resolveCircleVsBuildings, roadCoord, PITCH } from "../src/world/city";
import { CAR_SPECS, collideCar, makeCar, stepCar } from "../src/entities/carPhysics";
import { Wanted, evadeTime, starsFor } from "../src/police/wanted";
import { lineOfSight, makeUnit, nearestIntersection, policeDrive, stepToward } from "../src/police/policeAI";

describe("wanted level", () => {
  it("maps heat to stars", () => {
    expect(starsFor(0)).toBe(0);
    expect(starsFor(1)).toBe(1);
    expect(starsFor(9.9)).toBe(2);
    expect(starsFor(100)).toBe(5);
  });

  it("only rises from crimes and clears after staying unseen", () => {
    const w = new Wanted();
    expect(w.add("hitPed")).toBe(true);
    expect(w.level).toBe(1);
    w.add("ramCop");
    expect(w.level).toBe(2);
    // Being seen resets the escape timer.
    w.update(evadeTime(2) - 1, false);
    w.update(0.1, true);
    expect(w.level).toBe(2);
    expect(w.update(evadeTime(2) - 0.5, false)).toBe(false);
    expect(w.searching).toBe(true);
    expect(w.update(1, false)).toBe(true);
    expect(w.level).toBe(0);
    expect(w.heat).toBe(0);
  });

  it("atLeast raises but never lowers", () => {
    const w = new Wanted();
    w.atLeast(3);
    expect(w.level).toBe(3);
    w.atLeast(1);
    expect(w.level).toBe(3);
    w.add("hitPed");
    expect(w.level).toBe(3);
  });
});

describe("police routing", () => {
  it("snaps to the nearest intersection and steps toward the goal", () => {
    expect(nearestIntersection(8, 0, 0)).toEqual({ ix: 4, iz: 4 });
    expect(nearestIntersection(8, PITCH * 0.4, -PITCH * 1.2)).toEqual({ ix: 4, iz: 3 });
    expect(nearestIntersection(8, 1e6, -1e6)).toEqual({ ix: 8, iz: 0 });
    let cur = { ix: 0, iz: 0 };
    const goal = { ix: 5, iz: 3 };
    let steps = 0;
    while ((cur.ix !== goal.ix || cur.iz !== goal.iz) && steps < 20) {
      cur = stepToward(cur, goal);
      steps++;
    }
    expect(cur).toEqual(goal);
    expect(steps).toBe(8);
  });

  it("line of sight is blocked by buildings but clear along a road", () => {
    const city = generateCity(new Rng(4), 6);
    const c = roadCoord(6, 3);
    expect(lineOfSight(city, -100, c, 100, c)).toBe(true);
    const b = city.buildings[0];
    expect(lineOfSight(city, b.x - b.w, b.z, b.x + b.w, b.z)).toBe(false);
  });

  it("a pursuit car reaches a target across town", () => {
    const city = generateCity(new Rng(12), 6);
    const spec = CAR_SPECS.police;
    const car = makeCar(roadCoord(6, 0), roadCoord(6, 0), 0);
    const unit = makeUnit("pursuit");
    const target = { x: roadCoord(6, 5) + 10, z: roadCoord(6, 4), vx: 0, vz: 0 };
    let best = Infinity;
    for (let i = 0; i < 60 * 90; i++) {
      const input = policeDrive(car, unit, city, target, 1 / 60);
      stepCar(car, spec, input, 1 / 60);
      const push = resolveCircleVsBuildings(city, car.x, car.z, spec.length * 0.36);
      if (push) collideCar(car, push.x, push.z);
      best = Math.min(best, Math.hypot(car.x - target.x, car.z - target.z));
      if (best < 6) break;
    }
    expect(best).toBeLessThan(6);
  });
});

describe("police at a standstill", () => {
  it("stops beside a stopped target instead of ramming it", () => {
    const city = generateCity(new Rng(12), 6);
    const spec = CAR_SPECS.police;
    const y = roadCoord(6, 3);
    const car = makeCar(roadCoord(6, 1) + 10, y, 0);
    const unit = makeUnit("pursuit");
    const target = { x: car.x + 30, z: y, vx: 0, vz: 0 };
    for (let i = 0; i < 60 * 15; i++) {
      stepCar(car, spec, policeDrive(car, unit, city, target, 1 / 60), 1 / 60);
    }
    const d = Math.hypot(car.x - target.x, car.z - target.z);
    expect(d).toBeLessThan(9);
    expect(Math.hypot(car.vx, car.vz)).toBeLessThan(1);
  });
});
