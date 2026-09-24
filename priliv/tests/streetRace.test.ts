import { describe, expect, it } from "vitest";
import { CAR_SPECS, collideCar, makeCar, separateCars, stepCar } from "../src/entities/carPhysics";
import { RaceStandings, cornerSpeed, gridSlot, makeRacer, raceCheckpoints, racerInput, streetRaceMission, tracks } from "../src/game/streetRace";
import { Rng } from "../src/core/rng";
import { generateCity, isOnCarriageway, resolveCircleVsBuildings } from "../src/world/city";
import { generateIsland, landAt, onIslandRoad } from "../src/world/island";

const LIMIT = 278;
const city = generateCity(new Rng(20260924), 8);
const island = generateIsland(new Rng(20260924));
const world = { ...city, buildings: [...city.buildings, ...island.colliders] };
const onRoad = (p: { x: number; z: number }) => isOnCarriageway(8, p.x, p.z) || onIslandRoad(p.x, p.z) || landAt(p.x, p.z, LIMIT) === "bridge";

describe("tracks", () => {
  it("put every checkpoint and grid slot on open road", () => {
    for (const t of tracks(8)) {
      for (const p of [...t.points, t.start, ...[0, 1, 2, 3].map((i) => gridSlot(t, i))]) {
        expect(onRoad(p), `${t.id} ${p.x},${p.z}`).toBe(true);
        expect(resolveCircleVsBuildings(world, p.x, p.z, 1.5)).toBeNull();
      }
      const m = streetRaceMission(t);
      expect((m.steps[0] as { points: unknown[] }).points.length).toBe(t.points.length * t.laps);
    }
  });

  it("grid slots are two abreast and do not overlap", () => {
    const t = tracks(8)[0];
    const s = [0, 1, 2, 3].map((i) => gridSlot(t, i));
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) expect(Math.hypot(s[i].x - s[j].x, s[i].z - s[j].z)).toBeGreaterThan(4);
    expect(s[0].x).toBe(s[1].x);
    expect(s[2].x).toBeLessThan(s[0].x);
  });

  it("slows for sharp corners only", () => {
    const a = { x: 0, z: 0 };
    const b = { x: 100, z: 0 };
    expect(cornerSpeed(a, b, { x: 200, z: 0 }, 0.5)).toBe(60);
    expect(cornerSpeed(a, b, { x: 100, z: 100 }, 0.5)).toBeLessThan(25);
    expect(cornerSpeed(a, b, { x: 0, z: 1 }, 0.5)).toBeLessThan(cornerSpeed(a, b, { x: 100, z: 100 }, 0.5));
  });
});

describe("standings", () => {
  it("ranks finishers first, then by checkpoints and distance", () => {
    const pts = [{ x: 0, z: 0 }, { x: 100, z: 0 }];
    const s = new RaceStandings(["a", "b", "c"], pts);
    s.update("a", 0, 0, 1);
    s.update("b", 0, 0, 1);
    const pos = { a: { x: 50, z: 0 }, b: { x: 80, z: 0 }, c: { x: -50, z: 0 } };
    expect(s.ranking(pos).map((e) => e.id)).toEqual(["b", "a", "c"]);
    expect(s.update("a", 100, 0, 9)).toBe(true);
    expect(s.update("a", 100, 0, 9)).toBe(false);
    expect(s.place("a", pos)).toBe(1);
    s.update("b", 100, 0, 11);
    expect(s.ranking(pos).map((e) => e.order)).toEqual([1, 2, 0]);
  });
});

describe("racer autopilot", () => {
  it("gets off the line side by side without holding the other back", () => {
    const t = tracks(8)[0];
    const pts = raceCheckpoints(t);
    const a = makeCar(gridSlot(t, 0).x, gridSlot(t, 0).z, 0);
    const b = makeCar(gridSlot(t, 1).x, gridSlot(t, 1).z, 0);
    const ra = makeRacer(-1.4, 0.5);
    const rb = makeRacer(1.4, 0.5);
    const dt = 1 / 60;
    for (let i = 0; i < 120; i++) {
      stepCar(a, CAR_SPECS.sedan, racerInput(a, CAR_SPECS.sedan, ra, pts, t.start, [{ x: b.x, z: b.z, r: 1.8, vx: b.vx, vz: b.vz }], dt), dt);
      stepCar(b, CAR_SPECS.sedan, racerInput(b, CAR_SPECS.sedan, rb, pts, t.start, [{ x: a.x, z: a.z, r: 1.8, vx: a.vx, vz: a.vz }], dt), dt);
    }
    expect(Math.hypot(a.vx, a.vz)).toBeGreaterThan(12);
    expect(Math.hypot(b.vx, b.vz)).toBeGreaterThan(12);
  });

  it("slows behind a stopped car in its lane", () => {
    const pts = [{ x: 200, z: 0 }];
    const car = makeCar(0, 0, 0);
    car.vx = 20;
    const r = makeRacer(0, 0.5);
    const input = racerInput(car, CAR_SPECS.sedan, r, pts, { x: 0, z: 0 }, [{ x: 8, z: 0, r: 1.8, vx: 0, vz: 0 }], 1 / 60);
    expect(input.throttle).toBeLessThan(0);
  });

  for (const t of tracks(8)) for (const kind of ["sport", "sedan", "van"]) {
    it(`four ${kind}s finish the ${t.id} inside the time limit`, () => {
      const pts = raceCheckpoints(t);
      const racers = [0, 1, 2, 3].map((i) => {
        const g = gridSlot(t, i);
        return { car: makeCar(g.x, g.z, g.heading), r: makeRacer([-1.6, 1.6, -0.5, 0.5][i], [0.3, 0.6, 0.9, 0.5][i]), spec: CAR_SPECS[kind], done: -1 };
      });
      const standings = new RaceStandings(["0", "1", "2", "3"], pts);
      const dt = 1 / 60;
      for (let t0 = 0; t0 < t.time && racers.some((q) => q.done < 0); t0 += dt) {
        racers.forEach((q, i) => {
          const obstacles = racers.filter((o) => o !== q).map((o) => ({ x: o.car.x, z: o.car.z, r: 2, vx: o.car.vx, vz: o.car.vz }));
          const input = racerInput(q.car, q.spec, q.r, pts, t.start, obstacles, dt);
          stepCar(q.car, q.spec, input, dt);
          const push = resolveCircleVsBuildings(world, q.car.x, q.car.z, 1.8);
          if (push) collideCar(q.car, push.x, push.z);
          expect(landAt(q.car.x, q.car.z, LIMIT)).not.toBe("water");
          if (standings.update(String(i), q.car.x, q.car.z, t0)) q.done = t0;
        });
        for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) separateCars(racers[i].car, racers[j].car, 1.8, 1.8);
      }
      const times = racers.map((q) => q.done);
      expect(times.every((x) => x > 0), `finish times ${times.map((x) => x.toFixed(1))}`).toBe(true);
      // Leaves some room for the player: the winner needs a good part of the limit.
      expect(Math.min(...times)).toBeGreaterThan(t.time * 0.3);
      expect(Math.max(...times)).toBeLessThan(t.time * 0.95);
    });
  }
});
