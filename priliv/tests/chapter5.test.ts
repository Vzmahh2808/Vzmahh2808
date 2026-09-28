import { describe, expect, it } from "vitest";
import { CAR_SPECS, collideCar, makeCar, stepCar } from "../src/entities/carPhysics";
import { gangDrive } from "../src/police/gangAI";
import { makeUnit } from "../src/police/policeAI";
import { MissionRunner, type MissionContext } from "../src/game/missions";
import { barOf, chapterFive, places, storyMissions } from "../src/game/story";
import { businesses, buyBusiness, freshHoldings, stateOf, tick } from "../src/game/business";
import { Rng } from "../src/core/rng";
import { generateCity, isOnCarriageway, resolveCircleVsBuildings } from "../src/world/city";

const city = generateCity(new Rng(20260924), 8);
const ctx = (over: Partial<MissionContext> = {}): MissionContext => ({ x: 0, z: 0, vehicle: null, stars: 0, destroyed: new Set(), ...over });

describe("chapter five", () => {
  it("follows chapter four and opens with a banner", () => {
    const all = storyMissions(8);
    expect(all.length).toBe(25);
    expect(all[20].id).toBe("ch5-mark");
    expect(all[20].chapterTitle).toBe("Глава 5: Чёрная метка");
  });

  it("puts the bar and every spawn on open road, clear of other markers", () => {
    const bar = barOf(8);
    const P = places(8);
    const others = [P.garage, P.paint, P.contact, P.race, P.shop, P.depot, P.office, ...businesses(8).map((b) => b.at)];
    for (const o of others) expect(Math.hypot(o.x - bar.x, o.z - bar.z)).toBeGreaterThan(15);
    const pts = [bar];
    for (const m of chapterFive(8)) {
      expect(m.contact).toEqual(bar);
      for (const sp of Object.values(m.spawns ?? {})) pts.push(sp);
    }
    for (const p of pts) {
      expect(isOnCarriageway(8, p.x, p.z), `${p.x},${p.z}`).toBe(true);
      expect(resolveCircleVsBuildings(city, p.x, p.z, 1.5)).toBeNull();
    }
    // Every mission sends at least one hunter.
    for (const m of chapterFive(8)) {
      if (m.id === "ch5-hostage" || m.id === "ch5-mark" || m.id === "ch5-siege" || m.id === "ch5-nest" || m.id === "ch5-boss") {
        expect(Object.values(m.spawns ?? {}).some((s) => s.hostile)).toBe(true);
      }
    }
  });

  it("survive counts seconds alive", () => {
    const r = new MissionRunner();
    r.start(chapterFive(8)[0]);
    r.update(ctx(), 30);
    expect(r.gauge()).toMatchObject({ label: "Продержитесь 30 с", value: 0.5 });
    expect(r.update(ctx(), 30).at(-1)).toMatchObject({ type: "done", reward: 2500 });
  });

  it("the last fight ends the shakedowns", () => {
    const all = businesses(8);
    const h = freshHoldings();
    buyBusiness(h, all[0], 99999);
    expect(tick(h, all, 100, new Rng(1), false)).toEqual([]);
    expect(stateOf(h, all[0].id).raid).toBe(0);
    expect(stateOf(h, all[0].id).stored).toBe(all[0].cap);
  });
});

describe("gang hunters", () => {
  it("reach the bar from every chapter five spawn", () => {
    const dt = 1 / 60;
    const bar = barOf(8);
    for (const m of chapterFive(8)) {
      for (const [key, sp] of Object.entries(m.spawns ?? {})) {
        if (!sp.hostile) continue;
        const car = makeCar(sp.x, sp.z, sp.heading);
        const unit = makeUnit("pursuit");
        let reached = -1;
        for (let t = 0; t < 45 && reached < 0; t += dt) {
          stepCar(car, CAR_SPECS.sedan, gangDrive(car, unit, city, { ...bar, vx: 0, vz: 0 }, dt), dt);
          const push = resolveCircleVsBuildings(city, car.x, car.z, 1.8);
          if (push) collideCar(car, push.x, push.z);
          if (Math.hypot(car.x - bar.x, car.z - bar.z) < 6) reached = t;
        }
        expect(reached, `${m.id}.${key} from ${sp.x},${sp.z}`).toBeGreaterThan(0);
      }
    }
  });

  it("find a target across town and keep ramming it", () => {
    const dt = 1 / 60;
    const car = makeCar(-180, 140, Math.PI / 2);
    const unit = makeUnit("pursuit");
    const target = { x: 60, z: 150, vx: 0, vz: 0 };
    let firstHit = -1;
    let hits = 0;
    let wasClose = false;
    for (let t = 0; t < 70; t += dt) {
      stepCar(car, CAR_SPECS.sedan, gangDrive(car, unit, city, target, dt), dt);
      const push = resolveCircleVsBuildings(city, car.x, car.z, 1.8);
      if (push) collideCar(car, push.x, push.z);
      // The target is a parked car: bounce off it.
      const d = Math.hypot(car.x - target.x, car.z - target.z);
      const close = d < 3.6;
      if (close && !wasClose) {
        hits++;
        if (firstHit < 0) firstHit = t;
        const nx = (car.x - target.x) / d;
        const nz = (car.z - target.z) / d;
        collideCar(car, nx * (3.6 - d), nz * (3.6 - d));
      }
      wasClose = close;
    }
    expect(firstHit).toBeGreaterThan(0);
    expect(firstHit).toBeLessThan(40);
    expect(hits).toBeGreaterThanOrEqual(3);
  });
});
