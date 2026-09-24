import { describe, expect, it } from "vitest";
import { RAID_DEADLINE, RAID_EVERY, businesses, buyBusiness, collect, freshHoldings, hourlyIncome, raidMission, stateOf, tick } from "../src/game/business";
import { places } from "../src/game/story";
import { Rng } from "../src/core/rng";
import { generateCity, isOnCarriageway, resolveCircleVsBuildings } from "../src/world/city";
import { generateIsland, landAt, onIslandRoad } from "../src/world/island";

const all = businesses(8);
const byId = (id: string) => all.find((b) => b.id === id)!;

describe("buying and takings", () => {
  it("buys once, fills the till up to its cap and pays out on collection", () => {
    const h = freshHoldings();
    h.nextRaid = 1000;
    const cafe = byId("cafe");
    expect(buyBusiness(h, cafe, 4000)).toBeNull();
    expect(buyBusiness(h, cafe, 6000)).toBe(1000);
    expect(buyBusiness(h, cafe, 6000)).toBeNull();
    tick(h, all, 2.5, new Rng(1));
    expect(collect(h, cafe)).toBe(250);
    expect(collect(h, cafe)).toBe(0);
    tick(h, all, 7, new Rng(1));
    expect(stateOf(h, "cafe").stored).toBe(700);
    tick(h, all, 7, new Rng(1));
    expect(stateOf(h, "cafe").stored).toBe(cafe.cap);
    // Unowned businesses earn nothing.
    expect(collect(h, byId("carwash"))).toBe(0);
    expect(hourlyIncome(h, all)).toBe(cafe.income);
  });

  it("puts a shakedown on an owned business every few hours; ignoring it loses the till", () => {
    const h = freshHoldings();
    const wash = byId("carwash");
    buyBusiness(h, wash, 99999);
    // Nothing happens before the interval, and nothing at all without property.
    expect(tick(freshHoldings(), all, RAID_EVERY * 3, new Rng(3))).toEqual([]);
    expect(tick(h, all, RAID_EVERY - 1, new Rng(3))).toEqual([]);
    expect(tick(h, all, 1, new Rng(3))).toEqual([{ type: "raid", id: "carwash" }]);
    const till = stateOf(h, "carwash").stored;
    // The till stops filling and cannot be emptied during the shakedown.
    tick(h, all, 1, new Rng(3));
    expect(stateOf(h, "carwash").stored).toBe(till);
    expect(collect(h, wash)).toBe(0);
    const ev = tick(h, all, RAID_DEADLINE, new Rng(3));
    expect(ev).toContainEqual({ type: "robbed", id: "carwash", lost: Math.floor(till) });
    expect(stateOf(h, "carwash")).toMatchObject({ stored: 0, raid: 0 });
  });

  it("never raids the same business twice at once", () => {
    const h = freshHoldings();
    buyBusiness(h, byId("cafe"), 99999);
    tick(h, all, RAID_EVERY, new Rng(9));
    expect(stateOf(h, "cafe").raid).toBe(RAID_DEADLINE);
    // Deadline longer than the interval would not re-raid a raided business.
    stateOf(h, "cafe").raid = 100;
    expect(tick(h, all, RAID_EVERY, new Rng(9)).filter((e) => e.type === "raid")).toEqual([]);
  });
});

describe("business places", () => {
  const city = generateCity(new Rng(20260924), 8);
  const island = generateIsland(new Rng(20260924));
  const world = { ...city, buildings: [...city.buildings, ...island.colliders] };
  const P = places(8);
  const taken = [P.garage, P.paint, P.contact, P.race, P.shop, P.depot, P.office];

  it("stand on open land away from every other marker", () => {
    for (const b of all) {
      expect(landAt(b.at.x, b.at.z, 278), b.id).not.toBe("water");
      expect(resolveCircleVsBuildings(world, b.at.x, b.at.z, 1.5), b.id).toBeNull();
      for (const p of [...taken, ...all.filter((o) => o !== b).map((o) => o.at)]) expect(Math.hypot(p.x - b.at.x, p.z - b.at.z), b.id).toBeGreaterThan(15);
    }
  });

  it("gang cars start on the road near their business", () => {
    for (const b of all) {
      const m = raidMission(b);
      for (const sp of Object.values(m.spawns!)) {
        expect(isOnCarriageway(8, sp.x, sp.z) || onIslandRoad(sp.x, sp.z), `${b.id} ${sp.x},${sp.z}`).toBe(true);
        expect(resolveCircleVsBuildings(world, sp.x, sp.z, 1.5)).toBeNull();
        expect(Math.hypot(sp.x - b.at.x, sp.z - b.at.z)).toBeLessThan(120);
      }
      expect(m.steps.map((s) => s.kind)).toEqual(["destroy", "destroy"]);
    }
  });
});

import { freshSave, parseSave } from "../src/game/save";

describe("saving businesses", () => {
  it("round-trips holdings and repairs junk", () => {
    const s = freshSave();
    buyBusiness(s.business, byId("cafe"), 99999);
    stateOf(s.business, "cafe").stored = 321.5;
    stateOf(s.business, "cafe").raid = 2;
    s.business.nextRaid = 3;
    expect(parseSave(JSON.stringify(s))!.business).toEqual(s.business);
    const junk = parseSave(JSON.stringify({ version: 1, business: { list: { cafe: { owned: "yes", stored: -5 }, bad: 7 }, nextRaid: 999 } }))!;
    expect(junk.business).toEqual({ list: { cafe: { owned: false, stored: 0, raid: 0 } }, nextRaid: 8 });
    // Old saves without businesses start with none.
    expect(parseSave(JSON.stringify({ version: 1 }))!.business).toEqual(freshHoldings());
  });
});
