/**
 * Tournament mode of the arena server: who may start a run, where results go, and wallet
 * signatures proving a player owns the wallet that paid the entry fee.
 */
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { PublicKey, type Keypair } from "@solana/web3.js";

export interface TournamentInfo {
  address: string;
  id: string;
  /** Unix seconds; no new runs start after it. */
  endTs: number;
  attemptsPerEntry: number;
  /** The slot hash is recorded, so the organizer's server can derive the seed. */
  seedReady: boolean;
  /** The secret is public: replays (and with them the seed) can be published. */
  revealed: boolean;
  leaderboard: { player: string; score: number }[];
}

/** Everything the arena server needs from the chain; the Solana implementation is in solana-tournament.ts. */
export interface TournamentBackend {
  info(): Promise<TournamentInfo>;
  /** The dungeon seed, or null while the slot hash is not recorded. Never sent to players. */
  seed(): Promise<number | null>;
  /** Attempts already recorded on-chain for this player, or null if they have not entered. */
  attemptsUsed(player: string): Promise<number | null>;
  /** Posts a verified result; resolves to the transaction signature. */
  submit(player: string, score: number, replayHash: Uint8Array): Promise<string>;
}

export function challengeMessage(tournament: string, player: string, nonce: string): string {
  return `Сердце подземелья: начать партию\nтурнир: ${tournament}\nигрок: ${player}\nnonce: ${nonce}`;
}

export function isPublicKey(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return new PublicKey(value).toBase58() === value;
  } catch {
    return false;
  }
}

const SPKI_ED25519 = Buffer.from("302a300506032b6570032100", "hex");
const PKCS8_ED25519 = Buffer.from("302e020100300506032b657004220420", "hex");

/** Checks an ed25519 signature (base64) of `message` by the wallet `player` (base58). */
export function verifyWalletSignature(message: string, signature: string, player: string): boolean {
  try {
    const key = createPublicKey({ key: Buffer.concat([SPKI_ED25519, new PublicKey(player).toBuffer()]), format: "der", type: "spki" });
    return verify(null, Buffer.from(message, "utf8"), key, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

/** Signs `message` with a wallet keypair, as a wallet's signMessage would; returns base64. */
export function signWithWallet(message: string, wallet: Keypair): string {
  const key = createPrivateKey({ key: Buffer.concat([PKCS8_ED25519, Buffer.from(wallet.secretKey.subarray(0, 32))]), format: "der", type: "pkcs8" });
  return sign(null, Buffer.from(message, "utf8"), key).toString("base64");
}
