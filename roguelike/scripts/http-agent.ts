/**
 * Example remote agent: plays one run against the arena HTTP API with the greedy policy.
 * The same loop works from any language that can send JSON over HTTP.
 * Run with: npm run http-agent -- [arena url] [seed]
 */
import { greedyChoice } from "../src/agent/greedy";
import type { Observation } from "../src/agent/observe";

const base = process.argv[2] ?? "http://localhost:8787";
const seedArg = process.argv[3];

interface RunState {
  id: string;
  done: boolean;
  endReason: string | null;
  observation: Observation;
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

let run = await call<RunState>("POST", "/runs", seedArg === undefined ? {} : { seed: Number(seedArg) });
while (!run.done) {
  run = await call<RunState>("POST", `/runs/${run.id}/actions`, { action: greedyChoice(run.observation) });
}
const result = await call<{ endReason: string; summary: unknown; replay: unknown }>("GET", `/runs/${run.id}/replay`);
console.log(JSON.stringify(result, null, 2));
