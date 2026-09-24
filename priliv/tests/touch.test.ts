import { describe, expect, it } from "vitest";
import { stickVector } from "../src/ui/touch";
import { parseSave } from "../src/game/save";

describe("touch stick", () => {
  it("ignores the dead zone", () => {
    expect(stickVector(100, 100, 103, 102, 60)).toEqual({ x: 0, y: 0, mag: 0 });
  });

  it("points forward when dragged up and right when dragged right", () => {
    const up = stickVector(100, 100, 100, 40, 60);
    expect(up.y).toBeCloseTo(1);
    expect(up.x).toBeCloseTo(0);
    const right = stickVector(100, 100, 160, 100, 60);
    expect(right.x).toBeCloseTo(1);
    expect(right.y).toBeCloseTo(0);
  });

  it("clamps to the rim and ramps smoothly from the dead zone", () => {
    const far = stickVector(0, 0, 600, 0, 60);
    expect(far.x).toBeCloseTo(1);
    expect(far.mag).toBeCloseTo(1);
    const half = stickVector(0, 0, 30, 0, 60);
    expect(half.x).toBeGreaterThan(0.3);
    expect(half.x).toBeLessThan(0.6);
    const diag = stickVector(0, 0, 60, -60, 60);
    expect(Math.hypot(diag.x, diag.y)).toBeCloseTo(1);
  });
});

describe("quality setting in saves", () => {
  it("defaults to auto and rejects unknown values", () => {
    expect(parseSave(JSON.stringify({ version: 1 }))!.quality).toBe("auto");
    expect(parseSave(JSON.stringify({ version: 1, quality: "low" }))!.quality).toBe("low");
    expect(parseSave(JSON.stringify({ version: 1, quality: "ultra" }))!.quality).toBe("auto");
  });
});
