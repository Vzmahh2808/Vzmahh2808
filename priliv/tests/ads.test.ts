import { describe, expect, it } from "vitest";
import { AdPolicy, DOUBLE_CAP, FpsWatch, INTERSTITIAL_GAP, SESSION_GRACE, doubleBonus, revivable } from "../src/game/ads";

describe("ad policy", () => {
  it("keeps full-screen ads out of the first minutes of a session", () => {
    const p = new AdPolicy();
    expect(p.interstitialAllowed(10)).toBe(false);
    expect(p.interstitialAllowed(SESSION_GRACE - 1)).toBe(false);
    expect(p.interstitialAllowed(SESSION_GRACE)).toBe(true);
  });

  it("spaces ads out, counting rewarded ones too", () => {
    const p = new AdPolicy();
    p.noteAd(200);
    expect(p.interstitialAllowed(250)).toBe(false);
    expect(p.interstitialAllowed(200 + INTERSTITIAL_GAP)).toBe(true);
  });

  it("offers to double real rewards, capped, and never for taxi fares", () => {
    expect(doubleBonus("ch1-x", 800)).toBe(800);
    expect(doubleBonus("ch6-finale", 20000)).toBe(DOUBLE_CAP);
    expect(doubleBonus("taxi", 300)).toBe(0);
    expect(doubleBonus("race", 0)).toBe(0);
  });

  it("lets the player carry on after most deaths, but not from under water", () => {
    expect(revivable("Вы погибли")).toBe(true);
    expect(revivable("Вас застрелили")).toBe(true);
    expect(revivable("Вы утонули")).toBe(false);
    expect(revivable("Катер затонул")).toBe(false);
  });
});

describe("fps watch", () => {
  const run = (w: FpsWatch, fps: number, seconds: number) => {
    let fired = false;
    for (let t = 0; t < seconds; t += 1 / fps) fired = w.frame(1 / fps) || fired;
    return fired;
  };

  it("asks for lower settings once when the game stays slow", () => {
    const w = new FpsWatch();
    expect(run(w, 20, 12)).toBe(true);
    expect(run(w, 20, 12)).toBe(false);
  });

  it("leaves a smooth game alone, and ignores a slow start", () => {
    expect(run(new FpsWatch(), 55, 30)).toBe(false);
    const w = new FpsWatch();
    // Three slow seconds of loading, then smooth.
    expect(run(w, 10, 3)).toBe(false);
    expect(run(w, 50, 20)).toBe(false);
  });
});
