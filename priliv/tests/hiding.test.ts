import { describe, expect, it } from "vitest";
import { AIR_TIME, DIG_CLEARANCE, DIG_TIME, FIND_RADIUS, canDig, climbOut, freshHole, stepHole } from "../src/game/hiding";
import { FISTS, WEAPONS, WEAPON_ORDER, swingInterval } from "../src/game/weapons";
import { copGivesUp, mayReinforce, pursuitTarget, SIGHT_MEMORY } from "../src/police/search";
import { Wanted, evadeTime } from "../src/police/wanted";
import { CRIME_HEAT } from "../src/police/wanted";
import { freshSave, parseSave } from "../src/game/save";

const DT = 1 / 60;

describe("digging a hole", () => {
  it("only works on pavement or grass, standing still, with nobody near, and with no other job on", () => {
    expect(canDig("pavement", 0, 100, false)).toBe("ok");
    expect(canDig("grass", 0.2, 100, false)).toBe("ok");
    expect(canDig("asphalt", 0, 100, false)).toBe("road");
    expect(canDig("water", 0, 100, false)).toBe("water");
    expect(canDig("other", 0, 100, false)).toBe("water");
    expect(canDig("pavement", 3, 100, false)).toBe("moving");
    expect(canDig("pavement", 0, DIG_CLEARANCE - 1, false)).toBe("watched");
    expect(canDig("pavement", 0, DIG_CLEARANCE + 1, false)).toBe("ok");
    expect(canDig("pavement", 0, 100, true)).toBe("mission");
  });

  it("takes a moment, and letting go undoes the progress", () => {
    const h = freshHole();
    let e = null;
    for (let t = 0; t < DIG_TIME - 0.5; t += DT) e = stepHole(h, DT, true, 100);
    expect(e).toBeNull();
    expect(h.hidden).toBe(false);
    // Let go: the hole fills back in.
    for (let t = 0; t < 1.3; t += DT) stepHole(h, DT, false, 100);
    expect(h.dig).toBe(0);
    // Dig the whole way.
    let dug = false;
    for (let t = 0; t < DIG_TIME + 0.2 && !dug; t += DT) dug = stepHole(h, DT, true, 100) === "dug";
    expect(dug).toBe(true);
    expect(h.hidden).toBe(true);
    expect(h.air).toBeCloseTo(AIR_TIME);
  });

  it("runs out of air after a while", () => {
    const h = freshHole();
    h.hidden = true;
    h.air = AIR_TIME;
    let e = null;
    let t = 0;
    while (t < AIR_TIME + 1 && e === null) {
      e = stepHole(h, DT, false, 100);
      t += DT;
    }
    expect(e).toBe("out-of-air");
    expect(t).toBeCloseTo(AIR_TIME, 0);
    expect(h.hidden).toBe(false);
  });

  it("is found when a cop walks right up to it, but not by one a little way off", () => {
    const h = freshHole();
    h.hidden = true;
    h.air = AIR_TIME;
    expect(stepHole(h, DT, false, FIND_RADIUS + 1)).toBeNull();
    expect(h.hidden).toBe(true);
    expect(stepHole(h, DT, false, FIND_RADIUS - 1)).toBe("found");
    expect(h.hidden).toBe(false);
  });

  it("can be left at will", () => {
    const h = freshHole();
    h.hidden = true;
    h.air = 30;
    climbOut(h);
    expect(h.hidden).toBe(false);
  });
});

describe("the police search", () => {
  const actual = { x: 10, z: 20, vx: 5, vz: 0 };
  const last = { x: -40, z: 8 };

  it("chase the real position while they see the player, and the last known one after", () => {
    expect(pursuitTarget(actual, last, 0)).toBe(actual);
    expect(pursuitTarget(actual, last, SIGHT_MEMORY - 0.1)).toBe(actual);
    expect(pursuitTarget(actual, last, SIGHT_MEMORY + 0.1)).toEqual({ x: -40, z: 8, vx: 0, vz: 0 });
  });

  it("stop calling reinforcements when they have lost the player", () => {
    expect(mayReinforce(0.5)).toBe(true);
    expect(mayReinforce(10)).toBe(false);
  });

  it("send cops on foot home when they are far away and see nothing", () => {
    expect(copGivesUp(30, 6)).toBe(true);
    expect(copGivesUp(10, 6)).toBe(false);
    expect(copGivesUp(30, 1)).toBe(false);
  });

  it("let a hidden player shake one star in about ten seconds", () => {
    const w = new Wanted();
    w.add("hitPed");
    w.add("hitPed");
    expect(w.level).toBe(1);
    let t = 0;
    while (w.level > 0 && t < 60) {
      w.update(DT, false);
      t += DT;
    }
    expect(t).toBeCloseTo(evadeTime(1), 0);
    expect(t).toBeLessThanOrEqual(10.5);
  });
});

describe("melee", () => {
  it("has fists and a shovel that need no ammo", () => {
    expect(FISTS.melee).toBe(true);
    expect(WEAPONS.shovel.melee).toBe(true);
    expect(WEAPONS.shovel.damage).toBeGreaterThan(FISTS.damage);
    expect(WEAPONS.shovel.range).toBeGreaterThan(FISTS.range);
    expect(WEAPON_ORDER).toContain("shovel");
  });

  it("lets a determined player floor a cop before the arrest completes", () => {
    // 100 HP cop: seven fist punches fit inside the 3.5 s arrest window.
    const punches = Math.floor(3.5 / swingInterval(FISTS));
    expect(punches * FISTS.damage).toBeGreaterThanOrEqual(100);
    // With a shovel it takes three swings.
    expect(Math.ceil(100 / WEAPONS.shovel.damage)).toBe(3);
  });

  it("a brawl is a lesser crime than shooting a cop", () => {
    expect(CRIME_HEAT.assault).toBeLessThan(CRIME_HEAT.shooting);
    expect(CRIME_HEAT.assault).toBeGreaterThan(0);
  });

  it("the shovel is saved like any other item", () => {
    const s = { ...freshSave(), weapons: { owned: ["shovel", "pistol"], ammo: { shovel: 0, pistol: 10 }, selected: "shovel" } };
    expect(parseSave(JSON.stringify(s))!.weapons).toEqual({ owned: ["shovel", "pistol"], ammo: { shovel: 0, pistol: 10 }, selected: "shovel" });
  });
});
