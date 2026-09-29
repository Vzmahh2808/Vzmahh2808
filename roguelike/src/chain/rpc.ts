/**
 * Minimal Solana JSON-RPC client: only the three calls the daily challenge needs.
 * Every read uses "finalized" commitment, so a block it returns can no longer be rolled back.
 */

export const MAINNET_RPC = "https://api.mainnet-beta.solana.com";

export interface BlockInfo {
  blockhash: string;
  /** Unix time in seconds as estimated by validators; null for very old blocks. */
  blockTime: number | null;
}

/** The chain reads the challenge logic depends on; tests substitute a fake. */
export interface ChainReader {
  /** Latest finalized slot. */
  getSlot(): Promise<number>;
  /** Slots in [start, end] that contain a finalized block, ascending. Skipped slots are absent. */
  getBlocks(start: number, end: number): Promise<number[]>;
  getBlock(slot: number): Promise<BlockInfo>;
}

export class RpcError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
  }
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export class SolanaRpc implements ChainReader {
  private nextId = 1;

  constructor(
    readonly url: string = MAINNET_RPC,
    private readonly fetchFn: FetchLike = (u, init) => fetch(u, init),
  ) {}

  getSlot(): Promise<number> {
    return this.call<number>("getSlot", [{ commitment: "finalized" }]);
  }

  getBlocks(start: number, end: number): Promise<number[]> {
    return this.call<number[]>("getBlocks", [start, end, { commitment: "finalized" }]);
  }

  async getBlock(slot: number): Promise<BlockInfo> {
    const block = await this.call<{ blockhash: string; blockTime: number | null } | null>("getBlock", [
      slot,
      { commitment: "finalized", transactionDetails: "none", rewards: false, maxSupportedTransactionVersion: 0 },
    ]);
    if (!block) throw new RpcError(`блок ${slot} не найден`);
    return { blockhash: block.blockhash, blockTime: block.blockTime };
  }

  private async call<T>(method: string, params: unknown[]): Promise<T> {
    const res = await this.fetchFn(this.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: this.nextId++, method, params }),
    });
    if (!res.ok) throw new RpcError(`RPC ответил HTTP ${res.status} на ${method}`);
    const body = (await res.json()) as { result?: T; error?: { code: number; message: string } };
    if (body.error) throw new RpcError(`${method}: ${body.error.message}`, body.error.code);
    return body.result as T;
  }
}
