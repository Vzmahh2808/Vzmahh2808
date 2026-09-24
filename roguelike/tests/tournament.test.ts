import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalReplay, commitSecret, deriveTournamentSeed, fromHex, replayHash, toHex } from "../src/chain/tournament";

const TOURNAMENT = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const slotHash = new Uint8Array(32).fill(3);
const secret = new Uint8Array(32).fill(7);

describe("on-chain tournament helpers", () => {
  it("commits to a secret the way the program checks it", async () => {
    const expected = createHash("sha256").update(secret).digest();
    expect(toHex(await commitSecret(secret))).toBe(expected.toString("hex"));
    await expect(commitSecret(new Uint8Array(31))).rejects.toThrow();
  });

  it("derives the seed from the tournament, the slot hash and the secret", async () => {
    const text = `dungeon-heart:v2:${TOURNAMENT}:${"03".repeat(32)}:${"07".repeat(32)}`;
    const expected = createHash("sha256").update(text).digest().readUInt32BE(0);
    expect(await deriveTournamentSeed(TOURNAMENT, slotHash, secret)).toBe(expected);
    expect(await deriveTournamentSeed(TOURNAMENT, slotHash, new Uint8Array(32).fill(8))).not.toBe(expected);
    expect(await deriveTournamentSeed(TOURNAMENT, new Uint8Array(32).fill(4), secret)).not.toBe(expected);
  });

  it("hashes replays in a fixed field order", async () => {
    const a = { rules: 1, seed: 5, actions: "66g>" };
    const b = { actions: "66g>", seed: 5, rules: 1 };
    expect(canonicalReplay(b)).toBe('{"rules":1,"seed":5,"actions":"66g>"}');
    expect(toHex(await replayHash(a))).toBe(toHex(await replayHash(b)));
    expect(toHex(await replayHash(a))).toBe(createHash("sha256").update(canonicalReplay(a)).digest("hex"));
  });

  it("round-trips hex", () => {
    expect(toHex(fromHex("00ff10"))).toBe("00ff10");
    expect(() => fromHex("abc")).toThrow();
  });
});
