/**
 * On-chain tournament commands. RPC: --rpc or SOLANA_RPC (default devnet); wallet: --keypair
 * (default ~/.config/solana/id.json). The organizer's secret and finished runs are kept in
 * .arena/ (git-ignored): losing the secret means the tournament can only be cancelled.
 *
 * Organizer:
 *   create   --id ID --mint MINT [--fee 1] [--attempts 3] [--start-in 10] [--hours 24] [--rake-bps 500] [--payout 6000,3000,1000,0,0]
 *   record   --tournament T            write the seed slot hash (serve does it automatically)
 *   serve    --tournament T [--port 8787]
 *   reveal   --tournament T
 *   finalize --tournament T
 *   publish  --tournament T --out bundle.json
 * Player:
 *   enter | claim | refund --tournament T
 * Anyone:
 *   status   --tournament T
 *   cancel   --tournament T            after the reveal deadline without a reveal
 *   verify   --tournament T --bundle bundle.json
 */
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { Connection, Keypair, PublicKey, sendAndConfirmTransaction, Transaction, type TransactionInstruction } from "@solana/web3.js";
import {
  ARENA_PROGRAM_ID,
  ArenaProgram,
  arenaErrorName,
  associatedTokenAddress,
  createAssociatedTokenAccountIdempotent,
  decodeEntry,
  decodeTournament,
  mintDecimals,
  SUBMIT_GRACE_SECS,
  TOKEN_PROGRAM_ID,
  type TokenContext,
} from "../src/chain/arena-program";
import { commitSecret, fromHex, toHex, verifyBundle, type TournamentBundle } from "../src/chain/tournament";
import { RULES_VERSION } from "../src/game/replay";
import { createArenaServer, type PublishedRun } from "./arena-server";
import { SolanaTournamentBackend } from "./solana-tournament";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    rpc: { type: "string" },
    keypair: { type: "string" },
    program: { type: "string" },
    state: { type: "string", default: ".arena" },
    tournament: { type: "string" },
    id: { type: "string" },
    mint: { type: "string" },
    "token-program": { type: "string" },
    fee: { type: "string", default: "1" },
    attempts: { type: "string", default: "3" },
    "start-in": { type: "string", default: "10" },
    hours: { type: "string", default: "24" },
    "reveal-hours": { type: "string", default: "24" },
    "rake-bps": { type: "string", default: "500" },
    payout: { type: "string", default: "6000,3000,1000,0,0" },
    port: { type: "string", default: "8787" },
    out: { type: "string" },
    bundle: { type: "string" },
  },
});

const connection = new Connection(values.rpc ?? process.env.SOLANA_RPC ?? "https://api.devnet.solana.com", "confirmed");
const program = new ArenaProgram(values.program ? new PublicKey(values.program) : ARENA_PROGRAM_ID);

interface SavedTournament {
  tournament: string;
  id: string;
  programId: string;
  mint: string;
  tokenProgram: string;
  secret: string;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function wallet(): Keypair {
  const path = values.keypair ?? join(homedir(), ".config/solana/id.json");
  if (!existsSync(path)) fail(`нет файла кошелька ${path}: укажите --keypair`);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8")) as number[]));
}

function tournamentKey(): PublicKey {
  if (!values.tournament) fail("укажите --tournament");
  return new PublicKey(values.tournament);
}

const statePath = (t: PublicKey, suffix: string) => join(values.state!, `${t.toBase58()}${suffix}`);

function loadSaved(t: PublicKey): SavedTournament {
  const path = statePath(t, ".json");
  if (!existsSync(path)) fail(`нет ${path}: секрет хранится только на машине, где турнир создан`);
  return JSON.parse(readFileSync(path, "utf8")) as SavedTournament;
}

async function account(t: PublicKey) {
  const info = await connection.getAccountInfo(t);
  if (!info) fail(`турнир ${t.toBase58()} не найден`);
  return decodeTournament(info.data);
}

async function tokenContext(mint: PublicKey): Promise<TokenContext> {
  const info = await connection.getAccountInfo(mint);
  if (!info) fail(`mint ${mint.toBase58()} не найден`);
  return { mint, tokenProgram: info.owner };
}

async function send(signer: Keypair, ...ixs: TransactionInstruction[]): Promise<string> {
  try {
    return await sendAndConfirmTransaction(connection, new Transaction().add(...ixs), [signer], { commitment: "confirmed" });
  } catch (e) {
    const text = e instanceof Error ? e.message : String(e);
    const code = /custom program error: 0x([0-9a-f]+)/i.exec(text);
    fail(code ? `контракт отклонил транзакцию: ${arenaErrorName(parseInt(code[1], 16)) ?? code[1]}` : text);
  }
}

function toUnits(amount: string, decimals: number): bigint {
  const [whole, frac = ""] = amount.split(".");
  if (!/^\d+$/.test(whole) || !/^\d*$/.test(frac) || frac.length > decimals) fail(`неверная сумма ${amount}`);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0");
}

const json = (v: unknown) =>
  JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x instanceof PublicKey ? x.toBase58() : x instanceof Uint8Array ? toHex(x) : x), 2);

const commands: Record<string, () => Promise<void>> = {
  async create() {
    const organizer = wallet();
    if (!values.id || !values.mint) fail("нужны --id и --mint");
    const mint = new PublicKey(values.mint);
    const token = await tokenContext(mint);
    const decimals = mintDecimals((await connection.getAccountInfo(mint))!.data);
    const secret = randomBytes(32);
    const slot = BigInt(await connection.getSlot("confirmed"));
    const now = BigInt(Math.floor(Date.now() / 1000));
    const endTs = now + BigInt(Math.round(Number(values.hours) * 3600));
    const payoutBps = values.payout!.split(",").map(Number);
    const tournament = program.tournamentAddress(organizer.publicKey, values.id);

    // Save the secret before anything reaches the chain.
    mkdirSync(values.state!, { recursive: true });
    const saved: SavedTournament = {
      tournament: tournament.toBase58(),
      id: values.id,
      programId: program.programId.toBase58(),
      mint: mint.toBase58(),
      tokenProgram: (token.tokenProgram ?? TOKEN_PROGRAM_ID).toBase58(),
      secret: toHex(secret),
    };
    writeFileSync(statePath(tournament, ".json"), JSON.stringify(saved, null, 2), { mode: 0o600 });

    const signature = await send(
      organizer,
      program.createTournament(organizer.publicKey, token, {
        id: values.id,
        rulesVersion: RULES_VERSION,
        seedSlot: slot + BigInt(Math.ceil((Number(values["start-in"]) * 60) / 0.4)),
        secretCommitment: await commitSecret(secret),
        entryFee: toUnits(values.fee!, decimals),
        attemptsPerEntry: Number(values.attempts),
        endTs,
        revealDeadlineTs: endTs + BigInt(SUBMIT_GRACE_SECS) + BigInt(Math.round(Number(values["reveal-hours"]) * 3600)),
        rakeBps: Number(values["rake-bps"]),
        payoutBps,
      }),
    );
    console.log(json({ tournament, signature, secretSavedIn: statePath(tournament, ".json") }));
  },

  async record() {
    const t = tournamentKey();
    console.log(await send(wallet(), program.recordSlotHash(t)));
  },

  async serve() {
    const t = tournamentKey();
    const saved = loadSaved(t);
    const backend = new SolanaTournamentBackend({ connection, program, tournament: t, organizer: wallet(), secret: fromHex(saved.secret) });
    await backend.check();
    const tick = () => backend.ensureSlotHash().catch((e: unknown) => console.error("запись хеша слота:", e instanceof Error ? e.message : e));
    await tick();
    setInterval(tick, 10_000).unref();
    const runsFile = statePath(t, ".runs.jsonl");
    createArenaServer({
      tournament: backend,
      onTournamentRun: (run: PublishedRun) => appendFileSync(runsFile, JSON.stringify(run) + "\n"),
    }).listen(Number(values.port), () => console.log(`Турнир ${saved.id} (${t.toBase58()}): арена на http://localhost:${values.port}`));
  },

  async reveal() {
    const t = tournamentKey();
    console.log(await send(wallet(), program.reveal(wallet().publicKey, t, fromHex(loadSaved(t).secret))));
  },

  async finalize() {
    const t = tournamentKey();
    const a = await account(t);
    const token = await tokenContext(a.mint);
    const payer = wallet();
    console.log(
      await send(
        payer,
        createAssociatedTokenAccountIdempotent(payer.publicKey, a.authority, a.mint, token.tokenProgram),
        program.finalize(t, token, associatedTokenAddress(a.authority, a.mint, token.tokenProgram)),
      ),
    );
  },

  async publish() {
    const t = tournamentKey();
    const a = await account(t);
    if (!a.revealed) fail("сначала раскройте секрет (reveal)");
    const path = statePath(t, ".runs.jsonl");
    const runs = existsSync(path) ? readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as PublishedRun) : [];
    const bundle: TournamentBundle = {
      tournament: t.toBase58(),
      slotHash: toHex(a.slotHash),
      secret: toHex(a.secret),
      runs: runs.map(({ player, score, replayHash, replay }) => ({ player, score, replayHash, replay })),
    };
    writeFileSync(values.out ?? `${t.toBase58()}.bundle.json`, JSON.stringify(bundle));
    console.log(`опубликовано партий: ${runs.length}`);
  },

  async enter() {
    await playerAction((player, t, token, playerToken) => program.enter(player, t, token, playerToken));
  },
  async claim() {
    await playerAction((player, t, token, playerToken) => program.claim(player, t, token, playerToken), true);
  },
  async refund() {
    await playerAction((player, t, token, playerToken) => program.refund(player, t, token, playerToken), true);
  },

  async cancel() {
    console.log(await send(wallet(), program.cancel(wallet().publicKey, tournamentKey())));
  },

  async status() {
    const t = tournamentKey();
    const a = await account(t);
    console.log(json({ address: t, ...a, secret: a.revealed ? a.secret : "(скрыт)" }));
  },

  async verify() {
    const t = tournamentKey();
    if (!values.bundle) fail("укажите --bundle");
    const bundle = JSON.parse(readFileSync(values.bundle, "utf8")) as TournamentBundle;
    if (bundle.tournament !== t.toBase58()) fail("пакет записей от другого турнира");
    const a = await account(t);
    const problems: string[] = [];
    if (!a.revealed) problems.push("секрет ещё не раскрыт в контракте");
    if (toHex(a.secret) !== bundle.secret) problems.push("секрет в пакете не совпадает с раскрытым в контракте");
    if (toHex(a.slotHash) !== bundle.slotHash) problems.push("хеш слота в пакете не совпадает с контрактом");
    const check = await verifyBundle(bundle);
    for (const r of check.runs) if (!r.ok) problems.push(`${r.player}: ${r.error}`);
    for (const place of a.leaderboard) {
      const player = place.player.toBase58();
      const best = bundle.runs.filter((r) => r.player === player).sort((x, y) => y.score - x.score)[0];
      const entryInfo = await connection.getAccountInfo(program.entryAddress(t, place.player));
      const entry = entryInfo ? decodeEntry(entryInfo.data) : null;
      if (!best) problems.push(`${player}: в пакете нет партии для места в таблице`);
      else if (BigInt(best.score) !== place.score) problems.push(`${player}: в таблице ${place.score}, в пакете ${best.score}`);
      else if (!entry || toHex(entry.bestReplayHash) !== best.replayHash) problems.push(`${player}: хеш лучшей партии не совпадает с контрактом`);
    }
    console.log(json({ seed: check.seed, runs: check.runs.length, leaderboard: a.leaderboard.length, problems }));
    process.exit(problems.length ? 1 : 0);
  },
};

async function playerAction(
  build: (player: PublicKey, t: PublicKey, token: TokenContext, playerToken: PublicKey) => TransactionInstruction,
  createTokenAccount = false,
): Promise<void> {
  const player = wallet();
  const t = tournamentKey();
  const a = await account(t);
  const token = await tokenContext(a.mint);
  const playerToken = associatedTokenAddress(player.publicKey, a.mint, token.tokenProgram);
  const ixs = createTokenAccount ? [createAssociatedTokenAccountIdempotent(player.publicKey, player.publicKey, a.mint, token.tokenProgram)] : [];
  console.log(await send(player, ...ixs, build(player.publicKey, t, token, playerToken)));
}

const run = commands[positionals[0] ?? ""];
if (!run) fail(`команды: ${Object.keys(commands).join(", ")} (подробности в начале scripts/tournament.ts)`);
run().catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)));
