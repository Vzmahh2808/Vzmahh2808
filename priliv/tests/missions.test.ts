import { describe, expect, it } from "vitest";
import { MissionRunner, type Mission, type MissionContext } from "../src/game/missions";
import { places, raceMission, storyMissions } from "../src/game/story";
import { MemoryStore, freshSave, loadSave, parseSave, storeInGarage, writeSave, GARAGE_SLOTS } from "../src/game/save";
import { Rng } from "../src/core/rng";
import { generateCity, isOnCarriageway, resolveCircleVsBuildings } from "../src/world/city";

const ctx = (over: Partial<MissionContext> = {}): MissionContext => ({ x: 0, z: 0, vehicle: null, stars: 0, destroyed: new Set(), ...over });

describe("mission runner", () => {
  const delivery: Mission = {
    id: "t",
    title: "t",
    brief: "",
    reward: 100,
    time: 30,
    steps: [
      { kind: "goto", at: { x: 10, z: 0 }, radius: 3, vehicle: "none", text: "walk" },
      { kind: "goto", at: { x: 50, z: 0 }, radius: 3, vehicle: "any", text: "drive" },
    ],
  };

  it("advances steps and pays out", () => {
    const r = new MissionRunner();
    r.start(delivery);
    expect(r.update(ctx({ x: 10, vehicle: "any" }), 1)).toEqual([]);
    const ev = r.update(ctx({ x: 10 }), 1);
    expect(ev[0]).toMatchObject({ type: "step", index: 1 });
    const done = r.update(ctx({ x: 50, vehicle: "any" }), 1);
    expect(done.at(-1)).toMatchObject({ type: "done", reward: 100 });
    expect(r.active).toBe(false);
  });

  it("fails when time runs out", () => {
    const r = new MissionRunner();
    r.start(delivery);
    const ev = r.update(ctx(), 31);
    expect(ev).toEqual([expect.objectContaining({ type: "fail", reason: "время вышло" })]);
  });

  it("runs race checkpoints in order and only in a car", () => {
    const r = new MissionRunner();
    const race = raceMission(8);
    r.start(race);
    const pts = (race.steps[0] as { points: { x: number; z: number }[] }).points;
    expect(r.update(ctx({ ...pts[1], vehicle: "any" }), 1)).toEqual([]);
    expect(r.update(ctx({ ...pts[0] }), 1)).toEqual([]);
    for (let i = 0; i < pts.length; i++) r.update(ctx({ ...pts[i], vehicle: "any" }), 1);
    expect(r.active).toBe(false);
  });

  it("fails a protected cargo and applies heat after steps", () => {
    const van = storyMissions(8)[1];
    const r = new MissionRunner();
    r.start(van);
    const ev = r.update(ctx({ vehicle: "van" }), 1);
    expect(ev).toContainEqual({ type: "heat", stars: 2 });
    const fail = r.update(ctx({ vehicle: "van", destroyed: new Set(["van"]) }), 1);
    expect(fail[0]).toMatchObject({ type: "fail" });
  });

  it("stars then evade", () => {
    const noise = storyMissions(8)[2];
    const r = new MissionRunner();
    r.start(noise);
    expect(r.update(ctx({ stars: 3 }), 1)[0]).toMatchObject({ type: "step", index: 1 });
    expect(r.update(ctx({ stars: 2 }), 1)).toEqual([]);
    expect(r.update(ctx({ stars: 0 }), 1).at(-1)).toMatchObject({ type: "done" });
  });

  it("places every mission point on open road", () => {
    const city = generateCity(new Rng(20260924), 8);
    const pts = [
      ...Object.values(places(8)).filter((p) => !Array.isArray(p)),
      ...places(8).garageSlots,
      ...(raceMission(8).steps[0] as { points: { x: number; z: number }[] }).points,
    ] as { x: number; z: number }[];
    for (const m of storyMissions(8)) {
      for (const s of m.steps) if (s.kind === "goto") pts.push(s.at);
      for (const sp of Object.values(m.spawns ?? {})) pts.push(sp);
    }
    for (const p of pts) {
      expect(resolveCircleVsBuildings(city, p.x, p.z, 1.5)).toBeNull();
      expect(isOnCarriageway(8, p.x, p.z)).toBe(true);
    }
  });
});

describe("save data", () => {
  it("round-trips and rejects junk", () => {
    const store = new MemoryStore();
    expect(loadSave(store)).toBeNull();
    const s = freshSave();
    s.money = 1234;
    s.missionsDone.push("first-run");
    writeSave(s, store);
    expect(loadSave(store)).toEqual(s);
    expect(parseSave("{not json")).toBeNull();
    expect(parseSave(JSON.stringify({ version: 999 }))).toBeNull();
    const repaired = parseSave(JSON.stringify({ version: 1, money: -50, garage: [{ kind: "van", color: 1 }, "bad"], missionsDone: [1, "x"] }));
    expect(repaired!.money).toBe(0);
    expect(repaired!.garage).toEqual([{ kind: "van", color: 1 }]);
    expect(repaired!.missionsDone).toEqual(["x"]);
  });

  it("garage keeps the newest cars", () => {
    const s = freshSave();
    for (let i = 0; i < 5; i++) storeInGarage(s, { kind: "sedan", color: i });
    expect(s.garage.length).toBe(GARAGE_SLOTS);
    expect(s.garage.map((c) => c.color)).toEqual([2, 3, 4]);
  });
});
