import { describe, expect, it } from "vitest";
import { Rng } from "../src/core/rng";
import { generateCity, isOnRoad, resolveCircleVsBuildings } from "../src/world/city";
import { CAR_SPECS, collideCar, speedOf, stepCar } from "../src/entities/carPhysics";
import { driveTraffic, spawnTraffic } from "../src/entities/traffic";

describe("traffic AI", () => {
  it("keeps cars on roads and moving for a minute of simulated time", () => {
    const rng = new Rng(42);
    const city = generateCity(rng, 6);
    const cars = spawnTraffic(rng, city, 20, [0xffffff]);
    expect(cars.length).toBeGreaterThan(10);
    const dt = 1 / 60;
    let offRoad = 0;
    let samples = 0;
    let distance = 0;
    for (let step = 0; step < 60 * 60; step++) {
      for (const c of cars) {
        const obstacles = cars.filter((o) => o !== c).map((o) => ({ x: o.state.x, z: o.state.z, r: 2, vx: o.state.vx, vz: o.state.vz }));
        driveTraffic(c, city, rng, obstacles, dt);
        stepCar(c.state, CAR_SPECS[c.kind], c.input, dt);
        const push = resolveCircleVsBuildings(city, c.state.x, c.state.z, 1.8);
        if (push) collideCar(c.state, push.x, push.z);
        distance += speedOf(c.state) * dt;
      }
      if (step % 30 === 0) {
        for (const c of cars) {
          samples++;
          if (!isOnRoad(city.n, c.state.x, c.state.z)) offRoad++;
        }
      }
    }
    expect(offRoad / samples).toBeLessThan(0.05);
    // Average car should cover a few hundred metres in a minute.
    expect(distance / cars.length).toBeGreaterThan(200);
  });
});
