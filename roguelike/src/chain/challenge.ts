/**
 * Daily challenge: everyone plays the same dungeon, and nobody, the organizer included,
 * can know it in advance.
 *
 * A challenge is announced as { id, slot } before that Solana slot is produced. Once it is
 * finalized, the challenge block is the first block at or after `slot` (a slot can be skipped
 * by its leader), and the game seed is the first four bytes of
 * sha256("dungeon-heart:v1:<id>:<blockhash>"). Anyone can recompute it from public chain data.
 */
import { verifyReplay, type Replay, type VerifyResult } from "../game/replay";
import type { ChainReader } from "./rpc";

export const SEED_DOMAIN = "dungeon-heart:v1";
/** Nominal Solana slot length, used only to estimate when a future slot arrives. */
export const SLOT_MS = 400;
/** How far past the announced slot to look for a block before declaring the challenge broken. */
export const SKIP_WINDOW = 150;

export interface Challenge {
  id: string;
  slot: number;
}

export interface ResolvedChallenge extends Challenge {
  /** Slot of the block actually used: `slot` itself unless that slot was skipped. */
  blockSlot: number;
  blockhash: string;
  seed: number;
}

export type Resolution =
  | { state: "ready"; challenge: ResolvedChallenge }
  /** The block is not finalized yet; `slotsLeft` is a lower bound on the wait. */
  | { state: "pending"; slotsLeft: number };

/** A replay submitted for a challenge carries the challenge it claims to have played. */
export type ChallengeReplay = Replay & { challenge: ResolvedChallenge };

const ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

export function isChallengeId(id: string): boolean {
  return ID_PATTERN.test(id);
}

/** Challenge id for a calendar day in UTC, e.g. "2026-09-25". */
export function dayId(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function deriveSeed(id: string, blockhash: string): Promise<number> {
  const data = new TextEncoder().encode(`${SEED_DOMAIN}:${id}:${blockhash}`);
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return ((d[0] << 24) | (d[1] << 16) | (d[2] << 8) | d[3]) >>> 0;
}

export async function resolveChallenge(chain: ChainReader, challenge: Challenge): Promise<Resolution> {
  const finalized = await chain.getSlot();
  if (finalized < challenge.slot) return { state: "pending", slotsLeft: challenge.slot - finalized };

  const windowEnd = challenge.slot + SKIP_WINDOW;
  const end = Math.min(windowEnd, finalized);
  const blocks = (await chain.getBlocks(challenge.slot, end)).filter((s) => s >= challenge.slot && s <= end);
  if (blocks.length === 0) {
    if (end < windowEnd) return { state: "pending", slotsLeft: 1 };
    throw new Error(`в слотах ${challenge.slot}–${windowEnd} нет ни одного блока, испытание нужно объявить заново`);
  }
  const blockSlot = Math.min(...blocks);
  const { blockhash } = await chain.getBlock(blockSlot);
  const seed = await deriveSeed(challenge.id, blockhash);
  return { state: "ready", challenge: { id: challenge.id, slot: challenge.slot, blockSlot, blockhash, seed } };
}

/** Offline check that the seed really follows from the claimed id and block hash. */
export async function seedMatches(c: ResolvedChallenge): Promise<boolean> {
  return (await deriveSeed(c.id, c.blockhash)) === c.seed;
}

/** Checks against the chain that the claimed block is the one the challenge resolves to. */
export async function confirmOnChain(chain: ChainReader, c: ResolvedChallenge): Promise<boolean> {
  const r = await resolveChallenge(chain, c);
  return r.state === "ready" && r.challenge.blockSlot === c.blockSlot && r.challenge.blockhash === c.blockhash;
}

/**
 * Offline verification of a challenge submission: the seed must follow from the block hash,
 * the run must use that seed, and the replay itself must verify. Whether the block hash is
 * the real one for the slot is a separate, online check (`confirmOnChain`).
 */
export async function verifyChallengeRun(replay: ChallengeReplay): Promise<VerifyResult> {
  const c = replay.challenge;
  if (!c || !isChallengeId(c.id) || !Number.isInteger(c.slot) || !Number.isInteger(c.blockSlot) || c.blockSlot < c.slot) {
    return { ok: false, error: "в записи нет корректных данных испытания", action: -1 };
  }
  if (!(await seedMatches(c))) return { ok: false, error: "seed испытания не следует из хеша блока", action: -1 };
  if (replay.seed !== c.seed) return { ok: false, error: "партия сыграна не на seed испытания", action: -1 };
  return verifyReplay(replay);
}

/** Slot expected at `targetMs`, extrapolated from a known (slot, time) pair. */
export function estimateSlotAt(now: { slot: number; timeMs: number }, targetMs: number): number {
  return now.slot + Math.ceil((targetMs - now.timeMs) / SLOT_MS);
}

/** Validates an announcement list such as public/challenges.json. */
export function parseChallenges(data: unknown): Challenge[] {
  if (!Array.isArray(data)) throw new Error("список испытаний должен быть массивом");
  return data.map((c, i) => {
    const { id, slot } = (c ?? {}) as Partial<Challenge>;
    if (typeof id !== "string" || !isChallengeId(id) || !Number.isInteger(slot) || (slot as number) < 0) {
      throw new Error(`испытание №${i}: нужны id (буквы, цифры, . _ -) и неотрицательный целый slot`);
    }
    return { id, slot: slot as number };
  });
}
