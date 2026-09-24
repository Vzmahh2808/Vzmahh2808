import { describe, expect, it } from "vitest";
import { BOAT_SPECS, boatImpactDamage, boatSpeed, chaseBoat, hullPoints, keepOnWater, makeBoat, separateBoats, stepBoat } from "../src/entities/boatPhysics";
import { DOCKS, MARINA, POLICE_BOAT_SPAWNS, REGATTA, WATER_NODES, clearWater, isBoatWater, routeOnWater } from "../src/world/water";
import { BRIDGE, PIERS, landAt } from "../src/world/island";
import { regattaMission } from "../src/game/story";

const LIMIT = 278;
const water = (x: number, z: number) => isBoatWater(x, z, LIMIT);
const DT = 1 / 60;

/** Step a boat with shore collisions for a number of seconds. */
function run(s: ReturnType<typeof makeBoat>, kind: string, seconds: number, input: (t: number) => { throttle: number; steer: number }) {
  const spec = BOAT_SPECS[kind];
  let hits = 0;
  for (let t = 0; t < seconds; t += DT) {
    const px = s.x, pz = s.z, ph = s.heading;
    stepBoat(s, spec, input(t), DT);
    if (keepOnWater(s, spec, px, pz, ph, water) > 0) hits++;
  }
  return hits;
}

describe("boat handling", () => {
  it("accelerates to its top speed and no further", () => {
    for (const kind of Object.keys(BOAT_SPECS)) {
      const s = makeBoat(0, 0, 0);
      for (let i = 0; i < 60 * 30; i++) stepBoat(s, BOAT_SPECS[kind], { throttle: 1, steer: 0 }, DT);
      expect(boatSpeed(s)).toBeGreaterThan(BOAT_SPECS[kind].maxSpeed * 0.8);
      expect(boatSpeed(s)).toBeLessThanOrEqual(BOAT_SPECS[kind].maxSpeed);
    }
  });

  it("steers only while moving, and drifts in a turn", () => {
    const still = makeBoat(0, 0, 0);
    for (let i = 0; i < 120; i++) stepBoat(still, BOAT_SPECS.motorboat, { throttle: 0, steer: 1 }, DT);
    expect(still.heading).toBe(0);
    const s = makeBoat(0, 0, 0);
    for (let i = 0; i < 300; i++) stepBoat(s, BOAT_SPECS.speedboat, { throttle: 1, steer: 0 }, DT);
    let maxSlip = 0;
    for (let i = 0; i < 120; i++) {
      stepBoat(s, BOAT_SPECS.speedboat, { throttle: 1, steer: 1 }, DT);
      const lat = Math.abs(s.vx * -Math.sin(s.heading) + s.vz * Math.cos(s.heading));
      maxSlip = Math.max(maxSlip, lat);
    }
    expect(s.heading).toBeGreaterThan(1);
    expect(maxSlip).toBeGreaterThan(0.5);
  });

  it("coasts to a stop without throttle", () => {
    const s = makeBoat(0, 0, 0);
    s.vx = 20;
    for (let i = 0; i < 60 * 20; i++) stepBoat(s, BOAT_SPECS.motorboat, { throttle: 0, steer: 0 }, DT);
    expect(boatSpeed(s)).toBeLessThan(1);
  });

  it("bounces off the shore instead of beaching", () => {
    // Full throttle west from the channel straight at the city.
    const s = makeBoat(320, -60, Math.PI);
    const hits = run(s, "speedboat", 20, () => ({ throttle: 1, steer: 0 }));
    expect(hits).toBeGreaterThan(0);
    for (const p of hullPoints(s, BOAT_SPECS.speedboat)) expect(water(p.x, p.z)).toBe(true);
    expect(boatImpactDamage(2)).toBe(0);
    expect(boatImpactDamage(20)).toBeGreaterThan(20);
  });

  it("cannot pass under the bridge", () => {
    const s = makeBoat(330, -30, Math.PI / 2);
    run(s, "motorboat", 15, () => ({ throttle: 1, steer: 0 }));
    expect(s.z).toBeLessThan(BRIDGE.z0);
  });

  it("boats push each other apart", () => {
    const a = makeBoat(0, 0, 0);
    const b = makeBoat(2, 0, 0);
    a.vx = 10;
    expect(separateBoats(a, b, 2.5, 2.5)).toBeGreaterThan(0);
    expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeCloseTo(5);
    expect(b.vx).toBeGreaterThan(0);
  });
});

describe("water world", () => {
  it("treats piers as land and keeps moored boats afloat beside them", () => {
    for (const p of PIERS) expect(landAt((p.x0 + p.x1) / 2, (p.z0 + p.z1) / 2, LIMIT)).toBe("pier");
    for (const d of DOCKS) {
      const s = makeBoat(d.x, d.z, d.heading);
      for (const p of hullPoints(s, BOAT_SPECS[d.kind])) expect(water(p.x, p.z)).toBe(true);
      // Close enough to step aboard from a pier.
      const gap = Math.min(...PIERS.map((p) => Math.hypot(Math.max(p.x0 - d.x, 0, d.x - p.x1), Math.max(p.z0 - d.z, 0, d.z - p.z1))));
      expect(gap).toBeLessThan(4.5);
    }
  });

  it("puts every buoy and spawn on open water with room to spare", () => {
    const pts = [MARINA, ...REGATTA, ...POLICE_BOAT_SPAWNS];
    for (const p of pts) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) expect(water(p.x + Math.cos(a) * 8, p.z + Math.sin(a) * 8)).toBe(true);
    }
    expect(regattaMission().steps[0]).toMatchObject({ kind: "race", points: REGATTA });
  });

  it("the regatta can be sailed buoy to buoy without touching land", () => {
    // A simple autopilot aims at each buoy in turn; the straight legs must stay on water.
    const pts = [MARINA, ...REGATTA];
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      for (let t = 0; t <= 1; t += 0.02) expect(water(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)).toBe(true);
    }
  });

  it("links every waterway node into one network", () => {
    for (const p of WATER_NODES) expect(water(p.x, p.z)).toBe(true);
    const seen = new Set([0]);
    const stack = [0];
    while (stack.length) {
      const u = stack.pop()!;
      WATER_NODES.forEach((p, v) => {
        if (!seen.has(v) && clearWater(WATER_NODES[u], p, water)) {
          seen.add(v);
          stack.push(v);
        }
      });
    }
    expect(seen.size).toBe(WATER_NODES.length);
    // North of the bridge to the marina has no straight line; the route goes round the island.
    const via = routeOnWater({ x: 330, z: 60 }, MARINA, water);
    expect(via).not.toEqual(MARINA);
    expect(routeOnWater({ x: 330, z: -120 }, MARINA, water)).toEqual(MARINA);
  });

  it("a police boat finds the player from every spawn", () => {
    const targets = [MARINA, { x: 330, z: 60 }, { x: 686, z: 60 }];
    for (const tp of targets) {
      const target = { ...tp, vx: 0, vz: 0 };
      for (const sp of POLICE_BOAT_SPAWNS) {
        const s = makeBoat(sp.x, sp.z, 0);
        let best = Infinity;
        let aim = target as { x: number; z: number };
        let tick = 0;
        for (let t = 0; t < 150 && best > 10; t += DT) {
          if (tick-- <= 0) {
            aim = routeOnWater(s, target, water);
            tick = 20;
          }
          const px = s.x, pz = s.z, ph = s.heading;
          stepBoat(s, BOAT_SPECS.police, chaseBoat(s, { ...aim, vx: 0, vz: 0 }, water), DT);
          keepOnWater(s, BOAT_SPECS.police, px, pz, ph, water);
          best = Math.min(best, Math.hypot(s.x - target.x, s.z - target.z));
        }
        expect(best, `from ${sp.x},${sp.z} to ${tp.x},${tp.z}`).toBeLessThan(10);
      }
    }
  });
});
