import { describe, expect, it } from "vitest";
import { makeCar } from "../src/entities/carPhysics";
import { applyBlastToCar, BURN_TIME, conditionOf, stepDamage } from "../src/entities/damage";

describe("car damage", () => {
  it("goes from smoking to burning to exploding", () => {
    const c = makeCar(0, 0, 0);
    expect(conditionOf(c)).toBe("ok");
    c.health = 50;
    expect(conditionOf(c)).toBe("smoking");
    c.health = 20;
    expect(conditionOf(c)).toBe("heavy");
    c.health = 0;
    expect(stepDamage(c, 0.1)).toBe("ignite");
    expect(conditionOf(c)).toBe("burning");
    let exploded = false;
    for (let t = 0; t < BURN_TIME + 1; t += 0.1) {
      const ev = stepDamage(c, 0.1);
      if (ev === "explode") exploded = true;
    }
    expect(exploded).toBe(true);
    expect(conditionOf(c)).toBe("wrecked");
    expect(stepDamage(c, 0.1)).toBeNull();
  });

  it("blast hurts and shoves nearby cars but not distant ones", () => {
    const near = makeCar(4, 0, 0);
    const far = makeCar(40, 0, 0);
    applyBlastToCar(near, 0, 0);
    applyBlastToCar(far, 0, 0);
    expect(near.health).toBeLessThan(100);
    expect(near.vx).toBeGreaterThan(0);
    expect(far.health).toBe(100);
    expect(far.vx).toBe(0);
  });

  it("a point-blank blast can chain-ignite a neighbour", () => {
    const c = makeCar(1, 0, 0);
    c.health = 60;
    applyBlastToCar(c, 0, 0);
    expect(stepDamage(c, 0.1)).toBe("ignite");
  });
});
