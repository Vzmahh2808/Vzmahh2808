import { describe, expect, it } from "vitest";
import { Gun, WEAPONS, hitChance, pickTarget } from "../src/game/weapons";

const DT = 1 / 60;

describe("guns", () => {
  it("fire at their rate while the trigger is held", () => {
    const g = new Gun(WEAPONS.smg, 100);
    let shots = 0;
    for (let t = 0; t < 1; t += DT) shots += g.update(DT, true);
    expect(shots).toBeGreaterThanOrEqual(9);
    expect(shots).toBeLessThanOrEqual(11);
    const p = new Gun(WEAPONS.pistol, 100);
    let ps = 0;
    for (let t = 0; t < 1; t += DT) ps += p.update(DT, true);
    expect(ps).toBeGreaterThanOrEqual(3);
    expect(ps).toBeLessThanOrEqual(4);
  });

  it("do not fire with the trigger released", () => {
    const g = new Gun(WEAPONS.pistol, 30);
    for (let t = 0; t < 2; t += DT) expect(g.update(DT, false)).toBe(0);
    expect(g.mag).toBe(12);
    expect(g.reserve).toBe(18);
  });

  it("reload from the reserve when the magazine runs dry, and stop when all is spent", () => {
    const g = new Gun(WEAPONS.pistol, 5);
    expect(g.mag).toBe(5);
    expect(g.reserve).toBe(0);
    const g2 = new Gun(WEAPONS.pistol, 20);
    expect(g2.mag).toBe(12);
    expect(g2.reserve).toBe(8);
    let shots = 0;
    for (let t = 0; t < 10; t += DT) shots += g2.update(DT, true);
    expect(shots).toBe(20);
    expect(g2.total).toBe(0);
    // A manual reload tops the magazine up.
    const g3 = new Gun(WEAPONS.pistol, 30);
    for (let t = 0; t < 1; t += DT) g3.update(DT, true);
    expect(g3.startReload()).toBe(true);
    expect(g3.startReload()).toBe(false);
    for (let t = 0; t < 2; t += DT) g3.update(DT, false);
    expect(g3.mag).toBe(12);
  });
});

describe("auto-aim", () => {
  const targets = [
    { id: 1, x: 20, z: 0 },
    { id: 2, x: 10, z: 8 },
    { id: 3, x: -10, z: 0 },
    { id: 4, x: 60, z: 0 },
  ];

  it("picks what is ahead, near the centre and close, and ignores the rest", () => {
    expect(pickTarget(0, 0, 0, targets, 45, 0.35)?.id).toBe(1);
    // Turned towards the second target.
    expect(pickTarget(0, 0, Math.atan2(8, 10), targets, 45, 0.35)?.id).toBe(2);
    // Behind and out of range are never picked.
    expect(pickTarget(0, 0, Math.PI, targets, 45, 0.35)?.id).toBe(3);
    expect(pickTarget(0, 0, 0, [targets[3]], 45, 0.35)).toBeNull();
  });

  it("skips targets behind walls", () => {
    expect(pickTarget(0, 0, 0, targets, 45, 0.35, (x) => x !== 20)).toBeNull();
  });

  it("hits more often up close", () => {
    expect(hitChance(2, 45)).toBeGreaterThan(0.95);
    expect(hitChance(40, 45)).toBeLessThan(hitChance(10, 45));
    expect(hitChance(100, 45)).toBe(0.35);
  });
});

import { freshSave, parseSave } from "../src/game/save";
import { places } from "../src/game/story";

describe("saving weapons", () => {
  it("keeps guns and ammo, drops unknown guns and junk", () => {
    const s = freshSave();
    s.weapons = { owned: ["pistol", "smg"], ammo: { pistol: 40, smg: 90 }, selected: "smg" };
    expect(parseSave(JSON.stringify(s))!.weapons).toEqual(s.weapons);
    const junk = parseSave(JSON.stringify({ version: 1, weapons: { owned: ["pistol", "bazooka", "pistol", 3], ammo: { pistol: -4 }, selected: "bazooka" } }))!;
    expect(junk.weapons).toEqual({ owned: ["pistol"], ammo: { pistol: 0 }, selected: null });
    expect(parseSave(JSON.stringify({ version: 1 }))!.weapons).toEqual({ owned: [], ammo: {}, selected: null });
  });

  it("the gun shop has its own spot", () => {
    const P = places(8);
    for (const [k, p] of Object.entries(P)) {
      if (k === "gunShop" || Array.isArray(p)) continue;
      expect(Math.hypot((p as { x: number }).x - P.gunShop.x, (p as { z: number }).z - P.gunShop.z), k).toBeGreaterThan(15);
    }
  });
});
