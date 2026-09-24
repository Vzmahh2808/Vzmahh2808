/**
 * Off-chain side of an on-chain tournament (roguelike/program). The program stores the hash
 * of the first block at or after the announced slot and, after the round, the organizer's
 * secret; from those two anyone can derive the dungeon seed and re-play every published replay.
 */
import { verifyReplay, type Replay } from "../game/replay";

export const TOURNAMENT_SEED_DOMAIN = "dungeon-heart:v2";

async function sha256(data: Uint8Array | string): Promise<Uint8Array> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function fromHex(hex: string): Uint8Array {
  if (!/^([0-9a-f]{2})*$/i.test(hex)) throw new Error("ожидается hex-строка");
  return Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));
}

/** What the organizer publishes at creation: sha256 of the 32-byte secret, as the program checks it. */
export async function commitSecret(secret: Uint8Array): Promise<Uint8Array> {
  if (secret.length !== 32) throw new Error("секрет должен быть 32 байта");
  return sha256(secret);
}

/**
 * Seed of a tournament: first four bytes of
 * sha256("dungeon-heart:v2:<tournament address>:<slot hash hex>:<secret hex>").
 */
export async function deriveTournamentSeed(tournament: string, slotHash: Uint8Array, secret: Uint8Array): Promise<number> {
  const d = await sha256(`${TOURNAMENT_SEED_DOMAIN}:${tournament}:${toHex(slotHash)}:${toHex(secret)}`);
  return ((d[0] << 24) | (d[1] << 16) | (d[2] << 8) | d[3]) >>> 0;
}

/** The exact bytes whose hash is posted on-chain with a result: rules, seed and actions in this order. */
export function canonicalReplay(replay: Replay): string {
  return JSON.stringify({ rules: replay.rules, seed: replay.seed, actions: replay.actions });
}

export async function replayHash(replay: Replay): Promise<Uint8Array> {
  return sha256(canonicalReplay(replay));
}

/** What the organizer publishes after the reveal: enough for anyone to re-check every run. */
export interface TournamentBundle {
  tournament: string;
  /** Hex, as recorded by the program. */
  slotHash: string;
  /** Hex, as revealed on-chain. */
  secret: string;
  runs: { player: string; score: number; replayHash: string; replay: Replay }[];
}

export interface BundleCheck {
  seed: number;
  runs: { player: string; score: number; replayHash: string; ok: boolean; error?: string }[];
}

/**
 * Offline check of a published bundle: every replay must use the tournament seed, hash to
 * the published hash and re-play to the claimed score. Comparing the hashes and scores with
 * the program's accounts is the online half (npm run tournament -- verify).
 */
export async function verifyBundle(bundle: TournamentBundle): Promise<BundleCheck> {
  const seed = await deriveTournamentSeed(bundle.tournament, fromHex(bundle.slotHash), fromHex(bundle.secret));
  const runs = [];
  for (const run of bundle.runs) {
    const base = { player: run.player, score: run.score, replayHash: run.replayHash };
    const hash = toHex(await replayHash(run.replay));
    if (hash !== run.replayHash) {
      runs.push({ ...base, ok: false, error: "хеш записи не совпадает" });
      continue;
    }
    if (run.replay.seed !== seed) {
      runs.push({ ...base, ok: false, error: "партия сыграна не на seed турнира" });
      continue;
    }
    const result = verifyReplay(run.replay);
    if (!result.ok) runs.push({ ...base, ok: false, error: result.error });
    else if (result.summary.score !== run.score) runs.push({ ...base, ok: false, error: `запись даёт ${result.summary.score} очков` });
    else runs.push({ ...base, ok: true });
  }
  return { seed, runs };
}
