/**
 * Example remote agent: plays one run against the arena HTTP API with the greedy policy.
 * The same loop works from any language that can send JSON over HTTP.
 *
 *   npm run http-agent -- [arena url] [seed]              practice run
 *   npm run http-agent -- [arena url] --keypair w.json    tournament attempt paid by wallet w.json
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { Keypair } from "@solana/web3.js";
import { greedyChoice } from "../src/agent/greedy";
import type { Observation } from "../src/agent/observe";
import { signWithWallet } from "./arena-tournament";

const { values, positionals } = parseArgs({ allowPositionals: true, options: { keypair: { type: "string" } } });
const base = positionals[0] ?? "http://localhost:8787";
const seedArg = positionals[1];

interface RunState {
  id: string;
  done: boolean;
  endReason: string | null;
  observation: Observation;
  submission?: { status: string; signature?: string; error?: string } | null;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${data.error ?? ""}`);
  return data;
}

async function startRun(): Promise<RunState> {
  if (!values.keypair) return call<RunState>("POST", "/runs", seedArg === undefined ? {} : { seed: Number(seedArg) });
  // Tournament: prove we own the wallet that paid the entry fee by signing the server's nonce.
  const wallet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(values.keypair, "utf8")) as number[]));
  const { nonce, message } = await call<{ nonce: string; message: string }>("POST", "/tournament/challenge", { player: wallet.publicKey.toBase58() });
  return call<RunState>("POST", "/tournament/runs", { nonce, signature: signWithWallet(message, wallet) });
}

let run = await startRun();
while (!run.done) {
  run = await call<RunState>("POST", `/runs/${run.id}/actions`, { action: greedyChoice(run.observation) });
}
// A tournament result goes on-chain in the background; wait until it is confirmed or fails.
for (let i = 0; i < 60 && run.submission?.status === "pending"; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  run = await call<RunState>("GET", `/runs/${run.id}`);
}
const result = await call<Record<string, unknown>>("GET", `/runs/${run.id}/replay`);
console.log(JSON.stringify(result, null, 2));
