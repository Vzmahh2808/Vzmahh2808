/**
 * TournamentBackend on a real Solana cluster: reads the tournament and entry accounts, keeps
 * the slot hash recorded, derives the seed with the organizer's secret and posts results.
 */
import { sendAndConfirmTransaction, Transaction, type Connection, type Keypair, PublicKey } from "@solana/web3.js";
import { ArenaProgram, decodeEntry, decodeTournament, type TournamentAccount } from "../src/chain/arena-program";
import { commitSecret, deriveTournamentSeed, toHex } from "../src/chain/tournament";
import type { TournamentBackend, TournamentInfo } from "./arena-tournament";

type Send = (tx: Transaction, signers: Keypair[]) => Promise<string>;
type Reader = Pick<Connection, "getAccountInfo" | "getSlot">;

export interface SolanaTournamentOptions {
  connection: Reader;
  program: ArenaProgram;
  tournament: PublicKey;
  /** The tournament authority: signs results and pays for recording the slot hash. */
  organizer: Keypair;
  secret: Uint8Array;
  /** Sends a transaction; defaults to sendAndConfirmTransaction on `connection`. */
  send?: Send;
  /** How long account reads are cached, in ms. */
  cacheMs?: number;
}

export class SolanaTournamentBackend implements TournamentBackend {
  private cached: { at: number; account: TournamentAccount } | null = null;
  private readonly send: Send;

  constructor(private readonly o: SolanaTournamentOptions) {
    this.send = o.send ?? ((tx, signers) => sendAndConfirmTransaction(o.connection as Connection, tx, signers, { commitment: "confirmed" }));
  }

  /** Fails fast if this server could not run the tournament: wrong key or wrong secret. */
  async check(): Promise<TournamentAccount> {
    const t = await this.account(true);
    if (!t.authority.equals(this.o.organizer.publicKey)) throw new Error("ключ сервера не является организатором турнира");
    if (toHex(await commitSecret(this.o.secret)) !== toHex(t.secretCommitment)) throw new Error("секрет не совпадает с опубликованным хешем");
    return t;
  }

  async account(fresh = false): Promise<TournamentAccount> {
    const now = Date.now();
    if (!fresh && this.cached && now - this.cached.at < (this.o.cacheMs ?? 5_000)) return this.cached.account;
    const info = await this.o.connection.getAccountInfo(this.o.tournament, "confirmed");
    if (!info) throw new Error(`турнир ${this.o.tournament.toBase58()} не найден`);
    const account = decodeTournament(info.data);
    this.cached = { at: now, account };
    return account;
  }

  async info(): Promise<TournamentInfo> {
    const t = await this.account();
    return {
      address: this.o.tournament.toBase58(),
      id: t.id,
      endTs: Number(t.endTs),
      attemptsPerEntry: t.attemptsPerEntry,
      seedReady: t.slotHashRecorded,
      revealed: t.revealed,
      leaderboard: t.leaderboard.map((p) => ({ player: p.player.toBase58(), score: Number(p.score) })),
    };
  }

  /**
   * Records the slot hash once the seed slot has passed. The SlotHashes sysvar keeps about
   * 512 slots (a few minutes), so the organizer's server does it rather than waiting for others.
   */
  async ensureSlotHash(): Promise<boolean> {
    const t = await this.account(true);
    if (t.slotHashRecorded) return true;
    if (t.status !== "open") return false;
    const slot = BigInt(await this.o.connection.getSlot("confirmed"));
    if (slot <= t.seedSlot) return false;
    await this.send(new Transaction().add(this.o.program.recordSlotHash(this.o.tournament)), [this.o.organizer]);
    return (await this.account(true)).slotHashRecorded;
  }

  async seed(): Promise<number | null> {
    let t = await this.account();
    if (!t.slotHashRecorded) {
      if (!(await this.ensureSlotHash())) return null;
      t = await this.account();
    }
    return deriveTournamentSeed(this.o.tournament.toBase58(), t.slotHash, this.o.secret);
  }

  async attemptsUsed(player: string): Promise<number | null> {
    const address = this.o.program.entryAddress(this.o.tournament, new PublicKey(player));
    const info = await this.o.connection.getAccountInfo(address, "confirmed");
    return info ? decodeEntry(info.data).attemptsUsed : null;
  }

  async submit(player: string, score: number, replayHash: Uint8Array): Promise<string> {
    const ix = this.o.program.submitResult(this.o.organizer.publicKey, this.o.tournament, new PublicKey(player), BigInt(score), replayHash);
    const signature = await this.send(new Transaction().add(ix), [this.o.organizer]);
    this.cached = null;
    return signature;
  }
}
