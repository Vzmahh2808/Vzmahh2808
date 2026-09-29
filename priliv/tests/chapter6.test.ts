import { describe, expect, it } from "vitest";
import { CAR_SPECS, collideCar, makeCar, stepCar } from "../src/entities/carPhysics";
import { gangDrive } from "../src/police/gangAI";
import { makeUnit } from "../src/police/policeAI";
import { MissionRunner, type MissionContext } from "../src/game/missions";
import { barOf, chapterSix, places, sevaOf, storyMissions } from "../src/game/story";
import { businesses } from "../src/game/business";
import { hideouts } from "../src/game/hideouts";
import { THUG_SIGHT } from "../src/police/thugAI";
import { WEAPONS } from "../src/game/weapons";
import { Rng } from "../src/core/rng";
import { generateCity, isOnCarriageway, resolveCircleVsBuildings } from "../src/world/city";
import { landAt } from "../src/world/island";

const city = generateCity(new Rng(20260924), 8);
const ctx = (over: Partial<MissionContext> = {}): MissionContext => ({ x: 0, z: 0, vehicle: null, stars: 0, destroyed: new Set(), ...over });
const DT = 1 / 60;

describe("chapter six", () => {
  const ch = chapterSix(8);
  const seva = sevaOf(8);

  it("follows chapter five, opens with a banner and is handed out by Seva", () => {
    const all = storyMissions(8);
    expect(all.length).toBe(30);
    expect(all[25].id).toBe("ch6-arms");
    expect(all[25].chapterTitle).toBe("Глава 6: Северные");
    expect(ch).toHaveLength(5);
    for (const m of ch) {
      expect(m.contact).toEqual(seva);
      expect(m.chapter).toBe(6);
    }
  });

  it("puts Seva on open road, clear of every other marker", () => {
    const P = places(8);
    const others = [P.garage, P.paint, P.contact, P.race, P.shop, P.depot, P.office, P.gunShop, barOf(8), ...businesses(8).map((b) => b.at), ...hideouts(8).map((h) => h.at)];
    for (const o of others) expect(Math.hypot(o.x - seva.x, o.z - seva.z)).toBeGreaterThan(15);
    expect(isOnCarriageway(8, seva.x, seva.z)).toBe(true);
    expect(resolveCircleVsBuildings(city, seva.x, seva.z, 1.5)).toBeNull();
  });

  it("stands every thug and car on open city ground", () => {
    for (const m of ch) {
      for (const [k, t] of Object.entries(m.thugs ?? {})) {
        expect(landAt(t.x, t.z, 400), `${m.id}.${k}`).toBe("city");
        expect(resolveCircleVsBuildings(city, t.x, t.z, 0.6), `${m.id}.${k} ${t.x},${t.z}`).toBeNull();
      }
      for (const [k, sp] of Object.entries(m.spawns ?? {})) {
        expect(isOnCarriageway(8, sp.x, sp.z), `${m.id}.${k}`).toBe(true);
        expect(resolveCircleVsBuildings(city, sp.x, sp.z, 1.5), `${m.id}.${k}`).toBeNull();
      }
    }
  });

  it("hands over a real gun, and guards wait out of sight of Seva's yard", () => {
    const arms = ch[0];
    expect(arms.gift && WEAPONS[arms.gift.weapon]).toBeTruthy();
    // The player starts at Seva, inside the mission area.
    expect(Math.hypot(seva.x - arms.area!.at.x, seva.z - arms.area!.at.z)).toBeLessThan(arms.area!.radius - 20);
    for (const m of [ch[0], ch[2], ch[4]]) {
      for (const t of Object.values(m.thugs ?? {})) {
        expect(t.alerted).toBeFalsy();
        expect(Math.hypot(t.x - seva.x, t.z - seva.z), m.id).toBeGreaterThan(THUG_SIGHT + 10);
      }
    }
    // The ambush comes for the player.
    for (const t of Object.values(ch[3].thugs!)) expect(t.alerted).toBe(true);
  });

  it("clears a convoy of cars like a crew on foot", () => {
    const r = new MissionRunner();
    r.start(ch[1]);
    r.update(ctx({ destroyed: new Set(["c1", "c3"]) }), DT);
    expect(r.gauge()?.label).toBe("Осталось 1 из 3");
    expect(r.update(ctx({ destroyed: new Set(["c1", "c2", "c3"]) }), DT).at(-1)).toMatchObject({ type: "done", reward: 3000 });
  });

  it("the witness van must survive, and only after the guards are down does it count", () => {
    const m = ch[2];
    expect(m.protect).toBe("van");
    const r = new MissionRunner();
    r.start(m);
    const keys = Object.keys(m.thugs!);
    r.update(ctx({ vehicle: "van" }), DT);
    expect(r.step).toBe(0);
    r.update(ctx({ destroyed: new Set(keys) }), DT);
    expect(r.step).toBe(1);
    expect(r.update(ctx({ destroyed: new Set([...keys, "van"]) }), DT)).toEqual([expect.objectContaining({ type: "fail", reason: "груз уничтожен" })]);
  });

  it("the finale has a tough boss, then brings the police", () => {
    const m = ch[4];
    expect(Math.max(...Object.values(m.thugs!).map((t) => t.hp ?? 60))).toBeGreaterThanOrEqual(200);
    const r = new MissionRunner();
    r.start(m);
    const ev = r.update(ctx({ destroyed: new Set(Object.keys(m.thugs!)) }), DT);
    expect(ev).toContainEqual({ type: "heat", stars: 3 });
    expect(r.currentStep?.kind).toBe("evade");
    // No area: fleeing the police must not fail the job.
    expect(m.area).toBeUndefined();
  });

  it("ambush hunters reach Seva's yard", () => {
    for (const [key, sp] of Object.entries(ch[3].spawns ?? {})) {
      const car = makeCar(sp.x, sp.z, sp.heading);
      const unit = makeUnit("pursuit");
      let reached = -1;
      for (let t = 0; t < 45 && reached < 0; t += DT) {
        stepCar(car, CAR_SPECS.sedan, gangDrive(car, unit, city, { ...seva, vx: 0, vz: 0 }, DT), DT);
        const push = resolveCircleVsBuildings(city, car.x, car.z, 1.8);
        if (push) collideCar(car, push.x, push.z);
        if (Math.hypot(car.x - seva.x, car.z - seva.z) < 6) reached = t;
      }
      expect(reached, key).toBeGreaterThan(0);
    }
  });
});
