import { describe, expect, it } from "vitest";
import { BOAT_SPECS, hullPoints, keepOnWater, makeBoat, stepBoat } from "../src/entities/boatPhysics";
import { MissionRunner, type MissionContext } from "../src/game/missions";
import { MARTA, SEA, chapterFour, storyMissions } from "../src/game/story";
import { MARINA, SMUGGLER_ROUTE, clearWater, followRoute, isBoatWater, routeOnWater } from "../src/world/water";
import { landAt } from "../src/world/island";

const LIMIT = 278;
const water = (x: number, z: number) => isBoatWater(x, z, LIMIT);
const ctx = (over: Partial<MissionContext> = {}): MissionContext => ({ x: 0, z: 0, vehicle: null, stars: 0, destroyed: new Set(), ...over });

describe("chapter four", () => {
  it("follows chapter three and starts on the marina pier", () => {
    const all = storyMissions(8);
    expect(all.length).toBe(20);
    expect(all[15].id).toBe("ch4-cargo");
    expect(all[15].chapterTitle).toBe("Глава 4: Открытая вода");
    expect(landAt(MARTA.x, MARTA.z, LIMIT)).toBe("pier");
    for (const m of chapterFour()) expect(m.contact).toEqual(MARTA);
  });

  it("puts every water point and boat on open water", () => {
    const pts = [SEA.lighthouse, SEA.southBuoy, SEA.pierTip, ...SEA.crates];
    // Missions that end at the marina must not end on the regatta marker.
    expect(Math.hypot(SEA.pierTip.x - MARINA.x, SEA.pierTip.z - MARINA.z)).toBeGreaterThan(8 + 10);
    for (const p of pts) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) expect(water(p.x + Math.cos(a) * 8, p.z + Math.sin(a) * 8), `${p.x},${p.z}`).toBe(true);
    }
    for (const m of chapterFour()) {
      for (const [key, b] of Object.entries(m.boats ?? {})) {
        const s = makeBoat(b.x, b.z, b.heading);
        for (const p of hullPoints(s, BOAT_SPECS[b.kind])) expect(water(p.x, p.z), `${m.id}.${key}`).toBe(true);
        expect(m.steps.some((st) => "target" in st && st.target === key)).toBe(true);
      }
    }
  });

  it("the cargo boat can be boarded from the end of the marina pier", () => {
    const cargo = chapterFour()[0].boats!.cargo;
    const pierTip = { x: 295.5, z: -154 };
    expect(landAt(pierTip.x, pierTip.z, LIMIT)).toBe("pier");
    expect(Math.hypot(cargo.x - pierTip.x, cargo.z - pierTip.z)).toBeLessThan(5.5);
  });

  it("the smuggler route is sailable leg by leg, round the island", () => {
    for (let i = 0; i < SMUGGLER_ROUTE.length; i++) {
      const a = SMUGGLER_ROUTE[i];
      const b = SMUGGLER_ROUTE[(i + 1) % SMUGGLER_ROUTE.length];
      const reachable = clearWater(a, b, water, 1.5) || routeOnWater(a, b, water) !== b;
      expect(reachable, `${a.x},${a.z} → ${b.x},${b.z}`).toBe(true);
    }
  });

  it("a fleeing boat keeps sailing its route without getting stuck", () => {
    const start = SMUGGLER_ROUTE[8];
    const s = makeBoat(start.x, start.z, 0);
    const f = { index: 9, aim: start, aimTimer: 0 };
    const dt = 1 / 60;
    let passed = 0;
    let last = f.index;
    for (let t = 0; t < 240; t += dt) {
      const px = s.x, pz = s.z, ph = s.heading;
      stepBoat(s, BOAT_SPECS.motorboat, followRoute(s, SMUGGLER_ROUTE, f, 0.9, water, dt), dt);
      keepOnWater(s, BOAT_SPECS.motorboat, px, pz, ph, water);
      if (f.index !== last) {
        passed++;
        last = f.index;
      }
    }
    expect(passed).toBeGreaterThanOrEqual(12);
  });

  it("boat steps: board the mission boat, then deliver it", () => {
    const cargo = chapterFour()[0];
    const r = new MissionRunner();
    r.start(cargo);
    expect(r.update(ctx({ vehicle: "boat" }), 1)).toEqual([]);
    const ev = r.update(ctx({ vehicle: "cargo" }), 1);
    expect(ev).toContainEqual({ type: "heat", stars: 2 });
    expect(r.update(ctx({ ...SEA.lighthouse, vehicle: "boat" }), 1)).toEqual([]);
    expect(r.update(ctx({ ...SEA.lighthouse, vehicle: "cargo" }), 1).at(-1)).toMatchObject({ type: "step", index: 2 });
    // A sunk cargo boat fails the mission.
    const r2 = new MissionRunner();
    r2.start(cargo);
    expect(r2.update(ctx({ destroyed: new Set(["cargo"]) }), 1)[0]).toMatchObject({ type: "fail" });
  });
});
