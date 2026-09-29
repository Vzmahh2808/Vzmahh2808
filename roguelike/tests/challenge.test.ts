import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  SKIP_WINDOW,
  confirmOnChain,
  dayId,
  deriveSeed,
  estimateSlotAt,
  parseChallenges,
  resolveChallenge,
  verifyChallengeRun,
  type ChallengeReplay,
  type ResolvedChallenge,
} from "../src/chain/challenge";
import { RpcError, SolanaRpc, type BlockInfo, type ChainReader } from "../src/chain/rpc";
import { Game } from "../src/game/game";
import { replayOf } from "../src/game/replay";

const HASH_A = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const HASH_B = "4sGjMW1sUnHzSxGspuhpqLDx6wiyjNtZAMdL4VZHirAn";

/** A fake chain: `blocks` maps produced slots to hashes, everything up to `finalized` is final. */
function fakeChain(finalized: number, blocks: Record<number, string>): ChainReader & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async getSlot() {
      calls.push("getSlot");
      return finalized;
    },
    async getBlocks(start, end) {
      calls.push(`getBlocks ${start}-${end}`);
      return Object.keys(blocks)
        .map(Number)
        .filter((s) => s >= start && s <= end && s <= finalized)
        .sort((a, b) => a - b);
    },
    async getBlock(slot): Promise<BlockInfo> {
      calls.push(`getBlock ${slot}`);
      const blockhash = blocks[slot];
      if (!blockhash) throw new Error(`no block at ${slot}`);
      return { blockhash, blockTime: 0 };
    },
  };
}

describe("deriveSeed", () => {
  it("is the first four bytes of sha256 over the domain, id and block hash", async () => {
    const expected = createHash("sha256").update(`dungeon-heart:v1:2026-09-25:${HASH_A}`).digest().readUInt32BE(0);
    expect(await deriveSeed("2026-09-25", HASH_A)).toBe(expected);
  });

  it("changes with the challenge id and with the block hash", async () => {
    const base = await deriveSeed("2026-09-25", HASH_A);
    expect(await deriveSeed("2026-09-26", HASH_A)).not.toBe(base);
    expect(await deriveSeed("2026-09-25", HASH_B)).not.toBe(base);
  });
});

describe("resolveChallenge", () => {
  it("waits while the announced slot is not finalized", async () => {
    const r = await resolveChallenge(fakeChain(990, { 1000: HASH_A }), { id: "d", slot: 1000 });
    expect(r).toEqual({ state: "pending", slotsLeft: 10 });
  });

  it("uses the announced slot when it has a block", async () => {
    const r = await resolveChallenge(fakeChain(1200, { 1000: HASH_A, 1001: HASH_B }), { id: "d", slot: 1000 });
    expect(r).toEqual({
      state: "ready",
      challenge: { id: "d", slot: 1000, blockSlot: 1000, blockhash: HASH_A, seed: await deriveSeed("d", HASH_A) },
    });
  });

  it("falls through skipped slots to the next block", async () => {
    const r = await resolveChallenge(fakeChain(1200, { 999: HASH_A, 1003: HASH_B }), { id: "d", slot: 1000 });
    expect(r.state === "ready" && r.challenge.blockSlot).toBe(1003);
  });

  it("keeps waiting when the window is still open and empty", async () => {
    const r = await resolveChallenge(fakeChain(1010, {}), { id: "d", slot: 1000 });
    expect(r).toEqual({ state: "pending", slotsLeft: 1 });
  });

  it("fails when a whole window of slots produced no block", async () => {
    await expect(resolveChallenge(fakeChain(1000 + SKIP_WINDOW + 5, {}), { id: "d", slot: 1000 })).rejects.toThrow("объявить заново");
  });

  it("confirms a genuine block and rejects a substituted one", async () => {
    const chain = fakeChain(1200, { 1000: HASH_A });
    const r = await resolveChallenge(chain, { id: "d", slot: 1000 });
    if (r.state !== "ready") throw new Error("expected ready");
    expect(await confirmOnChain(chain, r.challenge)).toBe(true);
    const forged: ResolvedChallenge = { ...r.challenge, blockhash: HASH_B, seed: await deriveSeed("d", HASH_B) };
    expect(await confirmOnChain(chain, forged)).toBe(false);
  });
});

describe("verifyChallengeRun", () => {
  async function submission(): Promise<ChallengeReplay> {
    const seed = await deriveSeed("2026-09-25", HASH_A);
    const challenge: ResolvedChallenge = { id: "2026-09-25", slot: 1000, blockSlot: 1000, blockhash: HASH_A, seed };
    const g = Game.newGame(seed);
    g.wait();
    g.wait();
    return { ...replayOf(g)!, challenge };
  }

  it("accepts a run played on the challenge seed", async () => {
    const result = await verifyChallengeRun(await submission());
    expect(result.ok && result.summary.turns).toBe(2);
  });

  it("rejects a run played on another seed", async () => {
    const s = await submission();
    const g = Game.newGame(s.seed + 1);
    g.wait();
    expect(await verifyChallengeRun({ ...replayOf(g)!, challenge: s.challenge })).toMatchObject({ ok: false, action: -1 });
  });

  it("rejects a challenge whose seed does not follow from the block hash", async () => {
    const s = await submission();
    expect(await verifyChallengeRun({ ...s, challenge: { ...s.challenge, blockhash: HASH_B } })).toMatchObject({ ok: false });
  });

  it("rejects a missing or malformed challenge", async () => {
    const s = await submission();
    expect(await verifyChallengeRun({ ...s, challenge: undefined as unknown as ResolvedChallenge })).toMatchObject({ ok: false });
    expect(await verifyChallengeRun({ ...s, challenge: { ...s.challenge, blockSlot: 999 } })).toMatchObject({ ok: false });
  });
});

describe("helpers", () => {
  it("extrapolates future slots at 400 ms per slot", () => {
    expect(estimateSlotAt({ slot: 1000, timeMs: 0 }, 60_000)).toBe(1150);
    expect(estimateSlotAt({ slot: 1000, timeMs: 0 }, 1)).toBe(1001);
  });

  it("names challenges by UTC day", () => {
    expect(dayId(new Date("2026-09-25T23:59:59Z"))).toBe("2026-09-25");
  });

  it("validates announcement lists", () => {
    expect(parseChallenges([{ id: "2026-09-25", slot: 5 }])).toEqual([{ id: "2026-09-25", slot: 5 }]);
    expect(() => parseChallenges({})).toThrow();
    expect(() => parseChallenges([{ id: "bad id", slot: 5 }])).toThrow();
    expect(() => parseChallenges([{ id: "ok", slot: -1 }])).toThrow();
  });
});

describe("SolanaRpc", () => {
  it("sends finalized JSON-RPC requests and unwraps results", async () => {
    const bodies: unknown[] = [];
    const rpc = new SolanaRpc("https://rpc.test", async (_url, init) => {
      const body = JSON.parse(init.body);
      bodies.push(body);
      const result = body.method === "getBlock" ? { blockhash: HASH_A, blockTime: 1 } : body.method === "getBlocks" ? [7, 8] : 42;
      return { ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", id: body.id, result }) };
    });
    expect(await rpc.getSlot()).toBe(42);
    expect(await rpc.getBlocks(7, 9)).toEqual([7, 8]);
    expect(await rpc.getBlock(7)).toEqual({ blockhash: HASH_A, blockTime: 1 });
    expect(bodies[0]).toMatchObject({ method: "getSlot", params: [{ commitment: "finalized" }] });
    expect(bodies[2]).toMatchObject({ method: "getBlock", params: [7, { commitment: "finalized", transactionDetails: "none" }] });
  });

  it("turns RPC and HTTP errors into RpcError", async () => {
    const failing = new SolanaRpc("https://rpc.test", async () => ({
      ok: true,
      status: 200,
      json: async () => ({ error: { code: -32009, message: "Slot 5 was skipped" } }),
    }));
    await expect(failing.getBlock(5)).rejects.toBeInstanceOf(RpcError);
    const down = new SolanaRpc("https://rpc.test", async () => ({ ok: false, status: 429, json: async () => ({}) }));
    await expect(down.getSlot()).rejects.toThrow("HTTP 429");
  });
});
