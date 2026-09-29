import { describe, expect, it } from "vitest";
import { Rng } from "../src/core/rng";
import { LAMP_RADIUS, generateCity, isOnCarriageway, resolveCircleVsPosts } from "../src/world/city";
import { CAR_SPECS, collideCar, makeCar, stepCar } from "../src/entities/carPhysics";
import { rampHeight, resolveCircleVsRamps } from "../src/entities/jumps";
import { RAMPS } from "../src/game/stunts";

const city = generateCity(new Rng(20260924), 8);

describe("lamp posts and trees", () => {
  it("cover every lamp and every tree", () => {
    expect(city.posts.length).toBe(city.lamps.length + city.trees.length);
    expect(city.posts.length).toBeGreaterThan(900);
  });

  it("stand off the carriageway, so cars driving on the road never meet them", () => {
    for (const p of city.posts) expect(isOnCarriageway(8, p.x, p.z), `${p.x},${p.z}`).toBe(false);
  });

  it("push a circle out of a lamp, and leave a clear spot alone", () => {
    const lamp = city.lamps[0];
    const push = resolveCircleVsPosts(city, lamp.x + 0.2, lamp.z, 0.4);
    expect(push).not.toBeNull();
    expect(push!.x).toBeGreaterThan(0);
    // After the push the circle no longer overlaps.
    expect(resolveCircleVsPosts(city, lamp.x + 0.2 + push!.x, lamp.z + push!.z, 0.39)).toBeNull();
    expect(resolveCircleVsPosts(city, lamp.x + LAMP_RADIUS + 3, lamp.z, 0.4)).toBeNull();
  });

  it("stop a car that drives into one, and hurt it", () => {
    // A lamp in the middle of a clear stretch of the pavement: drive at it along the pavement.
    const lamp = city.lamps.find((l) => l.rot === 0)!;
    const car = makeCar(lamp.x - 14, lamp.z, 0);
    car.vx = 12;
    const health = car.health;
    let touched = false;
    for (let i = 0; i < 300; i++) {
      stepCar(car, CAR_SPECS.sedan, { throttle: 0.5, steer: 0, brake: false, handbrake: false }, 1 / 60);
      const push = resolveCircleVsPosts(city, car.x, car.z, 4.4 * 0.42 * 0.7);
      if (push) {
        touched = true;
        collideCar(car, push.x, push.z);
      }
    }
    expect(touched).toBe(true);
    expect(car.health).toBeLessThan(health);
    // The lamp holds: the car did not get past it.
    expect(car.x).toBeLessThan(lamp.x + 1);
  });
});

describe("ramps as walls for people on foot", () => {
  it("push a walker out of every ramp and let one nearby pass", () => {
    for (const r of RAMPS) {
      const mid = { x: r.x + Math.cos(r.heading) * r.length * 0.4, z: r.z + Math.sin(r.heading) * r.length * 0.4 };
      expect(rampHeight(r, mid.x, mid.z)).not.toBeNull();
      const push = resolveCircleVsRamps([r], mid.x, mid.z, 0.4);
      expect(push, r.id).not.toBeNull();
      const out = { x: mid.x + push!.x, z: mid.z + push!.z };
      // Out of the footprint, at least by the walker's own radius.
      expect(resolveCircleVsRamps([r], out.x, out.z, 0.39), r.id).toBeNull();
      const far = { x: r.x - Math.cos(r.heading) * 10, z: r.z - Math.sin(r.heading) * 10 };
      expect(resolveCircleVsRamps([r], far.x, far.z, 0.4), r.id).toBeNull();
    }
  });

  it("leave a ramp by the nearer side", () => {
    const r = RAMPS[0];
    const fx = Math.cos(r.heading);
    const fz = Math.sin(r.heading);
    // Just inside the left edge, halfway along: pushed sideways, not lengthways.
    const side = { x: r.x + fx * r.length * 0.5 + -fz * (r.width / 2 - 0.3), z: r.z + fz * r.length * 0.5 + fx * (r.width / 2 - 0.3) };
    const push = resolveCircleVsRamps([r], side.x, side.z, 0.4)!;
    const along = push.x * fx + push.z * fz;
    const across = -push.x * fz + push.z * fx;
    expect(Math.abs(across)).toBeGreaterThan(Math.abs(along));
    expect(across).toBeGreaterThan(0);
  });
});
