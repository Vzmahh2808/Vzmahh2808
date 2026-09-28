import { describe, expect, it } from "vitest";
import { MissionRunner, type MissionContext } from "../src/game/missions";
import { HIDEOUT_AREA, hideoutMission, hideouts } from "../src/game/hideouts";
import { THUG_FIRE_RANGE, THUG_RUN, THUG_SIGHT, THUG_STAND, enemyHitChance, freshBrain, thugIntent } from "../src/police/thugAI";
import { places } from "../src/game/story";
import { businesses } from "../src/game/business";
import { Rng } from "../src/core/rng";
import { generateCity, resolveCircleVsBuildings } from "../src/world/city";
import { landAt } from "../src/world/island";

const DT = 1 / 60;
const city = generateCity(new Rng(20260924), 8);
const ctx = (over: Partial<MissionContext> = {}): MissionContext => ({ x: 0, z: 0, vehicle: null, stars: 0, destroyed: new Set(), ...over });
const half = () => 0.5;

describe("thugs", () => {
  it("stand guard until they see the player", () => {
    const b = freshBrain();
    const far = thugIntent(b, 0, 0, 60, 0, true, false, DT, half);
    expect(far).toEqual({ speed: 0, heading: null, fire: false });
    expect(b.alerted).toBe(false);
    // Close but behind a wall: still unaware.
    thugIntent(b, 0, 0, 20, 0, false, false, DT, half);
    expect(b.alerted).toBe(false);
    thugIntent(b, 0, 0, 20, 0, true, false, DT, half);
    expect(b.alerted).toBe(true);
  });

  it("wake up to gunfire even without seeing the shooter", () => {
    const b = freshBrain();
    const i = thugIntent(b, 0, 0, 80, 0, false, true, DT, half);
    expect(b.alerted).toBe(true);
    expect(i.speed).toBe(THUG_RUN);
    expect(i.fire).toBe(false);
  });

  it("run in when out of range, stop close in and shoot about once a second", () => {
    const b = freshBrain(true);
    expect(thugIntent(b, 0, 0, THUG_FIRE_RANGE + 5, 0, true, false, DT, half).speed).toBe(THUG_RUN);
    let shots = 0;
    let speed = -1;
    for (let t = 0; t < 10; t += DT) {
      const i = thugIntent(b, 0, 0, THUG_STAND - 3, 0, true, false, DT, half);
      speed = i.speed;
      if (i.fire) shots++;
    }
    expect(speed).toBe(0);
    expect(shots).toBeGreaterThanOrEqual(8);
    expect(shots).toBeLessThanOrEqual(12);
  });

  it("face the target and never shoot without a clear line", () => {
    const b = freshBrain(true);
    for (let t = 0; t < 5; t += DT) {
      const i = thugIntent(b, 0, 0, 0, 10, false, false, DT, half);
      expect(i.fire).toBe(false);
      expect(i.heading).toBeCloseTo(Math.PI / 2);
    }
  });

  it("miss more often than the player, and more at range", () => {
    expect(enemyHitChance(5)).toBeLessThan(0.6);
    expect(enemyHitChance(25)).toBeLessThan(enemyHitChance(5));
    expect(enemyHitChance(25)).toBeGreaterThan(0.1);
  });
});

describe("clear steps and mission areas", () => {
  const m = hideoutMission(hideouts(8)[0]);
  const keys = Object.keys(m.thugs!);

  it("count targets down and finish once all are down", () => {
    const r = new MissionRunner();
    r.start(m);
    const at = m.area!.at;
    expect(r.update(ctx({ ...at }), DT).some((e) => e.type === "done")).toBe(false);
    expect(r.gauge()?.label).toBe(`Осталось ${keys.length} из ${keys.length}`);
    r.update(ctx({ ...at, destroyed: new Set(keys.slice(0, 2)) }), DT);
    expect(r.cleared).toBe(2);
    expect(r.gauge()?.value).toBeCloseTo(2 / keys.length);
    const ev = r.update(ctx({ ...at, destroyed: new Set(keys) }), DT);
    expect(ev.some((e) => e.type === "done")).toBe(true);
  });

  it("point at the nearest thug still standing", () => {
    const r = new MissionRunner();
    r.start(m);
    const pos = Object.fromEntries(keys.map((k) => [k, { x: m.thugs![k].x, z: m.thugs![k].z }]));
    const first = pos[keys[0]];
    expect(r.objective(pos, first)).toEqual(first);
    r.update(ctx({ ...m.area!.at, destroyed: new Set([keys[0]]) }), DT);
    expect(r.objective(pos, first)).not.toEqual(first);
  });

  it("fail when the player walks off", () => {
    const r = new MissionRunner();
    r.start(m);
    const at = m.area!.at;
    const ev = r.update(ctx({ x: at.x + HIDEOUT_AREA + 5, z: at.z }), DT);
    expect(ev).toEqual([expect.objectContaining({ type: "fail", reason: "вы ушли с разборки" })]);
  });
});

describe("hideouts", () => {
  it("stand on open city ground, clear of each other and of other markers", () => {
    const P = places(8);
    const all = hideouts(8);
    const others = [P.garage, P.paint, P.contact, P.race, P.shop, P.depot, P.office, P.gunShop, ...businesses(8).map((b) => b.at)];
    for (const h of all) {
      for (const o of others) expect(Math.hypot(o.x - h.at.x, o.z - h.at.z), h.id).toBeGreaterThan(40);
      for (const g of all) if (g !== h) expect(Math.hypot(g.at.x - h.at.x, g.at.z - h.at.z)).toBeGreaterThan(HIDEOUT_AREA);
      for (const p of [h.at, ...h.thugs]) {
        expect(landAt(p.x, p.z, 400), `${h.id} ${p.x},${p.z}`).toBe("city");
        expect(resolveCircleVsBuildings(city, p.x, p.z, 0.6), `${h.id} ${p.x},${p.z}`).toBeNull();
      }
      // Thugs wait down the street, out of sight range of the marker, so the fight starts with an approach.
      for (const t of h.thugs) expect(Math.hypot(t.x - h.at.x, t.z - h.at.z)).toBeGreaterThan(THUG_SIGHT);
    }
  });

  it("make a mission with one thug per guard and a growing reward", () => {
    const all = hideouts(8);
    for (let i = 0; i < all.length; i++) {
      const m = hideoutMission(all[i]);
      expect(Object.keys(m.thugs!).length).toBe(all[i].thugs.length);
      expect(m.steps).toHaveLength(1);
      if (i > 0) expect(all[i].reward).toBeGreaterThan(all[i - 1].reward);
    }
  });
});

describe("saves", () => {
  it("keep cleared hideouts, deduplicated, and drop junk", async () => {
    const { freshSave, parseSave } = await import("../src/game/save");
    const s = { ...freshSave(), hideouts: ["yards", "yards", 7, "brick"] };
    expect(parseSave(JSON.stringify(s))!.hideouts).toEqual(["yards", "brick"]);
    const old = { ...freshSave() } as Record<string, unknown>;
    delete old.hideouts;
    expect(parseSave(JSON.stringify(old))!.hideouts).toEqual([]);
  });
});
