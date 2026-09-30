import { describe, expect, it } from "vitest";
import { Rng } from "../src/core/rng";
import { PITCH, ROAD_WIDTH, generateCity, isOnRoad, resolveCircleVsBuildings, roadCoord } from "../src/world/city";
import { CAR_SPECS, CIVILIAN_KINDS, PARKABLE_KINDS, TRAFFIC_WEIGHTS, collideCar, pickKind, speedOf, stepCar } from "../src/entities/carPhysics";
import { driveTraffic, spawnTraffic } from "../src/entities/traffic";
import { CYCLE, GREEN_TIME, YELLOW_TIME, lightFor, signalSpeedLimit, timeToGreen } from "../src/world/signals";
import { BRAVE_SHARE, FIGHT_DAMAGE, FIGHT_GIVE_UP, FIGHT_PAUSE, enrage, scare, spawnPeds, stepFight, stepPed, type Ped } from "../src/entities/peds";
import { buildWalkGraph } from "../src/world/sidewalks";
import { SHOP } from "../src/game/jobs";
import { EXPORT_NAMES, EXPORT_PRICES } from "../src/game/sidejobs";

describe("traffic lights", () => {
  it("never show green to both axes, and both go red together only never", () => {
    for (let t = 0; t < CYCLE * 3; t += 0.25) {
      const x = lightFor("x", t, 2, 3);
      const z = lightFor("z", t, 2, 3);
      expect(x === "green" && z === "green").toBe(false);
      expect(x === "green" && z === "yellow").toBe(false);
      // While one axis is not red, the other must be red.
      if (x !== "red") expect(z).toBe("red");
      if (z !== "red") expect(x).toBe("red");
    }
  });

  it("each axis gets green for a fair share, then yellow", () => {
    let green = 0;
    let yellow = 0;
    const steps = 4 * CYCLE;
    for (let i = 0; i < steps; i++) {
      const l = lightFor("x", i * 0.5, 0, 0);
      if (l === "green") green++;
      if (l === "yellow") yellow++;
    }
    expect((green * 0.5) / (steps * 0.5 / 1)).toBeCloseTo(GREEN_TIME / CYCLE, 1);
    expect((yellow * 0.5) / (steps * 0.5 / 1)).toBeCloseTo(YELLOW_TIME / CYCLE, 1);
  });

  it("neighbouring intersections are out of step", () => {
    const seen = new Set<string>();
    for (let iz = 0; iz < 4; iz++) seen.add(lightFor("x", 3, 0, iz));
    expect(seen.size).toBeGreaterThan(1);
  });

  it("makes a car stop at a red, lets it run a late yellow, and waits for green", () => {
    expect(signalSpeedLimit("green", 5, 12)).toBe(Infinity);
    expect(signalSpeedLimit("red", 30, 12)).toBeGreaterThan(12);
    expect(signalSpeedLimit("red", 5, 12)).toBeLessThan(12);
    expect(signalSpeedLimit("red", 0, 0)).toBe(0);
    // Past the line: clear the junction.
    expect(signalSpeedLimit("red", -6, 10)).toBe(Infinity);
    expect(signalSpeedLimit("red", -1, 3)).toBe(0);
    // Too fast to stop before the line on yellow: carries on.
    expect(signalSpeedLimit("yellow", 3, 13)).toBe(Infinity);
    expect(signalSpeedLimit("yellow", 40, 8)).toBeLessThan(40);
    expect(timeToGreen("x", 0, 0, 0)).toBe(0);
    expect(timeToGreen("z", 0, 0, 0)).toBeGreaterThan(0);
  });

  it("stops traffic at the line on red, but keeps it moving", () => {
    const rng = new Rng(11);
    const city = generateCity(rng, 6);
    const cars = spawnTraffic(rng, city, 24, [0xffffff]);
    const dt = 1 / 60;
    let time = 0;
    let distance = 0;
    let crossings = 0;
    let violations = 0;
    const prev = new Map<object, { node: string; gap: number }>();
    for (let step = 0; step < 60 * 120; step++) {
      time += dt;
      for (const c of cars) {
        const obstacles = cars.filter((o) => o !== c).map((o) => ({ x: o.state.x, z: o.state.z, r: 2, vx: o.state.vx, vz: o.state.vz }));
        driveTraffic(c, city, rng, obstacles, dt, time, CAR_SPECS[c.kind].length / 2);
        stepCar(c.state, CAR_SPECS[c.kind], c.input, dt);
        const push = resolveCircleVsBuildings(city, c.state.x, c.state.z, 1.8);
        if (push) collideCar(c.state, push.x, push.z);
        distance += speedOf(c.state) * dt;
        // Where is the stop line of the intersection this car is heading for?
        const bx = roadCoord(city.n, c.b.ix);
        const bz = roadCoord(city.n, c.b.iz);
        const ax = roadCoord(city.n, c.a.ix);
        const az = roadCoord(city.n, c.a.iz);
        const dx = Math.sign(bx - ax);
        const dz = Math.sign(bz - az);
        const gap = (bx - c.state.x) * dx + (bz - c.state.z) * dz - (ROAD_WIDTH / 2 + 2) - CAR_SPECS[c.kind].length / 2;
        const node = `${c.b.ix},${c.b.iz}`;
        const before = prev.get(c);
        // Nosing past the line by more than a bumper counts as entering the crossing.
        if (before && before.node === node && before.gap > -2.5 && gap <= -2.5) {
          crossings++;
          const axis = dx !== 0 ? "x" : "z";
          if (lightFor(axis, time, c.b.ix, c.b.iz) === "red" && lightFor(axis, time - 1, c.b.ix, c.b.iz) === "red") violations++;
        }
        prev.set(c, { node, gap });
      }
    }
    expect(crossings).toBeGreaterThan(20);
    expect(violations / crossings).toBeLessThan(0.05);
    expect(distance / cars.length).toBeGreaterThan(150);
    expect(cars.filter((c) => isOnRoad(city.n, c.state.x, c.state.z)).length).toBeGreaterThan(cars.length * 0.9);
  });

  it("puts a solid pole on every corner", () => {
    const city = generateCity(new Rng(5), 4);
    const it = city.intersections[7];
    const near = city.posts.filter((p) => Math.hypot(p.x - it.x, p.z - it.z) < 10);
    expect(near.length).toBeGreaterThanOrEqual(4);
    expect(ROAD_WIDTH).toBeGreaterThan(0);
    expect(roadCoord(4, 2)).toBe(0);
    expect(PITCH).toBeGreaterThan(0);
  });
});

describe("more vehicles", () => {
  it("every civilian kind has specs and pays out at the dock", () => {
    for (const k of CIVILIAN_KINDS) {
      expect(CAR_SPECS[k], k).toBeDefined();
      expect(TRAFFIC_WEIGHTS[k]).toBeGreaterThan(0);
      expect(EXPORT_PRICES[k], k).toBeGreaterThan(0);
      expect(EXPORT_NAMES[k], k).toBeTruthy();
    }
    expect(CAR_SPECS.firetruck).toBeDefined();
    expect(CIVILIAN_KINDS as readonly string[]).not.toContain("firetruck");
  });

  it("buses and lorries never park at the kerb, and big vehicles are heavier", () => {
    expect(PARKABLE_KINDS as readonly string[]).not.toContain("bus");
    expect(PARKABLE_KINDS as readonly string[]).not.toContain("truck");
    expect(CAR_SPECS.bus.length).toBeGreaterThan(CAR_SPECS.van.length);
    expect(CAR_SPECS.bus.mass).toBeGreaterThan(CAR_SPECS.truck.mass);
    expect(CAR_SPECS.muscle.maxSpeed).toBeGreaterThan(CAR_SPECS.sedan.maxSpeed);
    expect(CAR_SPECS.hatch.length).toBeLessThan(CAR_SPECS.sedan.length);
  });

  it("weighted draw favours family cars and still finds every kind", () => {
    const rng = new Rng(9);
    const counts: Record<string, number> = {};
    for (let i = 0; i < 4000; i++) {
      const k = pickKind(() => rng.next());
      counts[k] = (counts[k] ?? 0) + 1;
    }
    for (const k of CIVILIAN_KINDS) expect(counts[k], k).toBeGreaterThan(0);
    expect(counts.sedan).toBeGreaterThan(counts.bus * 2);
  });

  it("all of them can be bought or exported, and the new ones are in the shop", () => {
    const kinds = SHOP.map((s) => s.kind);
    for (const k of ["hatch", "suv", "muscle"]) expect(kinds).toContain(k);
  });

  it("big traffic vehicles stay on the roads", () => {
    for (const kind of ["bus", "truck"]) {
      const rng = new Rng(42);
      const city = generateCity(rng, 6);
      const cars = spawnTraffic(rng, city, 12, [0xffffff]);
      for (const c of cars) c.kind = kind;
      let off = 0;
      let n = 0;
      for (let step = 0; step < 60 * 60; step++) {
        for (const c of cars) {
          const obs = cars.filter((o) => o !== c).map((o) => ({ x: o.state.x, z: o.state.z, r: 4, vx: o.state.vx, vz: o.state.vz }));
          driveTraffic(c, city, rng, obs, 1 / 60, step / 60, CAR_SPECS[kind].length / 2);
          stepCar(c.state, CAR_SPECS[kind], c.input, 1 / 60);
          const push = resolveCircleVsBuildings(city, c.state.x, c.state.z, CAR_SPECS[kind].length * 0.42);
          if (push) collideCar(c.state, push.x, push.z);
        }
        if (step % 30 === 0) for (const c of cars) { n++; if (!isOnRoad(city.n, c.state.x, c.state.z)) off++; }
      }
      expect(off / n, kind).toBeLessThan(0.05);
    }
  });
});

describe("fights", () => {
  const makePed = (): Ped => {
    const rng = new Rng(3);
    const city = generateCity(rng, 4);
    return spawnPeds(rng, buildWalkGraph(city), 1)[0];
  };

  it("about four in ten pedestrians are bold", () => {
    const rng = new Rng(21);
    const city = generateCity(rng, 6);
    const peds = spawnPeds(rng, buildWalkGraph(city), 300);
    const share = peds.filter((p) => p.brave).length / peds.length;
    expect(share).toBeGreaterThan(BRAVE_SHARE - 0.1);
    expect(share).toBeLessThan(BRAVE_SHARE + 0.1);
  });

  it("a fighter walks up, punches on a rhythm, and never gives up on a close target", () => {
    const p = makePed();
    p.x = 0;
    p.z = 0;
    enrage(p);
    expect(p.state).toBe("fight");
    let hits = 0;
    let t = 0;
    // The target stands still four metres away for a whole minute.
    for (let i = 0; i < 60 * 60; i++) {
      const ev = stepFight(p, 4, 0, 1 / 60);
      expect(ev).not.toBe("quit");
      if (ev === "hit") {
        hits++;
        t = i / 60;
      }
    }
    expect(hits).toBeGreaterThan(40);
    expect(t).toBeGreaterThan(50);
    expect(Math.hypot(p.x - 4, p.z)).toBeLessThan(1.3);
    // About one punch per pause.
    expect(hits).toBeLessThan(60 / FIGHT_PAUSE + 2);
    expect(FIGHT_DAMAGE).toBeGreaterThan(0);
  });

  it("gives up only if the target is clean gone", () => {
    const p = makePed();
    p.x = 0;
    p.z = 0;
    enrage(p);
    expect(stepFight(p, FIGHT_GIVE_UP - 5, 0, 1 / 60)).not.toBe("quit");
    expect(stepFight(p, FIGHT_GIVE_UP + 5, 0, 1 / 60)).toBe("quit");
  });

  it("noise does not scare a fighter, and only bystanders run", () => {
    const p = makePed();
    enrage(p);
    scare(p, { x: 0, z: 0 }, 6);
    expect(p.state).toBe("fight");
    const rng = new Rng(1);
    const city = generateCity(rng, 4);
    const g = buildWalkGraph(city);
    stepPed(p, g, rng, 1 / 60, [{ x: p.x, z: p.z, radius: 30 }]);
    expect(p.state).toBe("fight");
    const bystander = makePed();
    scare(bystander, { x: 0, z: 0 }, 6);
    expect(bystander.state).toBe("flee");
  });

  it("a downed ped cannot be enraged", () => {
    const p = makePed();
    p.state = "down";
    enrage(p);
    expect(p.state).toBe("down");
  });
});

describe("embankment", () => {
  const LIMIT = 278;
  it("fences the whole shore except the bridge and the marina pier", async () => {
    const { embankmentColliders, shoreGaps, railSpans } = await import("../src/world/embankment");
    const { BRIDGE, PIERS } = await import("../src/world/island");
    const rails = embankmentColliders(LIMIT);
    expect(rails.every((r) => r.kind === "rail")).toBe(true);
    const covered = (z: number) => rails.some((r) => Math.abs(z - r.z) <= r.d / 2);
    // Every metre of shore is railed except in the gaps.
    for (let z = -LIMIT + 0.5; z < LIMIT; z += 1) {
      const inGap = shoreGaps().some((g) => z >= g.z0 && z <= g.z1);
      expect(covered(z), `z=${z}`).toBe(!inGap);
    }
    // The bridge and the marina pier stay open.
    expect(covered((BRIDGE.z0 + BRIDGE.z1) / 2)).toBe(false);
    const marina = PIERS[PIERS.length - 1];
    expect(covered((marina.z0 + marina.z1) / 2)).toBe(false);
    expect(railSpans(LIMIT).length).toBe(3);
  });

  it("stops a car and a walker at the rail but lets them through the gaps", async () => {
    const { embankmentColliders, RAIL_X } = await import("../src/world/embankment");
    const rng = new Rng(2);
    const city = generateCity(rng, 8);
    city.buildings.push(...embankmentColliders(LIMIT));
    // 30 m/s straight at the sea from the road, at z=100.
    let x = 250;
    for (let i = 0; i < 120; i++) {
      x += 30 / 60;
      const push = resolveCircleVsBuildings(city, x, 100, 1.9);
      if (push) x += push.x;
    }
    expect(x).toBeLessThan(RAIL_X);
    // On foot at the bridge the way is open.
    expect(resolveCircleVsBuildings(city, RAIL_X, 0, 0.45)).toBeNull();
    // A walker at the rail elsewhere is pushed back.
    const p = resolveCircleVsBuildings(city, RAIL_X, 60, 0.45);
    expect(p).not.toBeNull();
  });

  it("puts benches and lamps clear of the gaps", async () => {
    const { promenadeFurniture, shoreGaps } = await import("../src/world/embankment");
    const f = promenadeFurniture(248);
    expect(f.benches.length).toBeGreaterThan(5);
    expect(f.lamps.length).toBeGreaterThan(10);
    for (const z of [...f.benches, ...f.lamps]) for (const g of shoreGaps()) expect(z < g.z0 || z > g.z1).toBe(true);
  });
});
