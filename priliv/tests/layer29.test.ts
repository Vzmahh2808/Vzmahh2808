import { describe, expect, it } from "vitest";
import { Rng } from "../src/core/rng";
import { generateCity, resolveCircleVsBuildings, resolveCircleVsPosts, type CityLayout } from "../src/world/city";
import { CITY_SOUTH_SHORE, RESORT, RESORT_PIERS, RESORT_ROADS, SOUTH_BRIDGE, clampWorld, inRect, landAt } from "../src/world/island";
import { RESORT_PLACES, buildResortWalk, generateResort, mergeWalkGraph, resortBlocks } from "../src/world/resort";
import { allStrips, resortStrip, southStrip, stripColliders, stripSpans } from "../src/world/embankment";
import { buildWalkGraph } from "../src/world/sidewalks";
import { isBoatWater } from "../src/world/water";

const LIMIT = 278;

function world(seed = 5) {
  const city = generateCity(new Rng(seed), 8);
  const resort = generateResort(new Rng(seed ^ 0x2e5));
  const layout: CityLayout = { ...city, buildings: [...city.buildings, ...resort.colliders], posts: [...city.posts, ...resort.posts] };
  return { city, resort, layout };
}

describe("resort geography", () => {
  it("joins the city over the south bridge and keeps the sea in between", () => {
    expect(landAt(0, 200, LIMIT)).toBe("city");
    expect(landAt(0, 265, LIMIT)).toBe("bridge");
    expect(landAt(0, 340, LIMIT)).toBe("bridge");
    expect(landAt(0, 422, LIMIT)).toBe("bridge");
    expect(landAt(0, 430, LIMIT)).toBe("island");
    expect(landAt(60, 340, LIMIT)).toBe("water");
    expect(landAt(60, CITY_SOUTH_SHORE + 5, LIMIT)).toBe("water");
    expect(landAt(0, RESORT.z1 + 20, LIMIT)).toBe("water");
    for (const p of RESORT_PIERS) expect(landAt((p.x0 + p.x1) / 2, p.z1 - 4, LIMIT)).toBe("pier");
  });

  it("the bridge starts on the city's outer road and ends on the resort boulevard", () => {
    expect(SOUTH_BRIDGE.z0).toBeLessThan(CITY_SOUTH_SHORE);
    expect(inRect(RESORT_ROADS[0], 0, SOUTH_BRIDGE.z1 - 1)).toBe(true);
    expect(SOUTH_BRIDGE.z1).toBeGreaterThan(RESORT.z0);
  });

  it("lets boats sail the southern sea but not through the island", () => {
    expect(isBoatWater(120, 350, LIMIT)).toBe(true);
    expect(isBoatWater(0, 500, LIMIT)).toBe(false);
    expect(isBoatWater(30, 300, LIMIT)).toBe(true);
    expect(isBoatWater(0, 300, LIMIT)).toBe(false); // under the bridge
    expect(isBoatWater(60, RESORT.z1 + 30, LIMIT)).toBe(true);
    expect(clampWorld(0, 5000, LIMIT).z).toBe(RESORT.z1 + 70);
  });
});

describe("resort streets", () => {
  it("keeps every road, the bridge and the promenade gaps free of solids", () => {
    const { layout } = world();
    for (const r of RESORT_ROADS) {
      const alongX = r.x1 - r.x0 > r.z1 - r.z0;
      const cx = (r.x0 + r.x1) / 2;
      const cz = (r.z0 + r.z1) / 2;
      const from = alongX ? r.x0 + 4 : r.z0 + 4;
      const to = alongX ? r.x1 - 4 : r.z1 - 4;
      for (let t = from; t <= to; t += 2) {
        const x = alongX ? t : cx;
        const z = alongX ? cz : t;
        expect(resolveCircleVsBuildings(layout, x, z, 1.8), `road ${x},${z}`).toBeNull();
        expect(resolveCircleVsPosts(layout, x, z, 1.8), `posts ${x},${z}`).toBeNull();
      }
    }
    // Straight down the bridge and the boulevard.
    for (let z = SOUTH_BRIDGE.z0 - 30; z <= 640; z += 2) {
      expect(resolveCircleVsBuildings(layout, 0, z, 1.8), `x=0 z=${z}`).toBeNull();
    }
  });

  it("parks cars on open kerb", () => {
    const { layout, resort } = world();
    expect(resort.parking.length).toBeGreaterThan(8);
    for (const p of resort.parking) {
      expect(resolveCircleVsBuildings(layout, p.x, p.z, 1.6), `${p.x},${p.z}`).toBeNull();
      expect(resolveCircleVsPosts(layout, p.x, p.z, 1.6)).toBeNull();
      expect(landAt(p.x, p.z, LIMIT)).toBe("island");
    }
  });

  it("puts palms and lamps on the island, off the carriageways", () => {
    const { resort } = world();
    expect(resort.palms.length).toBeGreaterThan(40);
    expect(resort.lamps.length).toBeGreaterThan(15);
    for (const p of [...resort.palms, ...resort.lamps]) {
      expect(inRect(RESORT, p.x, p.z), `${p.x},${p.z}`).toBe(true);
      for (const r of RESORT_ROADS) expect(inRect(r, p.x, p.z, 0.2), `${p.x},${p.z} in road`).toBe(false);
    }
  });

  it("builds hotels, villas, boutiques and a plaza with a fountain", () => {
    const { resort } = world();
    const styles = new Set(resortBlocks().map((b) => b.style));
    expect([...styles].sort()).toEqual(["boutiques", "hotels", "plaza", "villas"]);
    const towers = resort.colliders.filter((c) => c.kind === "tower");
    expect(towers.length).toBeGreaterThanOrEqual(4);
    expect(Math.max(...towers.map((t) => t.h))).toBeGreaterThan(24);
    expect(resort.colliders.filter((c) => c.kind === "house").length).toBeGreaterThanOrEqual(8);
    expect(resort.colliders.filter((c) => c.kind === "shop").length).toBeGreaterThanOrEqual(5);
    expect(resort.fountain.r).toBeGreaterThan(5);
    // Every building sits on the island and none blocks a road.
    for (const c of resort.colliders.filter((b) => b.kind === "tower" || b.kind === "house" || b.kind === "shop")) {
      expect(c.x - c.w / 2).toBeGreaterThan(RESORT.x0);
      expect(c.x + c.w / 2).toBeLessThan(RESORT.x1);
      expect(c.z - c.d / 2).toBeGreaterThan(RESORT.z0);
      expect(c.z + c.d / 2).toBeLessThan(RESORT.z1);
    }
  });

  it("has a clear hotel doorstep on the boulevard", () => {
    const { layout } = world();
    const h = RESORT_PLACES.hotel;
    for (let a = 0; a < 16; a++) {
      const x = h.x + Math.cos((a / 16) * Math.PI * 2) * 5;
      const z = h.z + Math.sin((a / 16) * Math.PI * 2) * 5;
      expect(resolveCircleVsBuildings(layout, x, z, 0.45)).toBeNull();
      expect(resolveCircleVsPosts(layout, x, z, 0.45)).toBeNull();
    }
    expect(inRect(RESORT_ROADS[0], h.x, h.z)).toBe(true);
  });
});

describe("waterfronts", () => {
  it("rails the resort seafront and the city's south shore, with openings for the bridge and the piers", () => {
    const rs = resortStrip();
    const rails = stripColliders(rs);
    const covered = (x: number) => rails.some((r) => Math.abs(x - r.x) <= r.w / 2);
    for (let x = RESORT.x0 + 1; x < RESORT.x1; x += 1) {
      // Edges of an opening are ambiguous by a hair; test clear of them.
      if (RESORT_PIERS.some((p) => Math.abs(x - (p.x0 - 4)) < 0.6 || Math.abs(x - (p.x1 + 4)) < 0.6)) continue;
      const inGap = RESORT_PIERS.some((p) => x >= p.x0 - 4 && x <= p.x1 + 4);
      expect(covered(x), `x=${x}`).toBe(!inGap);
    }
    const ss = southStrip(LIMIT);
    const rails2 = stripColliders(ss);
    const covered2 = (x: number) => rails2.some((r) => Math.abs(x - r.x) <= r.w / 2);
    expect(covered2(-100)).toBe(true);
    expect(covered2(100)).toBe(true);
    expect(covered2(0)).toBe(false);
    expect(stripSpans(ss).length).toBe(2);
    expect(allStrips(LIMIT).length).toBe(6);
    // The island edges are fenced too, except where the bridge lands.
    const { layout } = world();
    expect(resolveCircleVsBuildings(layout, RESORT.x0 + 1.4, 560, 0.45)).not.toBeNull();
    expect(resolveCircleVsBuildings(layout, RESORT.x1 - 1.4, 560, 0.45)).not.toBeNull();
    expect(resolveCircleVsBuildings(layout, 60, RESORT.z0 + 1.4, 0.45)).not.toBeNull();
    expect(resolveCircleVsBuildings(layout, 0, RESORT.z0 + 1.4, 0.45)).toBeNull();
  });

  it("stops a car and a walker at the south quay, but lets them onto the pier and the bridge", () => {
    const { layout } = world();
    // A car doing 30 m/s straight south at x=100 is stopped by the railing.
    let z = 240;
    for (let i = 0; i < 120; i++) {
      z += 30 / 60;
      const push = resolveCircleVsBuildings(layout, 100, z, 1.9);
      if (push) z += push.z;
    }
    expect(z).toBeLessThan(CITY_SOUTH_SHORE);
    // ...and on foot at the promenade rail of the resort.
    const p = RESORT_PIERS[0];
    const pierX = (p.x0 + p.x1) / 2;
    for (let zz = RESORT.z1 - 8; zz < p.z1 - 2; zz += 1) expect(resolveCircleVsBuildings(layout, pierX, zz, 0.45), `pier z=${zz}`).toBeNull();
    expect(resolveCircleVsBuildings(layout, 40, RESORT.z1 - 1.4, 0.45)).not.toBeNull();
    // The bridge is open along its whole length in the middle.
    for (let zz = 250; zz <= 440; zz += 2) expect(resolveCircleVsBuildings(layout, 0, zz, 1.8)).toBeNull();
    // ...but its sides are railed.
    expect(resolveCircleVsBuildings(layout, SOUTH_BRIDGE.x1 + 0.4, 340, 0.45)).not.toBeNull();
  });
});

describe("resort walkways", () => {
  it("is a connected network of open pavement", () => {
    const { layout } = world();
    const g = buildResortWalk();
    expect(g.nodes.length).toBeGreaterThan(20);
    g.nodes.forEach((n, i) => {
      expect(resolveCircleVsBuildings(layout, n.x, n.z, 0.5), `node ${i} ${n.x},${n.z}`).toBeNull();
      expect(landAt(n.x, n.z, LIMIT)).toBe("island");
      for (const j of g.edges[i]) expect(g.edges[j]).toContain(i);
    });
    // One component.
    const seen = new Set<number>([0]);
    const stack = [0];
    while (stack.length) for (const j of g.edges[stack.pop()!]) if (!seen.has(j)) (seen.add(j), stack.push(j));
    expect(seen.size).toBe(g.nodes.length);
    // Walking lines stay off the buildings along their whole length.
    g.nodes.forEach((a, i) => {
      for (const j of g.edges[i]) {
        const b = g.nodes[j];
        for (let t = 0; t <= 1; t += 0.1) expect(resolveCircleVsBuildings(layout, a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, 0.4), `edge ${i}-${j}`).toBeNull();
      }
    });
  });

  it("merges into the city's graph without breaking it", () => {
    const city = generateCity(new Rng(5), 8);
    const g = buildWalkGraph(city);
    const n0 = g.nodes.length;
    const extra = buildResortWalk();
    const offset = mergeWalkGraph(g, extra);
    expect(offset).toBe(n0);
    expect(g.nodes.length).toBe(n0 + extra.nodes.length);
    expect(g.edges.length).toBe(g.nodes.length);
    for (let i = 0; i < g.nodes.length; i++) for (const j of g.edges[i]) expect(g.edges[j]).toContain(i);
    // City nodes keep their neighbours.
    for (let i = 0; i < n0; i++) for (const j of g.edges[i]) expect(j).toBeLessThan(n0);
  });
});

describe("resort traffic", () => {
  it("runs each circuit on the right, on road, and cars keep moving without hitting anything", async () => {
    const { RESORT_LOOPS } = await import("../src/world/resort");
    const { spawnLoopCar, driveTraffic } = await import("../src/entities/traffic");
    const { CAR_SPECS, collideCar, speedOf, stepCar } = await import("../src/entities/carPhysics");
    const { layout } = world();
    // Waypoints lie on the carriageways.
    for (const loop of RESORT_LOOPS) for (const p of loop) expect(RESORT_ROADS.some((r) => inRect(r, p.x, p.z)), `${p.x},${p.z}`).toBe(true);
    const rng = new Rng(4);
    const cars = RESORT_LOOPS.flatMap((loop) => [0, 1, 2, 3].map((i) => spawnLoopCar(rng, loop, i / 4, ["sedan", "suv", "bus", "taxi"], [0xffffff])));
    let distance = 0;
    let offRoad = 0;
    let samples = 0;
    let crashes = 0;
    for (let step = 0; step < 60 * 90; step++) {
      for (const c of cars) {
        const obstacles = cars.filter((o) => o !== c).map((o) => ({ x: o.state.x, z: o.state.z, r: CAR_SPECS[o.kind].length * 0.42, vx: o.state.vx, vz: o.state.vz }));
        driveTraffic(c, layout, rng, obstacles, 1 / 60, step / 60, CAR_SPECS[c.kind].length / 2);
        stepCar(c.state, CAR_SPECS[c.kind], c.input, 1 / 60);
        const push = resolveCircleVsBuildings(layout, c.state.x, c.state.z, CAR_SPECS[c.kind].length * 0.42);
        if (push) {
          crashes++;
          collideCar(c.state, push.x, push.z);
        }
        distance += speedOf(c.state) / 60;
      }
      if (step % 30 === 0) for (const c of cars) (samples++, RESORT_ROADS.some((r) => inRect(r, c.state.x, c.state.z, 1)) || offRoad++);
    }
    expect(distance / cars.length).toBeGreaterThan(300);
    expect(offRoad / samples).toBeLessThan(0.05);
    expect(crashes).toBe(0);
  });
});

describe("police on the resort", () => {
  it("chasers take the bridge to reach a target on the resort, from anywhere in the city", async () => {
    const { policeDrive, makeUnit, mustCrossBridge } = await import("../src/police/policeAI");
    const { CAR_SPECS, collideCar, makeCar, stepCar } = await import("../src/entities/carPhysics");
    const { layout } = world();
    const target = { x: 60, z: 540, vx: 0, vz: 0 };
    for (const [sx, sz] of [[0, 180], [9, 205], [-9, 215], [150, 0], [-180, -120], [120, 240]] as const) {
      const car = makeCar(sx, sz, Math.PI / 2);
      const unit = makeUnit("pursuit");
      expect(mustCrossBridge(car, target)).toBe(true);
      let reached = -1;
      for (let step = 0; step < 60 * 140; step++) {
        const input = policeDrive(car, unit, layout, target, 1 / 60);
        stepCar(car, CAR_SPECS.police, input, 1 / 60);
        const push = resolveCircleVsBuildings(layout, car.x, car.z, 1.9);
        if (push) collideCar(car, push.x, push.z);
        if (car.z > RESORT.z0 + 20) {
          reached = step / 60;
          break;
        }
      }
      expect(reached, `from ${sx},${sz}`).toBeGreaterThan(0);
    }
    // Once over the bridge it is an ordinary chase.
    expect(mustCrossBridge({ z: RESORT.z0 + 30 }, target)).toBe(false);
    expect(mustCrossBridge({ z: 100 }, { z: 100 })).toBe(false);
  });
});

describe("police on the resort streets", () => {
  it("finds the target anywhere on the resort by its own street grid", async () => {
    const { policeDrive, makeUnit } = await import("../src/police/policeAI");
    const { CAR_SPECS, collideCar, makeCar, stepCar } = await import("../src/entities/carPhysics");
    const { layout } = world();
    for (const [tx, tz] of [[168, 610], [-168, 540], [60, 490], [-100, 650]] as const) {
      const target = { x: tx, z: tz, vx: 0, vz: 0 };
      const car = makeCar(0, 440, Math.PI / 2);
      const unit = makeUnit("pursuit");
      let close = -1;
      for (let step = 0; step < 60 * 90; step++) {
        const input = policeDrive(car, unit, layout, target, 1 / 60);
        stepCar(car, CAR_SPECS.police, input, 1 / 60);
        const push = resolveCircleVsBuildings(layout, car.x, car.z, 1.9);
        if (push) collideCar(car, push.x, push.z);
        if (Math.hypot(car.x - tx, car.z - tz) < 12) {
          close = step / 60;
          break;
        }
      }
      expect(close, `to ${tx},${tz}`).toBeGreaterThan(0);
    }
  });
});
