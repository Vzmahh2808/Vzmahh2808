import { describe, expect, it } from "vitest";
import { Rng } from "../src/core/rng";
import { MissionRunner } from "../src/game/missions";
import { buy, fareTime, makeCourierRun, makeTaxiFare, taxiFare, MOD_SHOP, SHOP } from "../src/game/jobs";
import { places } from "../src/game/story";
import { CAR_SPECS, NO_MODS, armorFactor, moddedSpec } from "../src/entities/carPhysics";
import { generateCity, isOnCarriageway, resolveCircleVsBuildings } from "../src/world/city";
import { buildWalkGraph } from "../src/world/sidewalks";
import { knockPed, scare, spawnPeds, stepPed } from "../src/entities/peds";
import { parseSave } from "../src/game/save";

const pool = Array.from({ length: 60 }, (_, i) => ({ x: (i % 10) * 50 - 225, z: Math.floor(i / 10) * 60 - 150 }));

describe("taxi", () => {
  it("pays more for longer and faster rides", () => {
    expect(taxiFare(400, 0, 60)).toBeGreaterThan(taxiFare(100, 0, 60));
    expect(taxiFare(200, 50, 60)).toBeGreaterThan(taxiFare(200, 0, 60));
    expect(fareTime(0)).toBe(30);
  });

  it("needs a full stop at pickup and dropoff", () => {
    const fare = makeTaxiFare(new Rng(4), pool, { x: 0, z: 0 });
    expect(Math.hypot(fare.pickup.x, fare.pickup.z)).toBeGreaterThanOrEqual(60);
    const r = new MissionRunner();
    r.start(fare.mission);
    const at = (p: { x: number; z: number }, speed: number) => ({ ...p, vehicle: "any", stars: 0, speed, destroyed: new Set<string>() });
    expect(r.update(at(fare.pickup, 10), 1)).toEqual([]);
    expect(r.update(at(fare.pickup, 1), 1)[0]).toMatchObject({ type: "step", index: 1 });
    expect(r.update(at(fare.dropoff, 1), 1).at(-1)).toMatchObject({ type: "done" });
  });
});

describe("courier", () => {
  it("builds three drops with time and pay scaled to distance", () => {
    const m = makeCourierRun(new Rng(2), pool, { x: 0, z: 200 });
    expect(m.steps.length).toBe(3);
    expect(m.reward).toBeGreaterThan(150);
    expect(m.time).toBeGreaterThan(30);
  });
});

describe("shop and tuning", () => {
  it("sells cars that exist and refuses when broke", () => {
    for (const c of SHOP) expect(CAR_SPECS[c.kind]).toBeDefined();
    expect(buy(1000, 800)).toBe(200);
    expect(buy(500, 800)).toBeNull();
    expect(MOD_SHOP.map((m) => m.key).sort()).toEqual(["armor", "engine", "tires"]);
  });

  it("mods change the spec and damage taken", () => {
    const base = CAR_SPECS.sedan;
    expect(moddedSpec(base, NO_MODS)).toBe(base);
    const tuned = moddedSpec(base, { engine: true, tires: true, armor: false });
    expect(tuned.maxSpeed).toBeGreaterThan(base.maxSpeed);
    expect(tuned.grip).toBeGreaterThan(base.grip);
    expect(armorFactor({ engine: false, tires: false, armor: true })).toBeLessThan(1);
  });

  it("keeps mods in garage saves", () => {
    const s = parseSave(JSON.stringify({ version: 1, garage: [{ kind: "sport", color: 1, mods: { engine: true } }, { kind: "van", color: 2 }] }));
    expect(s!.garage[0].mods).toEqual({ engine: true, tires: false, armor: false });
    expect(s!.garage[1].mods).toEqual({ engine: false, tires: false, armor: false });
  });

  it("puts the shop, depot and lot on open road", () => {
    const city = generateCity(new Rng(20260924), 8);
    const pl = places(8);
    for (const p of [pl.shop, pl.depot, pl.shopLot]) {
      expect(resolveCircleVsBuildings(city, p.x, p.z, 1.5)).toBeNull();
      expect(isOnCarriageway(8, p.x, p.z)).toBe(true);
    }
  });
});

describe("waiting passengers", () => {
  it("stand still, ignore scares, but can still be knocked over", () => {
    const city = generateCity(new Rng(9), 6);
    const g = buildWalkGraph(city);
    const rng = new Rng(1);
    const [p] = spawnPeds(rng, g, 1);
    p.state = "wait";
    const x = p.x;
    scare(p, { x: p.x + 1, z: p.z });
    for (let i = 0; i < 60; i++) stepPed(p, g, rng, 1 / 60, [{ x: p.x, z: p.z, radius: 5 }]);
    expect(p.state).toBe("wait");
    expect(p.x).toBe(x);
    knockPed(p, 10, 0);
    expect(p.state).toBe("down");
  });
});
