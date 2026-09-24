import { describe, expect, it } from "vitest";
import { Rng } from "../src/core/rng";
import { BRIDGE, LIGHTHOUSE, generateIsland, landAt, onIslandRoad, clampWorld } from "../src/world/island";
import { generateCity, isOnCarriageway, resolveCircleVsBuildings } from "../src/world/city";

const LIMIT = 278;

describe("island geography", () => {
  it("classifies city, bridge, island and water", () => {
    expect(landAt(0, 0, LIMIT)).toBe("city");
    expect(landAt(320, 0, LIMIT)).toBe("bridge");
    expect(landAt(520, 50, LIMIT)).toBe("island");
    expect(landAt(660, 0, LIMIT)).toBe("island");
    expect(landAt(320, 40, LIMIT)).toBe("water");
    expect(landAt(700, 0, LIMIT)).toBe("water");
    expect(landAt(0, 400, LIMIT)).toBe("water");
  });

  it("the bridge starts on the city's east road and ends on island road", () => {
    const city = generateCity(new Rng(20260924), 8);
    expect(isOnCarriageway(8, BRIDGE.x0 + 1, 0)).toBe(true);
    expect(onIslandRoad(BRIDGE.x1 - 1, 0)).toBe(true);
    // Driving straight along the bridge never enters a collider.
    const island = generateIsland(new Rng(1));
    const all = { ...city, buildings: [...city.buildings, ...island.colliders] };
    for (let x = BRIDGE.x0; x <= 630; x += 2) expect(resolveCircleVsBuildings(all, x, 0, 1.8)).toBeNull();
  });

  it("keeps island roads clear of containers, warehouses and cranes", () => {
    const island = generateIsland(new Rng(7));
    const fake = { n: 8, half: 240, buildings: island.colliders, trees: [], lamps: [], intersections: [], parking: [] };
    for (let x = 406; x <= 634; x += 3) {
      for (const z of [-108, 0, 108]) expect(resolveCircleVsBuildings(fake, x, z, 1.5)).toBeNull();
    }
    for (let z = -108; z <= 108; z += 3) {
      for (const x of [412, 520, 628]) expect(resolveCircleVsBuildings(fake, x, z, 1.5)).toBeNull();
    }
    for (const p of island.parking) expect(resolveCircleVsBuildings(fake, p.x, p.z, 1.5)).toBeNull();
    expect(landAt(LIGHTHOUSE.x, LIGHTHOUSE.z, LIMIT)).toBe("island");
  });

  it("clamps to the world edges", () => {
    expect(clampWorld(5000, 0, LIMIT).x).toBeLessThan(800);
    expect(clampWorld(-5000, 5000, LIMIT)).toEqual({ x: -LIMIT, z: LIMIT });
  });
});

import { chapterTwo, storyMissions, ISLAND_SPOTS } from "../src/game/story";
import { isOnCarriageway as onCityRoad } from "../src/world/city";

describe("chapter two", () => {
  it("follows chapter one and puts every point on drivable road", () => {
    const all = storyMissions(8);
    expect(all.length).toBe(10);
    expect(all[5].id).toBe("ch2-bridge");
    const island = generateIsland(new Rng(20260924));
    const fake = { n: 8, half: 240, buildings: island.colliders, trees: [], lamps: [], intersections: [], parking: [] };
    const pts: Array<{ x: number; z: number }> = [...Object.values(ISLAND_SPOTS)];
    for (const m of chapterTwo(8)) {
      if (m.contact) pts.push(m.contact);
      for (const s of m.steps) {
        if (s.kind === "goto") pts.push(s.at);
        if (s.kind === "race") pts.push(...s.points);
      }
      for (const sp of Object.values(m.spawns ?? {})) pts.push(sp);
    }
    for (const p of pts) {
      const onRoad = onIslandRoad(p.x, p.z) || onCityRoad(8, p.x, p.z);
      expect(onRoad).toBe(true);
      expect(resolveCircleVsBuildings(fake, p.x, p.z, 1.5)).toBeNull();
    }
  });
});
