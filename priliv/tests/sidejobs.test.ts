import { describe, expect, it } from "vitest";
import { CARGO_POINTS, EXPORT_BONUS, EXPORT_PRICES, deliverExport, derbyMission, exportDock, exportList, exportPay, exportRemaining, freshExport, makeBoatRun } from "../src/game/sidejobs";
import { MissionRunner, type MissionContext } from "../src/game/missions";
import { barOf, places, sevaOf } from "../src/game/story";
import { businesses } from "../src/game/business";
import { hideouts } from "../src/game/hideouts";
import { freshSave, parseSave } from "../src/game/save";
import { Rng } from "../src/core/rng";
import { ROAD_WIDTH, generateCity, isOnCarriageway, resolveCircleVsBuildings } from "../src/world/city";
import { isBoatWater } from "../src/world/water";

const city = generateCity(new Rng(20260924), 8);
const LIMIT = city.half + ROAD_WIDTH / 2 + 30;
const ctx = (over: Partial<MissionContext> = {}): MissionContext => ({ x: 0, z: 0, vehicle: null, stars: 0, destroyed: new Set(), ...over });
const DT = 1 / 60;

describe("export dock", () => {
  it("wants three different cars it knows the price of", () => {
    for (let seed = 1; seed < 30; seed++) {
      const list = exportList(new Rng(seed));
      expect(new Set(list).size).toBe(3);
      for (const k of list) expect(EXPORT_PRICES[k]).toBeGreaterThan(0);
    }
  });

  it("pays by condition, never below 40%", () => {
    expect(exportPay("sport", 100)).toBe(1500);
    expect(exportPay("sport", 0)).toBe(600);
    expect(exportPay("sport", 50)).toBe(1050);
    expect(exportPay("sport", 150)).toBe(1500);
    expect(exportPay("boat", 100)).toBe(0);
  });

  it("takes each wanted car once and pays a bonus for the whole list", () => {
    const rng = new Rng(7);
    const s = freshExport(rng);
    const list = [...s.wanted];
    const other = Object.keys(EXPORT_PRICES).find((k) => !list.includes(k))!;
    expect(deliverExport(s, other, 100, rng)).toEqual({ ok: false, reason: "unwanted" });
    expect(deliverExport(s, list[0], 100, rng)).toMatchObject({ ok: true, bonus: 0, listDone: false });
    expect(deliverExport(s, list[0], 100, rng)).toEqual({ ok: false, reason: "already" });
    expect(exportRemaining(s)).toEqual(list.slice(1));
    deliverExport(s, list[1], 80, rng);
    const last = deliverExport(s, list[2], 30, rng);
    expect(last).toMatchObject({ ok: true, bonus: EXPORT_BONUS, listDone: true, pay: exportPay(list[2], 30) });
    // A new list is drawn and the old deliveries are cleared.
    expect(s.delivered).toEqual([]);
    expect(s.wanted).toHaveLength(3);
    expect(s.total).toBe(3);
  });

  it("stands on the east quay road, clear of every other marker", () => {
    const d = exportDock(8);
    const P = places(8);
    const others = [P.garage, P.paint, P.contact, P.race, P.shop, P.depot, P.office, P.gunShop, barOf(8), sevaOf(8), ...businesses(8).map((b) => b.at), ...hideouts(8).map((h) => h.at)];
    for (const o of others) expect(Math.hypot(o.x - d.x, o.z - d.z)).toBeGreaterThan(15);
    expect(isOnCarriageway(8, d.x, d.z)).toBe(true);
    expect(resolveCircleVsBuildings(city, d.x, d.z, 2)).toBeNull();
  });

  it("survives a save round trip and drops junk", () => {
    const s = { ...freshSave(), export: { wanted: ["sport", "boat", "sport", "van"], delivered: ["van", "taxi"], total: 4.7 } };
    expect(parseSave(JSON.stringify(s))!.export).toEqual({ wanted: ["sport", "van"], delivered: ["van"], total: 4 });
    const old = { ...freshSave() } as Record<string, unknown>;
    delete old.export;
    expect(parseSave(JSON.stringify(old))!.export).toEqual({ wanted: [], delivered: [], total: 0 });
  });
});

describe("cargo by boat", () => {
  it("uses only open-water points", () => {
    for (const p of CARGO_POINTS) expect(isBoatWater(p.x, p.z, LIMIT), `${p.x},${p.z}`).toBe(true);
  });

  it("sends the boat somewhere and back out, with pay and time to match", () => {
    const marina = { x: 304, z: -172 };
    for (let seed = 1; seed < 40; seed++) {
      const m = makeBoatRun(new Rng(seed), CARGO_POINTS, marina);
      const [a, b] = m.steps;
      if (a.kind !== "goto" || b.kind !== "goto") throw new Error("goto steps expected");
      expect(Math.hypot(b.at.x - a.at.x, b.at.z - a.at.z)).toBeGreaterThan(150);
      expect(m.reward).toBeGreaterThan(300);
      expect(m.time).toBeGreaterThan(60);
    }
  });

  it("counts only a boat at the buoy", () => {
    const m = makeBoatRun(new Rng(3), CARGO_POINTS, { x: 304, z: -172 });
    const a = m.steps[0];
    if (a.kind !== "goto") throw new Error("goto expected");
    const r = new MissionRunner();
    r.start(m);
    r.update(ctx({ ...a.at, vehicle: "any" }), DT);
    expect(r.step).toBe(0);
    r.update(ctx({ ...a.at, vehicle: "boat" }), DT);
    expect(r.step).toBe(1);
  });
});

describe("demolition derby", () => {
  const race = places(8).race;
  const m = derbyMission(8, race);

  it("puts four ramming, unarmed rivals on the road inside the ring", () => {
    const spawns = Object.values(m.spawns!);
    expect(spawns).toHaveLength(4);
    for (const sp of spawns) {
      expect(sp.hostile && sp.unarmed).toBe(true);
      expect(isOnCarriageway(8, sp.x, sp.z)).toBe(true);
      expect(resolveCircleVsBuildings(city, sp.x, sp.z, 1.5)).toBeNull();
      const d = Math.hypot(sp.x - race.x, sp.z - race.z);
      expect(d).toBeGreaterThan(30);
      expect(d).toBeLessThan(m.area!.radius - 15);
    }
  });

  it("is won by wrecking all four, and lost by leaving the ring", () => {
    const r = new MissionRunner();
    r.start(m);
    expect(r.update(ctx({ ...race, destroyed: new Set(["d1", "d2", "d3", "d4"]) }), DT).at(-1)).toMatchObject({ type: "done" });
    r.start(m);
    expect(r.update(ctx({ x: race.x + 200, z: race.z }), DT)).toEqual([expect.objectContaining({ type: "fail" })]);
  });
});

describe("derby rivals", () => {
  it("each reach the race start on their own", async () => {
    const { CAR_SPECS, collideCar, makeCar, stepCar } = await import("../src/entities/carPhysics");
    const { gangDrive } = await import("../src/police/gangAI");
    const { makeUnit } = await import("../src/police/policeAI");
    const race = places(8).race;
    for (const [key, sp] of Object.entries(derbyMission(8, race).spawns!)) {
      const car = makeCar(sp.x, sp.z, sp.heading);
      const unit = makeUnit("pursuit");
      let reached = -1;
      for (let t = 0; t < 45 && reached < 0; t += DT) {
        stepCar(car, CAR_SPECS.pickup, gangDrive(car, unit, city, { ...race, vx: 0, vz: 0 }, DT), DT);
        const push = resolveCircleVsBuildings(city, car.x, car.z, 1.8);
        if (push) collideCar(car, push.x, push.z);
        if (Math.hypot(car.x - race.x, car.z - race.z) < 6) reached = t;
      }
      expect(reached, `${key} from ${sp.x},${sp.z}`).toBeGreaterThan(0);
    }
  });
});
