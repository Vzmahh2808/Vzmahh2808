import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { greedyChoice } from "../src/agent/greedy";
import type { Observation } from "../src/agent/observe";
import { verifyReplay, type Replay } from "../src/game/replay";
import { createArenaServer } from "../scripts/arena-server";

interface RunState {
  id: string;
  done: boolean;
  endReason: string | null;
  observation: Observation;
  accepted?: boolean;
  error?: string;
}

let server: Server;
let base = "";

async function call<T = RunState>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const res = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  return { status: res.status, data: (await res.json()) as T };
}

beforeAll(async () => {
  server = createArenaServer({ limits: { maxTurns: 300 }, maxRuns: 3 });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe("arena HTTP API", () => {
  it("plays a whole run over HTTP and hands out a verifiable replay at the end", async () => {
    const created = await call("POST", "/runs", { seed: 1003 });
    expect(created.status).toBe(201);
    expect(JSON.stringify(created.data)).not.toMatch(/"seed"|rngState/);

    let run = created.data;
    const early = await call("GET", `/runs/${run.id}/replay`);
    expect(early.status).toBe(409);

    while (!run.done) {
      const step = await call("POST", `/runs/${run.id}/actions`, { action: greedyChoice(run.observation) });
      expect(step.data.accepted).toBe(true);
      run = step.data;
    }
    const final = await call<{ endReason: string; summary: unknown; replay: Replay }>("GET", `/runs/${run.id}/replay`);
    expect(final.status).toBe(200);
    expect(final.data.replay.seed).toBe(1003);
    expect(verifyReplay(final.data.replay)).toEqual({ ok: true, summary: final.data.summary });
  });

  it("reports refused actions and bad requests clearly", async () => {
    const { data: run } = await call("POST", "/runs", { seed: 5 });
    const refused = await call("POST", `/runs/${run.id}/actions`, { action: ">" });
    expect(refused.status).toBe(200);
    expect(refused.data).toMatchObject({ accepted: false, done: false });
    expect(refused.data.error).toBeTruthy();

    expect((await call("POST", `/runs/${run.id}/actions`, {})).status).toBe(400);
    expect((await call("POST", `/runs/${run.id}/actions`, "not json")).status).toBe(400);
    expect((await call("POST", "/runs", { seed: -1 })).status).toBe(400);
    expect((await call("GET", "/runs/00000000-0000-0000-0000-000000000000")).status).toBe(404);
    expect((await call("GET", "/nowhere")).status).toBe(404);
  });

  it("drops the least recently used run when full", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) ids.push((await call("POST", "/runs", { seed: i })).data.id);
    expect((await call("GET", `/runs/${ids[0]}`)).status).toBe(404);
    expect((await call("GET", `/runs/${ids[3]}`)).status).toBe(200);
  });
});
