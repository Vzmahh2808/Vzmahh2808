import { describe, expect, it } from "vitest";
import { CAR_SPECS, collideCar, forwardSpeed, makeCar, separateCars, speedOf, stepCar } from "../src/entities/carPhysics";

const spec = CAR_SPECS.sedan;
const idle = { throttle: 0, steer: 0, brake: false, handbrake: false };

describe("car physics", () => {
  it("accelerates forward and caps at max speed", () => {
    const c = makeCar(0, 0, 0);
    for (let i = 0; i < 60 * 30; i++) stepCar(c, spec, { ...idle, throttle: 1 }, 1 / 60);
    expect(forwardSpeed(c)).toBeGreaterThan(spec.maxSpeed * 0.8);
    expect(forwardSpeed(c)).toBeLessThanOrEqual(spec.maxSpeed + 1e-6);
    expect(c.x).toBeGreaterThan(100);
    expect(Math.abs(c.z)).toBeLessThan(1e-6);
  });

  it("brakes to a stop", () => {
    const c = makeCar(0, 0, 0);
    for (let i = 0; i < 300; i++) stepCar(c, spec, { ...idle, throttle: 1 }, 1 / 60);
    for (let i = 0; i < 600; i++) stepCar(c, spec, { ...idle, brake: true }, 1 / 60);
    expect(speedOf(c)).toBeLessThan(0.5);
  });

  it("turns right when steering right while moving", () => {
    const c = makeCar(0, 0, 0);
    for (let i = 0; i < 120; i++) stepCar(c, spec, { ...idle, throttle: 1 }, 1 / 60);
    for (let i = 0; i < 120; i++) stepCar(c, spec, { ...idle, throttle: 1, steer: 1 }, 1 / 60);
    expect(c.heading).toBeGreaterThan(0.3);
    expect(c.z).toBeGreaterThan(1);
  });

  it("reverses slowly", () => {
    const c = makeCar(0, 0, 0);
    for (let i = 0; i < 600; i++) stepCar(c, spec, { ...idle, throttle: -1 }, 1 / 60);
    expect(forwardSpeed(c)).toBeLessThan(-3);
    expect(forwardSpeed(c)).toBeGreaterThanOrEqual(-spec.maxReverse - 1e-6);
  });

  it("collision reverses normal velocity and damages at speed", () => {
    const c = makeCar(0, 0, 0);
    c.vx = 20;
    const dmg = collideCar(c, -0.5, 0);
    expect(c.vx).toBeLessThan(0);
    expect(dmg).toBeGreaterThan(0);
    expect(c.health).toBeLessThan(100);
  });

  it("separates overlapping cars", () => {
    const a = makeCar(0, 0, 0);
    const b = makeCar(1, 0, 0);
    a.vx = 10;
    expect(separateCars(a, b, 2, 2)).toBe(true);
    expect(b.x - a.x).toBeGreaterThanOrEqual(4 - 1e-6);
    expect(b.vx).toBeGreaterThan(0);
  });
});
