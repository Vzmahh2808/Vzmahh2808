import { readFileSync } from "node:fs";
import { Keypair, PublicKey, type Transaction } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { ArenaProgram } from "../src/chain/arena-program";
import { commitSecret, deriveTournamentSeed, fromHex, replayHash, toHex, verifyBundle, type TournamentBundle } from "../src/chain/tournament";
import { Game } from "../src/game/game";
import { replayOf, summarize } from "../src/game/replay";
import { SolanaTournamentBackend } from "../scripts/solana-tournament";

const fx = JSON.parse(readFileSync(new URL("./fixtures/arena-program.json", import.meta.url), "utf8"));
const program = new ArenaProgram();
const secret = new Uint8Array(32).fill(7);
const TOURNAMENT = new PublicKey(fx.pdas.tournament);

// Byte offsets in the fixture Tournament account (id "2026-10-01").
const AUTHORITY = 8;
const COMMITMENT = 128;
const RECORDED = 160;
const SLOT_HASH = 169;
const REVEALED = 201;
const STATUS = 271;

async function setup(opts: { recorded?: boolean; slot?: number } = {}) {
  const organizer = Keypair.generate();
  const data = Buffer.from(fromHex(fx.accounts.tournament.data));
  data.set(organizer.publicKey.toBytes(), AUTHORITY);
  data.set(await commitSecret(secret), COMMITMENT);
  if (opts.recorded === false) {
    // An open tournament whose seed slot has not been recorded yet.
    data[RECORDED] = 0;
    data.fill(0, SLOT_HASH, SLOT_HASH + 32);
    data[REVEALED] = 0;
    data[STATUS] = 0;
  }
  const accounts = new Map<string, Buffer>([[TOURNAMENT.toBase58(), data]]);
  const player = Keypair.generate().publicKey;
  accounts.set(program.entryAddress(TOURNAMENT, player).toBase58(), Buffer.from(fromHex(fx.accounts.entry.data)));
  const sent: { tx: Transaction; signers: Keypair[] }[] = [];
  const connection = {
    getAccountInfo: async (key: PublicKey) => {
      const d = accounts.get(key.toBase58());
      return d ? { data: d } : null;
    },
    getSlot: async () => opts.slot ?? 200_000_000,
  };
  const backend = new SolanaTournamentBackend({
    connection: connection as never,
    program,
    tournament: TOURNAMENT,
    organizer,
    secret,
    cacheMs: 0,
    send: async (tx, signers) => {
      sent.push({ tx, signers });
      // Play the program's part for record_slot_hash.
      if (toHex(tx.instructions[0].data) === toHex(program.recordSlotHash(TOURNAMENT).data)) {
        data[RECORDED] = 1;
        data.fill(0x44, SLOT_HASH, SLOT_HASH + 32);
      }
      return `sig-${sent.length}`;
    },
  });
  return { backend, organizer, player, sent, data };
}

describe("SolanaTournamentBackend", () => {
  it("checks the organizer key and the secret against the account", async () => {
    const { backend } = await setup();
    await expect(backend.check()).resolves.toBeTruthy();
    const other = new SolanaTournamentBackend({ ...(backend as unknown as { o: object }).o, secret: new Uint8Array(32) } as never);
    await expect(other.check()).rejects.toThrow("секрет");
    const stranger = new SolanaTournamentBackend({ ...(backend as unknown as { o: object }).o, organizer: Keypair.generate() } as never);
    await expect(stranger.check()).rejects.toThrow("организатором");
  });

  it("reports the tournament and derives the seed from the recorded slot hash", async () => {
    const { backend } = await setup();
    const info = await backend.info();
    expect(info).toMatchObject({ address: TOURNAMENT.toBase58(), id: "2026-10-01", attemptsPerEntry: 3, seedReady: true, revealed: true });
    expect(info.leaderboard).toEqual([
      { player: fx.accounts.tournament.leaderboard[0][0], score: 900 },
      { player: fx.accounts.tournament.leaderboard[1][0], score: 450 },
    ]);
    expect(await backend.seed()).toBe(await deriveTournamentSeed(TOURNAMENT.toBase58(), new Uint8Array(32).fill(0x33), secret));
  });

  it("records the slot hash itself once the seed slot has passed", async () => {
    const early = await setup({ recorded: false, slot: 100 });
    expect(await early.backend.seed()).toBeNull();
    expect(early.sent).toHaveLength(0);

    const late = await setup({ recorded: false, slot: 200_000_000 });
    expect(await late.backend.seed()).toBe(await deriveTournamentSeed(TOURNAMENT.toBase58(), new Uint8Array(32).fill(0x44), secret));
    expect(late.sent).toHaveLength(1);
    expect(late.sent[0].signers[0]).toBe(late.organizer);
  });

  it("reads entries and posts results signed by the organizer", async () => {
    const { backend, player, sent, organizer } = await setup();
    expect(await backend.attemptsUsed(player.toBase58())).toBe(2);
    expect(await backend.attemptsUsed(Keypair.generate().publicKey.toBase58())).toBeNull();
    const hash = new Uint8Array(32).fill(9);
    expect(await backend.submit(player.toBase58(), 321, hash)).toBe("sig-1");
    const expected = program.submitResult(organizer.publicKey, TOURNAMENT, player, 321n, hash);
    expect(toHex(sent[0].tx.instructions[0].data)).toBe(toHex(expected.data));
    expect(sent[0].tx.instructions[0].keys.map((k) => k.pubkey.toBase58())).toEqual(expected.keys.map((k) => k.pubkey.toBase58()));
  });
});

describe("verifyBundle", () => {
  it("accepts honest runs and flags edited ones", async () => {
    const tournament = TOURNAMENT.toBase58();
    const slotHash = new Uint8Array(32).fill(0x33);
    const seed = await deriveTournamentSeed(tournament, slotHash, secret);
    const g = Game.newGame(seed);
    g.wait();
    g.wait();
    const replay = replayOf(g)!;
    const hash = toHex(await replayHash(replay));
    const score = summarize(g).score;
    const otherGame = Game.newGame(seed + 1);
    otherGame.wait();
    const otherReplay = replayOf(otherGame)!;
    const bundle: TournamentBundle = {
      tournament,
      slotHash: toHex(slotHash),
      secret: toHex(secret),
      runs: [
        { player: "honest", score, replayHash: hash, replay },
        { player: "inflated", score: score + 1, replayHash: hash, replay },
        { player: "swapped", score, replayHash: "00".repeat(32), replay },
        { player: "wrong-seed", score: summarize(otherGame).score, replayHash: toHex(await replayHash(otherReplay)), replay: otherReplay },
      ],
    };
    const check = await verifyBundle(bundle);
    expect(check.seed).toBe(seed);
    expect(check.runs.map((r) => [r.player, r.ok])).toEqual([
      ["honest", true],
      ["inflated", false],
      ["swapped", false],
      ["wrong-seed", false],
    ]);
  });
});
