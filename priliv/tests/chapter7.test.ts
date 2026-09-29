import { describe, expect, it } from "vitest";
import { CAR_SPECS, collideCar, makeCar, stepCar } from "../src/entities/carPhysics";
import { gangDrive } from "../src/police/gangAI";
import { makeUnit } from "../src/police/policeAI";
import { MissionRunner, type MissionContext } from "../src/game/missions";
import { barOf, chapterSeven, hallOf, places, sevaOf, storyMissions } from "../src/game/story";
import { businesses } from "../src/game/business";
import { hideouts } from "../src/game/hideouts";
import { exportDock } from "../src/game/sidejobs";
import { WEAPONS, WEAPON_ORDER } from "../src/game/weapons";
import { THUG_SIGHT } from "../src/police/thugAI";
import { freshSave, parseSave } from "../src/game/save";
import { Rng } from "../src/core/rng";
import { generateCity, isOnCarriageway, resolveCircleVsBuildings } from "../src/world/city";
import { landAt } from "../src/world/island";

const city = generateCity(new Rng(20260924), 8);
const ctx = (over: Partial<MissionContext> = {}): MissionContext => ({ x: 0, z: 0, vehicle: null, stars: 0, destroyed: new Set(), ...over });
const DT = 1 / 60;
const ch = chapterSeven(8);
const office = places(8).office;
const hall = hallOf(8);

describe("chapter seven", () => {
  it("follows chapter six, opens with a banner and is handed out by Nika", () => {
    const all = storyMissions(8);
    expect(all.length).toBe(35);
    expect(all[30].id).toBe("ch7-leak");
    expect(all[30].chapterTitle).toBe("Глава 7: Мэрия");
    expect(ch).toHaveLength(5);
    for (const m of ch) {
      expect(m.contact).toEqual(office);
      expect(m.chapter).toBe(7);
    }
  });

  it("puts the town hall on open road, clear of every other marker", () => {
    const P = places(8);
    const others = [P.garage, P.paint, P.contact, P.race, P.shop, P.depot, P.gunShop, barOf(8), sevaOf(8), exportDock(8), ...businesses(8).map((b) => b.at), ...hideouts(8).map((h) => h.at)];
    for (const o of others) expect(Math.hypot(o.x - hall.x, o.z - hall.z), `${o.x},${o.z}`).toBeGreaterThan(25);
    expect(isOnCarriageway(8, hall.x, hall.z)).toBe(true);
    expect(resolveCircleVsBuildings(city, hall.x, hall.z, 1.5)).toBeNull();
  });

  it("stands every thug, paper and car on open city ground", () => {
    for (const m of ch) {
      for (const [k, t] of Object.entries(m.thugs ?? {})) {
        expect(landAt(t.x, t.z, 400), `${m.id}.${k}`).toBe("city");
        expect(resolveCircleVsBuildings(city, t.x, t.z, 0.6), `${m.id}.${k} ${t.x},${t.z}`).toBeNull();
      }
      for (const [k, sp] of Object.entries(m.spawns ?? {})) {
        expect(isOnCarriageway(8, sp.x, sp.z), `${m.id}.${k} ${sp.x},${sp.z}`).toBe(true);
        expect(resolveCircleVsBuildings(city, sp.x, sp.z, 1.5), `${m.id}.${k}`).toBeNull();
      }
      for (const st of m.steps) {
        if (st.kind !== "collect") continue;
        for (const p of st.points) expect(resolveCircleVsBuildings(city, p.x, p.z, 0.6), `${p.x},${p.z}`).toBeNull();
      }
    }
  });

  it("leak: tail, then papers, then back to the office", () => {
    const m = ch[0];
    const kinds = m.steps.map((s) => s.kind);
    expect(kinds).toEqual(["tail", "collect", "goto"]);
    const r = new MissionRunner();
    r.start(m);
    const tail = m.steps[0];
    if (tail.kind !== "tail") throw new Error("tail expected");
    // Ten seconds at a good distance count as progress.
    r.update(ctx({ x: 60, z: 0, targets: { aide: { x: 60 + (tail.near + tail.far) / 2, z: 0 } } }), 10);
    expect(r.progress).toBeCloseTo(10);
    // Unalerted watchers do not see the player from the office.
    for (const t of Object.values(m.thugs!)) {
      expect(t.alerted).toBeFalsy();
      expect(Math.hypot(t.x - office.x, t.z - office.z)).toBeGreaterThan(THUG_SIGHT + 10);
    }
  });

  it("cash van: stealing it raises the heat, and the job ends only when the police are shaken", () => {
    const m = ch[1];
    const r = new MissionRunner();
    r.start(m);
    const ev = r.update(ctx({ vehicle: "van" }), DT);
    expect(ev).toContainEqual({ type: "heat", stars: 3 });
    expect(r.step).toBe(1);
    const seva = sevaOf(8);
    r.update(ctx({ ...seva, vehicle: "van", stars: 3 }), DT);
    expect(r.currentStep?.kind).toBe("evade");
    expect(r.update(ctx({ ...seva, stars: 0 }), DT).at(-1)).toMatchObject({ type: "done", reward: 5500 });
  });

  it("the mayor's van is a moving target with three escorts", () => {
    const m = ch[2];
    expect(m.spawns!.limo.drives).toBe(true);
    expect(Object.values(m.spawns!).filter((s) => s.hostile)).toHaveLength(3);
    const r = new MissionRunner();
    r.start(m);
    expect(r.update(ctx({ destroyed: new Set(["limo"]) }), DT).at(-1)).toMatchObject({ type: "done", reward: 6500 });
  });

  it("the siege sends alerted gunmen and holds for 50 seconds at the office", () => {
    const m = ch[3];
    expect(Object.values(m.thugs!)).toHaveLength(8);
    for (const t of Object.values(m.thugs!)) expect(t.alerted).toBe(true);
    const r = new MissionRunner();
    r.start(m);
    r.update(ctx({ ...office }), 49);
    expect(r.step).toBe(0);
    expect(r.update(ctx({ ...office }), 2).at(-1)).toMatchObject({ type: "done", reward: 8000 });
  });

  it("the finale has a very tough mayor, then brings four stars", () => {
    const m = ch[4];
    const hp = Object.values(m.thugs!).map((t) => t.hp ?? 60);
    expect(Math.max(...hp)).toBeGreaterThanOrEqual(300);
    expect(hp.filter((h) => h > 60)).toHaveLength(1);
    const r = new MissionRunner();
    r.start(m);
    const ev = r.update(ctx({ destroyed: new Set(Object.keys(m.thugs!)) }), DT);
    expect(ev).toContainEqual({ type: "heat", stars: 4 });
    expect(r.currentStep?.kind).toBe("evade");
  });

  it("siege hunters reach the office", () => {
    for (const [key, sp] of Object.entries(ch[3].spawns ?? {})) {
      const car = makeCar(sp.x, sp.z, sp.heading);
      const unit = makeUnit("pursuit");
      let reached = -1;
      for (let t = 0; t < 45 && reached < 0; t += DT) {
        stepCar(car, CAR_SPECS.sedan, gangDrive(car, unit, city, { ...office, vx: 0, vz: 0 }, DT), DT);
        const push = resolveCircleVsBuildings(city, car.x, car.z, 1.8);
        if (push) collideCar(car, push.x, push.z);
        if (Math.hypot(car.x - office.x, car.z - office.z) < 6) reached = t;
      }
      expect(reached, key).toBeGreaterThan(0);
    }
  });
});

describe("shotgun", () => {
  it("hits hard at short range and is sold only after chapter six", () => {
    const g = WEAPONS.shotgun;
    expect(g.damage).toBeGreaterThanOrEqual(WEAPONS.pistol.damage * 2);
    expect(g.range).toBeLessThan(WEAPONS.pistol.range);
    expect(g.unlock).toBe("ch6-finale");
    expect(storyMissions(8).some((m) => m.id === g.unlock)).toBe(true);
    expect(WEAPON_ORDER).toContain("shotgun");
  });

  it("survives a save round trip", () => {
    const s = { ...freshSave(), weapons: { owned: ["shotgun", "pistol", "bazooka"], ammo: { shotgun: 12, bazooka: 5 }, selected: "shotgun" } };
    expect(parseSave(JSON.stringify(s))!.weapons).toEqual({ owned: ["shotgun", "pistol"], ammo: { shotgun: 12, pistol: 0 }, selected: "shotgun" });
  });
});
