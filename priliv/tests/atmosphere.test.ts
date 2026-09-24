import { describe, expect, it } from "vitest";
import { Rng } from "../src/core/rng";
import { formatClock, lerpColor, lightingAt, nightFactor, wrapHour } from "../src/world/timeOfDay";
import { Weather } from "../src/world/weather";
import { STATIONS, chord, degree, makeBar, midiToHz } from "../src/audio/music";

describe("time of day", () => {
  it("is bright at noon and dark at midnight", () => {
    const noon = lightingAt(12);
    const midnight = lightingAt(0);
    expect(noon.night).toBe(0);
    expect(midnight.night).toBe(1);
    expect(noon.sunIntensity).toBeGreaterThan(midnight.sunIntensity * 4);
    expect(noon.lampsOn).toBe(false);
    expect(midnight.lampsOn).toBe(true);
    expect(noon.sunElevation).toBeGreaterThan(0);
    expect(lightingAt(23).sunElevation).toBeLessThan(0);
  });

  it("changes smoothly with no jumps between keyframes", () => {
    let prev = lightingAt(0);
    for (let h = 0.05; h <= 24; h += 0.05) {
      const cur = lightingAt(h);
      expect(Math.abs(cur.sunIntensity - prev.sunIntensity)).toBeLessThan(0.1);
      expect(Math.abs(cur.night - prev.night)).toBeLessThan(0.05);
      prev = cur;
    }
    expect(nightFactor(19)).toBeGreaterThan(0);
    expect(nightFactor(19)).toBeLessThan(1);
  });

  it("wraps and formats the clock", () => {
    expect(wrapHour(25.5)).toBeCloseTo(1.5);
    expect(wrapHour(-1)).toBe(23);
    expect(formatClock(17.75)).toBe("17:45");
    expect(formatClock(24)).toBe("00:00");
    expect(lerpColor(0x000000, 0xffffff, 0.5)).toBe(0x808080);
  });
});

describe("weather", () => {
  it("rain eases in, makes roads wet and cuts grip, then dries slowly", () => {
    const w = new Weather(new Rng(1), "clear");
    expect(w.gripFactor()).toBe(1);
    w.set("storm");
    for (let i = 0; i < 60 * 30; i++) w.update(1 / 60);
    expect(w.rain).toBeGreaterThan(0.8);
    expect(w.wet).toBeGreaterThan(0.8);
    expect(w.gripFactor()).toBeLessThan(0.75);
    w.set("clear");
    for (let i = 0; i < 60 * 20; i++) w.update(1 / 60);
    expect(w.rain).toBeLessThan(0.1);
    expect(w.wet).toBeGreaterThan(w.rain);
  });

  it("changes on its own over time", () => {
    const w = new Weather(new Rng(3), "clear");
    const kinds = new Set<string>();
    for (let i = 0; i < 60 * 60 * 30; i += 30) {
      w.update(0.5);
      kinds.add(w.kind);
    }
    expect(kinds.size).toBeGreaterThan(2);
  });

  it("night and rain shorten police sight", () => {
    expect(Weather.visibility(0, 0)).toBe(1);
    expect(Weather.visibility(1, 1)).toBeLessThan(0.6);
  });
});

describe("radio music", () => {
  it("builds notes inside the station scale", () => {
    for (const st of STATIONS) {
      const pcs = new Set(st.scale.map((s) => (st.root + s) % 12));
      for (let b = 0; b < 8; b++) {
        const bar = makeBar(st, b, 42);
        expect(bar.bass.length).toBe(16);
        expect(bar.lead.length).toBe(16);
        for (const n of [...bar.chord, ...bar.bass, ...bar.lead]) if (n !== null) expect(pcs.has(n % 12)).toBe(true);
      }
    }
  });

  it("is deterministic per seed and bar", () => {
    const st = STATIONS[0];
    expect(makeBar(st, 3, 9)).toEqual(makeBar(st, 3, 9));
    expect(makeBar(st, 3, 9).lead).not.toEqual(makeBar(st, 3, 10).lead);
  });

  it("maps pitches correctly", () => {
    expect(midiToHz(69)).toBeCloseTo(440);
    expect(midiToHz(57)).toBeCloseTo(220);
    expect(degree(60, [0, 2, 4, 5, 7, 9, 11], 7)).toBe(72);
    expect(chord(60, [0, 2, 4, 5, 7, 9, 11], 0)).toEqual([60, 64, 67]);
  });
});
