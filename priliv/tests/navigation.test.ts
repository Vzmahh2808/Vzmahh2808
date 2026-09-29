import { describe, expect, it } from "vitest";
import { fitMap, insideMap, mapToWorld, worldToMap } from "../src/ui/mapmath";
import { DROP_LIFE, DROP_MAX, DROP_RADIUS, Drops, dropAmount } from "../src/game/pickups";
import { RETRY_TIME, canRetry } from "../src/game/retry";

describe("full map coordinates", () => {
  const scale = 0.6;
  const extent = 400;
  // The pre-rendered image: 900 x 480 image pixels.
  const iw = 900;
  const ih = 480;
  const t = fitMap(iw, ih, 1200, 700);

  it("fit the image inside the screen and centre it", () => {
    expect(t.k).toBeLessThanOrEqual(1200 / iw);
    expect(t.k).toBeLessThanOrEqual(700 / ih);
    expect(t.ox).toBeGreaterThanOrEqual(0);
    expect(t.oy).toBeGreaterThanOrEqual(0);
    expect(t.ox * 2 + iw * t.k).toBeCloseTo(1200);
    expect(t.oy * 2 + ih * t.k).toBeCloseTo(700);
  });

  it("turn world metres into pixels and back without drift", () => {
    for (const [x, z] of [[0, 0], [-250, 120], [310, -180]]) {
      const p = worldToMap(t, scale, extent, x, z);
      const w = mapToWorld(t, scale, extent, p.x, p.y);
      expect(w.x).toBeCloseTo(x, 6);
      expect(w.z).toBeCloseTo(z, 6);
    }
  });

  it("put the world's top-left corner at the image's top-left", () => {
    const p = worldToMap(t, scale, extent, -extent, -extent);
    expect(p.x).toBeCloseTo(t.ox);
    expect(p.y).toBeCloseTo(t.oy);
  });

  it("tell a tap on the map from a tap on the margin", () => {
    expect(insideMap(t, iw, ih, 600, 350)).toBe(true);
    expect(insideMap(t, iw, ih, 2, 2)).toBe(false);
  });
});

describe("dropped cash", () => {
  it("is picked up by standing on it, and only the ones under the player", () => {
    const d = new Drops();
    d.add(10, 10, 30);
    d.add(50, 50, 20);
    const r = d.step(10 + DROP_RADIUS - 0.2, 10, 0.016);
    expect(r.money).toBe(30);
    expect(r.taken).toHaveLength(1);
    expect(d.list).toHaveLength(1);
  });

  it("blows away after a while", () => {
    const d = new Drops();
    d.add(0, 0, 50);
    let gone = 0;
    for (let t = 0; t < DROP_LIFE + 1; t += 1) gone += d.step(100, 100, 1).gone.length;
    expect(gone).toBe(1);
    expect(d.list).toHaveLength(0);
  });

  it("keeps only the most recent bills", () => {
    const d = new Drops();
    for (let i = 0; i < DROP_MAX + 5; i++) d.add(i * 10, 0, 10);
    expect(d.list).toHaveLength(DROP_MAX);
    expect(d.list[0].x).toBe(50);
  });

  it("drops something for about six people in ten, in tens of dollars", () => {
    expect(dropAmount(0.9, 0.5)).toBe(0);
    for (const r of [0, 0.3, 0.99]) {
      const a = dropAmount(0.1, r);
      expect(a % 10).toBe(0);
      expect(a).toBeGreaterThanOrEqual(10);
      expect(a).toBeLessThanOrEqual(50);
    }
  });
});

describe("retrying a failed job", () => {
  it("is offered for story jobs and side jobs, but not for paid races or taxi fares", () => {
    expect(canRetry("ch5-boss", false, false)).toBe(true);
    expect(canRetry("hideout-yards", false, false)).toBe(true);
    expect(canRetry("race", false, false)).toBe(true);
    expect(canRetry("street", true, false)).toBe(false);
    expect(canRetry("taxi", false, true)).toBe(false);
    expect(canRetry("taxi", false, false)).toBe(false);
  });

  it("stays up long enough to read", () => {
    expect(RETRY_TIME).toBeGreaterThanOrEqual(10);
  });
});
