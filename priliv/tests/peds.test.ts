import { describe, expect, it } from "vitest";
import { Rng } from "../src/core/rng";
import { generateCity, resolveCircleVsBuildings } from "../src/world/city";
import { buildWalkGraph } from "../src/world/sidewalks";
import { knockPed, spawnPeds, stepPed } from "../src/entities/peds";

describe("walk graph", () => {
  it("is connected and keeps every node clear of buildings", () => {
    const city = generateCity(new Rng(5), 6);
    const g = buildWalkGraph(city);
    expect(g.nodes.length).toBe(6 * 6 * 4);
    for (const n of g.nodes) expect(resolveCircleVsBuildings(city, n.x, n.z, 0.3)).toBeNull();
    const seen = new Set([0]);
    const queue = [0];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const nb of g.edges[cur]) if (!seen.has(nb)) {
        seen.add(nb);
        queue.push(nb);
      }
    }
    expect(seen.size).toBe(g.nodes.length);
  });
});

describe("pedestrians", () => {
  const city = generateCity(new Rng(9), 6);
  const g = buildWalkGraph(city);
  const collide = (x: number, z: number) => resolveCircleVsBuildings(city, x, z, 0.35);

  it("walk the network for a minute without entering buildings", () => {
    const rng = new Rng(1);
    const peds = spawnPeds(rng, g, 30);
    const start = peds.map((p) => ({ x: p.x, z: p.z }));
    for (let i = 0; i < 60 * 60; i++) for (const p of peds) stepPed(p, g, rng, 1 / 60, [], collide);
    let moved = 0;
    peds.forEach((p, i) => {
      expect(resolveCircleVsBuildings(city, p.x, p.z, 0.2)).toBeNull();
      if (Math.hypot(p.x - start[i].x, p.z - start[i].z) > 10) moved++;
    });
    expect(moved).toBeGreaterThan(20);
  });

  it("flee from a threat and calm down afterwards", () => {
    const rng = new Rng(2);
    const [p] = spawnPeds(rng, g, 1);
    const threat = { x: p.x + 2, z: p.z, radius: 10 };
    const d0 = Math.hypot(p.x - threat.x, p.z - threat.z);
    stepPed(p, g, rng, 1 / 60, [threat], collide);
    expect(p.state).toBe("flee");
    for (let i = 0; i < 60; i++) stepPed(p, g, rng, 1 / 60, [], collide);
    expect(Math.hypot(p.x - threat.x, p.z - threat.z)).toBeGreaterThan(d0 + 2);
    for (let i = 0; i < 60 * 8; i++) stepPed(p, g, rng, 1 / 60, [], collide);
    expect(p.state).toBe("walk");
  });

  it("get knocked down by cars, land, and eventually disappear", () => {
    const rng = new Rng(3);
    const [p] = spawnPeds(rng, g, 1);
    knockPed(p, 15, 0);
    expect(p.state).toBe("down");
    stepPed(p, g, rng, 0.05, [], collide);
    expect(p.y).toBeGreaterThan(0);
    for (let i = 0; i < 60 * 10; i++) stepPed(p, g, rng, 1 / 60, [], collide);
    expect(p.y).toBe(0);
    expect(p.fall).toBe(1);
    expect(p.state).toBe("gone");
  });
});
