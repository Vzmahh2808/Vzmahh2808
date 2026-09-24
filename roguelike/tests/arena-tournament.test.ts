import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { Keypair } from "@solana/web3.js";
import { afterEach, describe, expect, it } from "vitest";
import { greedyChoice } from "../src/agent/greedy";
import type { Observation } from "../src/agent/observe";
import { replayHash, toHex } from "../src/chain/tournament";
import { verifyReplay, type Replay } from "../src/game/replay";
import { createArenaServer, type ArenaOptions, type PublishedRun } from "../scripts/arena-server";
import { signWithWallet, verifyWalletSignature, type TournamentBackend, type TournamentInfo } from "../scripts/arena-tournament";

class FakeBackend implements TournamentBackend {
  address = Keypair.generate().publicKey.toBase58();
  endTs = 2_000_000_000;
  attemptsPerEntry = 2;
  seedValue: number | null = 777;
  revealed = false;
  attempts = new Map<string, number>();
  submitted: { player: string; score: number; hash: string }[] = [];
  failNext = false;

  async info(): Promise<TournamentInfo> {
    return {
      address: this.address,
      id: "test",
      endTs: this.endTs,
      attemptsPerEntry: this.attemptsPerEntry,
      seedReady: this.seedValue !== null,
      revealed: this.revealed,
      leaderboard: [],
    };
  }
  async seed() {
    return this.seedValue;
  }
  async attemptsUsed(player: string) {
    return this.attempts.has(player) ? this.attempts.get(player)! : null;
  }
  async submit(player: string, score: number, hash: Uint8Array) {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("RPC недоступен");
    }
    this.submitted.push({ player, score, hash: toHex(hash) });
    this.attempts.set(player, (this.attempts.get(player) ?? 0) + 1);
    return `sig-${this.submitted.length}`;
  }
}

interface RunState {
  id: string;
  done: boolean;
  observation: Observation;
  submission?: { status: string; signature?: string; error?: string } | null;
  error?: string;
}

let server: Server | undefined;
let base = "";

async function start(options: ArenaOptions): Promise<void> {
  server = createArenaServer(options);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

afterEach(() => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())));

async function call<T = RunState>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const res = await fetch(base + path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, data: (await res.json()) as T };
}

async function startRun(wallet: Keypair, signer: Keypair = wallet) {
  const { data } = await call<{ nonce: string; message: string }>("POST", "/tournament/challenge", { player: wallet.publicKey.toBase58() });
  return call("POST", "/tournament/runs", { nonce: data.nonce, signature: signWithWallet(data.message, signer) });
}

async function playOut(run: RunState): Promise<RunState> {
  while (!run.done) run = (await call("POST", `/runs/${run.id}/actions`, { action: greedyChoice(run.observation) })).data;
  return run;
}

async function waitFor(check: () => boolean | Promise<boolean>): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("condition not met in time");
}

describe("wallet signatures", () => {
  it("verify only for the signing wallet and the exact message", () => {
    const wallet = Keypair.generate();
    const sig = signWithWallet("hello", wallet);
    expect(verifyWalletSignature("hello", sig, wallet.publicKey.toBase58())).toBe(true);
    expect(verifyWalletSignature("hello!", sig, wallet.publicKey.toBase58())).toBe(false);
    expect(verifyWalletSignature("hello", sig, Keypair.generate().publicKey.toBase58())).toBe(false);
    expect(verifyWalletSignature("hello", "garbage", "not a key")).toBe(false);
  });
});

describe("tournament mode", () => {
  it("plays a paid attempt, posts the result and keeps the replay private until the reveal", async () => {
    const fake = new FakeBackend();
    const runs: PublishedRun[] = [];
    await start({ tournament: fake, limits: { maxTurns: 200 }, onTournamentRun: (r) => runs.push(r) });
    const wallet = Keypair.generate();
    fake.attempts.set(wallet.publicKey.toBase58(), 0);

    const info = await call<TournamentInfo>("GET", "/tournament");
    expect(info.data).toMatchObject({ address: fake.address, attemptsPerEntry: 2, seedReady: true });

    const created = await startRun(wallet);
    expect(created.status).toBe(201);
    expect(JSON.stringify(created.data)).not.toMatch(/"seed"|777/);
    expect(created.data.submission).toBeNull();

    const finished = await playOut(created.data);
    await waitFor(() => fake.submitted.length === 1);
    const { data: after } = await call("GET", `/runs/${finished.id}`);
    expect(after.submission).toEqual({ status: "submitted", signature: "sig-1" });

    const hidden = await call<{ replay?: Replay; replayHash: string; summary: { score: number } }>("GET", `/runs/${finished.id}/replay`);
    expect(hidden.data.replay).toBeUndefined();
    expect(JSON.stringify(hidden.data)).not.toContain('"seed"');
    expect(fake.submitted[0]).toEqual({ player: wallet.publicKey.toBase58(), score: hidden.data.summary.score, hash: hidden.data.replayHash });
    expect((await call("GET", "/tournament/replays")).status).toBe(403);

    fake.revealed = true;
    const shown = await call<{ replay: Replay; replayHash: string; summary: unknown }>("GET", `/runs/${finished.id}/replay`);
    expect(shown.data.replay.seed).toBe(777);
    expect(verifyReplay(shown.data.replay)).toEqual({ ok: true, summary: shown.data.summary });
    expect(toHex(await replayHash(shown.data.replay))).toBe(shown.data.replayHash);
    const published = await call<PublishedRun[]>("GET", "/tournament/replays");
    expect(published.data).toHaveLength(1);
    expect(runs).toHaveLength(1);
    expect(runs[0].replayHash).toBe(fake.submitted[0].hash);
  });

  it("rejects bad signatures, reused nonces and wallets without an entry", async () => {
    const fake = new FakeBackend();
    await start({ tournament: fake });
    const wallet = Keypair.generate();
    fake.attempts.set(wallet.publicKey.toBase58(), 0);

    expect((await startRun(wallet, Keypair.generate())).status).toBe(401);
    const { data } = await call<{ nonce: string; message: string }>("POST", "/tournament/challenge", { player: wallet.publicKey.toBase58() });
    const signature = signWithWallet(data.message, wallet);
    expect((await call("POST", "/tournament/runs", { nonce: data.nonce, signature })).status).toBe(201);
    expect((await call("POST", "/tournament/runs", { nonce: data.nonce, signature })).status).toBe(401);
    expect((await call("POST", "/tournament/challenge", { player: "not-a-wallet" })).status).toBe(400);
    expect((await startRun(Keypair.generate())).status).toBe(403);
  });

  it("refuses runs before the seed is fixed and after the end", async () => {
    const fake = new FakeBackend();
    let clock = 1_000_000;
    await start({ tournament: fake, now: () => clock });
    const wallet = Keypair.generate();
    fake.attempts.set(wallet.publicKey.toBase58(), 0);

    fake.seedValue = null;
    expect((await startRun(wallet)).status).toBe(409);
    fake.seedValue = 5;
    clock = (fake.endTs + 1) * 1000;
    const late = await startRun(wallet);
    expect(late.status).toBe(403);
    expect(late.data.error).toContain("окончен");
  });

  it("counts an attempt from the moment a run starts, even if posting the result fails", async () => {
    const fake = new FakeBackend();
    await start({ tournament: fake, limits: { maxTurns: 50 } });
    const wallet = Keypair.generate();
    fake.attempts.set(wallet.publicKey.toBase58(), 0);

    const first = await startRun(wallet);
    expect(first.status).toBe(201);
    fake.failNext = true;
    const ended = await playOut(first.data);
    await waitFor(async () => (await call("GET", `/runs/${ended.id}`)).data.submission?.status === "failed");
    expect(fake.submitted).toHaveLength(0);

    expect((await startRun(wallet)).status).toBe(201);
    const third = await startRun(wallet);
    expect(third.status).toBe(403);
    expect(third.data.error).toContain("попытки");
  });

  it("submits an abandoned run as it stands once it goes idle", async () => {
    const fake = new FakeBackend();
    let clock = 1_000_000;
    await start({ tournament: fake, idleMs: 60_000, now: () => clock });
    const wallet = Keypair.generate();
    fake.attempts.set(wallet.publicKey.toBase58(), 0);

    const run = (await startRun(wallet)).data;
    await call("POST", `/runs/${run.id}/actions`, { action: "5" });
    clock += 120_000;
    await call("POST", "/runs", { seed: 1 });
    await waitFor(() => fake.submitted.length === 1);
    expect(fake.submitted[0].player).toBe(wallet.publicKey.toBase58());
    expect((await call("GET", `/runs/${run.id}`)).status).toBe(404);
  });

  it("has no tournament endpoints without a backend", async () => {
    await start({});
    expect((await call("GET", "/tournament")).status).toBe(404);
  });
});
