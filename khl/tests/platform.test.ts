import { describe, expect, it } from "vitest";
import { AdPolicy, BOOST_POINTS, INTERSTITIAL_GAP, SESSION_GRACE, boosted } from "../src/game/ads";
import { newerPack, parsePack, type Pack } from "../src/game/persist";
import { chunkKeys, chunkString, detectPlatform, joinChunks } from "../src/platform/sync";
import { zip } from "../src/tools/zip";

const pack = (savedAt: number, extra: Partial<Pack> = {}): string => JSON.stringify({ v: 1, savedAt, season: null, settings: null, ...extra });

describe("platform detection", () => {
  const page = (o: Partial<{ search: string; hash: string; hostname: string }> = {}) => ({ search: "", hash: "", hostname: "example.github.io", ...o });
  it("tells Telegram, Yandex and the plain web apart", () => {
    expect(detectPlatform(page())).toBe("web");
    expect(detectPlatform(page({ hash: "#tgWebAppData=abc" }))).toBe("telegram");
    expect(detectPlatform(page({ hostname: "khl-123.games.s3.yandex.net" }))).toBe("yandex");
    expect(detectPlatform(page({ hostname: "yandex.ru" }))).toBe("yandex");
    expect(detectPlatform(page({ hostname: "notyandex.example.com" }))).toBe("web");
    expect(detectPlatform(page({ search: "?platform=yandex" }))).toBe("yandex");
  });
});

describe("cloud chunks", () => {
  it("splits and rejoins a save that is bigger than one Telegram value", () => {
    const big = "x".repeat(9500) + "é" + "y".repeat(400);
    const parts = chunkString(big);
    expect(Object.keys(parts).length).toBe(4);
    for (const [k, v] of Object.entries(parts)) if (k !== "sn") expect(v.length).toBeLessThanOrEqual(4000);
    expect(joinChunks(parts, parts.sn)).toBe(big);
    expect(chunkKeys(parts.sn)).toEqual(["s0", "s1", "s2"]);
  });
  it("refuses a half-written save", () => {
    const parts = chunkString("a".repeat(9000));
    delete parts.s1;
    expect(joinChunks(parts, parts.sn)).toBeNull();
    expect(joinChunks({}, "0")).toBeNull();
    expect(joinChunks({}, "9999")).toBeNull();
  });
});

describe("choosing the save", () => {
  it("takes the newer pack and prefers local on a tie", () => {
    expect(newerPack(pack(5), pack(9))).toBe(pack(9));
    expect(newerPack(pack(9), pack(5))).toBe(pack(9));
    expect(newerPack(pack(7, { settings: "a" }), pack(7, { settings: "b" }))).toBe(pack(7, { settings: "a" }));
  });
  it("a broken or missing pack loses to a valid one", () => {
    expect(newerPack(null, pack(3))).toBe(pack(3));
    expect(newerPack(pack(3), "garbage")).toBe(pack(3));
    expect(newerPack("garbage", null)).toBeNull();
    expect(newerPack(null, null)).toBeNull();
  });
  it("validates the pack shape", () => {
    expect(parsePack(pack(1))).not.toBeNull();
    expect(parsePack(JSON.stringify({ v: 2, savedAt: 1, season: null, settings: null }))).toBeNull();
    expect(parsePack(JSON.stringify({ v: 1, savedAt: "now", season: null, settings: null }))).toBeNull();
    expect(parsePack(JSON.stringify({ v: 1, savedAt: 1, season: 5, settings: null }))).toBeNull();
    expect(parsePack(undefined)).toBeNull();
  });
});

describe("ads", () => {
  it("keeps full-screen ads out of the first minutes and apart from each other", () => {
    const p = new AdPolicy();
    expect(p.interstitialAllowed(SESSION_GRACE - 1)).toBe(false);
    expect(p.interstitialAllowed(SESSION_GRACE)).toBe(true);
    p.noteAd(SESSION_GRACE);
    expect(p.interstitialAllowed(SESSION_GRACE + INTERSTITIAL_GAP - 1)).toBe(false);
    expect(p.interstitialAllowed(SESSION_GRACE + INTERSTITIAL_GAP)).toBe(true);
  });
  it("rewarded ads need only a short breather", () => {
    const p = new AdPolicy();
    expect(p.rewardAllowed(0)).toBe(true);
    p.noteAd(10, true);
    expect(p.rewardAllowed(20)).toBe(false);
    expect(p.rewardAllowed(200)).toBe(true);
    // A full-screen ad does not block a rewarded one.
    const q = new AdPolicy();
    q.noteAd(50, false);
    expect(q.rewardAllowed(51)).toBe(true);
  });
  it("the boost adds points and caps at 99", () => {
    const b = boosted({ off: 70, def: 96, gk: 80, spd: 99 });
    expect(b).toEqual({ off: 70 + BOOST_POINTS, def: 99, gk: 80 + BOOST_POINTS, spd: 99 });
  });
});

describe("zip", () => {
  it("writes a valid archive with the entries in order", () => {
    const bytes = zip([
      { name: "index.html", data: new TextEncoder().encode("<html></html>") },
      { name: "assets/a.js", data: new TextEncoder().encode("1") },
    ]);
    // Local file header signature at the start, end-of-central-directory at the end.
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const tail = bytes.slice(bytes.length - 22);
    expect(Array.from(tail.slice(0, 4))).toEqual([0x50, 0x4b, 0x05, 0x06]);
    expect(tail[10]).toBe(2); // two entries
  });
});
