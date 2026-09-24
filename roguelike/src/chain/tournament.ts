/**
 * Off-chain side of an on-chain tournament (roguelike/program). The program stores the hash
 * of the first block at or after the announced slot and, after the round, the organizer's
 * secret; from those two anyone can derive the dungeon seed and re-play every published replay.
 */
import type { Replay } from "../game/replay";

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
