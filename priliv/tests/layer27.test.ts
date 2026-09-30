import { describe, expect, it } from "vitest";
import { Rng } from "../src/core/rng";
import { CAR_SPECS, CIVILIAN_KINDS } from "../src/entities/carPhysics";
import { fareTime, makeMedicCall, makeTaxiFare, medicPay, taxiFare } from "../src/game/jobs";
import { MissionRunner } from "../src/game/missions";
import { canRetry } from "../src/game/retry";
import { places } from "../src/game/story";

const pool = Array.from({ length: 40 }, (_, i) => ({ x: (i % 8) * 90 - 300, z: Math.floor(i / 8) * 90 - 200 }));

describe("ambulance job", () => {
  it("has its own vehicle that never appears as ordinary traffic", () => {
    expect(CAR_SPECS.ambulance).toBeDefined();
    expect(CIVILIAN_KINDS as readonly string[]).not.toContain("ambulance");
  });

  it("is a two-step call ending at the hospital, tighter than a taxi fare", () => {
    const P = places(8);
    const rng = new Rng(7);
    const from = { x: 0, z: 0 };
    const call = makeMedicCall(rng, pool, from, P.hospital);
    expect(call.mission.id).toBe("medic");
    expect(call.mission.steps).toHaveLength(2);
    expect(call.mission.steps[1]).toMatchObject({ kind: "goto", at: P.hospital, stop: true });
    expect(call.dropoff).toEqual(P.hospital);
    const flat = fareTime(Math.hypot(call.pickup.x - from.x, call.pickup.z - from.z)) + fareTime(call.distance);
    expect(call.mission.time).toBeLessThan(flat);
    // A taxi fare for the same trip is generated without touching the hospital.
    expect(makeTaxiFare(new Rng(7), pool, from).mission.id).toBe("taxi");
  });

  it("pays more for speed and for a streak, and more than a taxi for the same run", () => {
    const slow = medicPay(300, 0, 60, 0);
    const fast = medicPay(300, 60, 60, 0);
    expect(fast).toBeGreaterThan(slow);
    expect(medicPay(300, 30, 60, 3)).toBeGreaterThan(medicPay(300, 30, 60, 0));
    // The streak bonus stops growing.
    expect(medicPay(300, 30, 60, 50)).toBe(medicPay(300, 30, 60, 5));
    expect(medicPay(300, 30, 60, 0)).toBeGreaterThan(taxiFare(300, 30, 60));
  });

  it("times out like any job, and is not offered as a retry", () => {
    const P = places(8);
    const call = makeMedicCall(new Rng(3), pool, { x: 0, z: 0 }, P.hospital);
    const r = new MissionRunner();
    r.start(call.mission);
    const ev = r.update({ x: -999, z: -999, vehicle: "ambulance", speed: 10, stars: 0, destroyed: new Set(), health: 100, kills: 0, armed: false, hostilesLeft: 0, hiding: false } as never, (call.mission.time ?? 0) + 5);
    expect(ev.some((e) => e.type === "fail")).toBe(true);
    expect(canRetry("medic", false, true)).toBe(false);
  });

  it("puts the hospital well away from the other landmarks", () => {
    const P = places(8);
    for (const k of ["garage", "paint", "shop", "gunShop", "office", "contact", "race", "depot", "clothes"] as const) {
      expect(Math.hypot(P.hospital.x - P[k].x, P.hospital.z - P[k].z), k).toBeGreaterThan(25);
    }
  });
});
