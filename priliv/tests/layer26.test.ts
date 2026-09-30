import { describe, expect, it } from "vitest";
import { CAR_SPECS, CIVILIAN_KINDS, NO_MODS, makeCar, speedOf, stepCar } from "../src/entities/carPhysics";
import { OUTFITS, isOutfit, tryChange } from "../src/game/outfits";
import { SHOP, buy } from "../src/game/jobs";
import { EXPORT_NAMES, EXPORT_PRICES } from "../src/game/sidejobs";
import { freshSave, parseSave } from "../src/game/save";
import { places } from "../src/game/story";

describe("motorcycle", () => {
  it("is a civilian kind, faster off the line than a sedan but slimmer", () => {
    const b = CAR_SPECS.bike;
    expect(CIVILIAN_KINDS).toContain("bike");
    expect(b.accel).toBeGreaterThan(CAR_SPECS.sedan.accel);
    expect(b.width).toBeLessThan(1);
    expect(b.length).toBeLessThan(CAR_SPECS.sedan.length / 1.5);
  });

  it("accelerates to near its top speed and steers", () => {
    const c = makeCar(0, 0, 0);
    for (let i = 0; i < 60 * 12; i++) stepCar(c, CAR_SPECS.bike, { throttle: 1, steer: 0, brake: false, handbrake: false }, 1 / 60);
    expect(speedOf(c)).toBeGreaterThan(CAR_SPECS.bike.maxSpeed * 0.85);
    const h = c.heading;
    for (let i = 0; i < 60; i++) stepCar(c, CAR_SPECS.bike, { throttle: 1, steer: 1, brake: false, handbrake: false }, 1 / 60);
    expect(c.heading).toBeGreaterThan(h + 0.3);
    // Not so twitchy that it spins in place at top speed.
    expect(c.heading - h).toBeLessThan(4);
  });

  it("is on sale and can be exported", () => {
    const bike = SHOP.find((s) => s.kind === "bike");
    expect(bike).toBeDefined();
    expect(bike!.price).toBeLessThan(SHOP.find((s) => s.kind === "sport")!.price);
    expect(buy(bike!.price, bike!.price)).not.toBeNull();
    expect(EXPORT_PRICES.bike).toBeGreaterThan(0);
    expect(EXPORT_NAMES.bike).toBeTruthy();
    void NO_MODS;
  });
});

describe("clothes shop", () => {
  it("starts with a free outfit and unique looks", () => {
    expect(OUTFITS[0].price).toBe(0);
    const looks = new Set(OUTFITS.map((o) => `${o.shirt}/${o.pants}`));
    expect(looks.size).toBe(OUTFITS.length);
  });

  it("changes without stars whenever there is enough money", () => {
    expect(tryChange(0, 1, 500, 0, false, [0])).toEqual({ ok: true, disguised: false });
    expect(tryChange(0, 1, 5, 0, false, [0])).toEqual({ ok: false, reason: "money" });
    expect(tryChange(1, 1, 500, 0, false, [0, 1])).toEqual({ ok: false, reason: "same" });
    // Already bought: free to put on again.
    expect(tryChange(1, 2, 0, 0, false, [0, 1, 2])).toEqual({ ok: true, disguised: false });
  });

  it("wipes the stars only when the police cannot see the player", () => {
    expect(tryChange(0, 2, 500, 3, false, [0])).toEqual({ ok: true, disguised: true });
    expect(tryChange(0, 2, 500, 3, true, [0])).toEqual({ ok: false, reason: "seen" });
  });

  it("is saved and validated", () => {
    const s = freshSave();
    expect(s.outfit).toEqual({ worn: 0, owned: [0] });
    s.outfit = { worn: 2, owned: [0, 2] };
    expect(parseSave(JSON.stringify(s))!.outfit).toEqual({ worn: 2, owned: [0, 2] });
    // Junk falls back to the plain outfit; an unowned outfit cannot be worn.
    const junk = JSON.parse(JSON.stringify(s));
    junk.outfit = { worn: 99, owned: ["x", 1.5, 3, 3, -1] };
    expect(parseSave(JSON.stringify(junk))!.outfit).toEqual({ worn: 0, owned: [0, 3] });
    junk.outfit = { worn: 4, owned: [0] };
    expect(parseSave(JSON.stringify(junk))!.outfit.worn).toBe(0);
    expect(isOutfit(OUTFITS.length)).toBe(false);
    // Old saves without the field still load.
    delete junk.outfit;
    expect(parseSave(JSON.stringify(junk))!.outfit).toEqual({ worn: 0, owned: [0] });
  });

  it("sits well away from the other shops", () => {
    const P = places(8);
    for (const k of ["garage", "paint", "shop", "gunShop", "office", "contact", "race", "depot"] as const) {
      expect(Math.hypot(P.clothes.x - P[k].x, P.clothes.z - P[k].z)).toBeGreaterThan(25);
    }
  });
});
