import { describe, expect, it } from "vitest";
import { Rng } from "../src/core/rng";
import { generateCity, isOnRoad, resolveCircleVsBuildings, roadCoord, ROAD_WIDTH, PITCH } from "../src/world/city";

describe("city", () => {
  it("never places buildings on roads", () => {
    const city = generateCity(new Rng(7), 8);
    expect(city.buildings.length).toBeGreaterThan(50);
    for (const b of city.buildings) {
      for (const [cx, cz] of [[b.x - b.w / 2, b.z - b.d / 2], [b.x + b.w / 2, b.z - b.d / 2], [b.x - b.w / 2, b.z + b.d / 2], [b.x + b.w / 2, b.z + b.d / 2]]) {
        expect(isOnRoad(8, cx, cz)).toBe(false);
      }
    }
  });

  it("road coordinates are symmetric and spaced by pitch", () => {
    expect(roadCoord(8, 4)).toBe(0);
    expect(roadCoord(8, 5) - roadCoord(8, 4)).toBe(PITCH);
    expect(isOnRoad(8, 0, 0)).toBe(true);
    expect(isOnRoad(8, ROAD_WIDTH / 2 + 5, ROAD_WIDTH / 2 + 5)).toBe(false);
  });

  it("is deterministic per seed", () => {
    const a = generateCity(new Rng(3), 6);
    const b = generateCity(new Rng(3), 6);
    expect(a.buildings).toEqual(b.buildings);
  });

  it("pushes circles out of buildings", () => {
    const city = generateCity(new Rng(1), 4);
    const b = city.buildings[0];
    const push = resolveCircleVsBuildings(city, b.x + b.w / 2 - 0.5, b.z, 1);
    expect(push).not.toBeNull();
    expect(push!.x).toBeGreaterThan(0);
    expect(resolveCircleVsBuildings(city, 0, 0, 1)).toBeNull();
  });
});
