/**
 * HTTP API for agents written in any language. The game lives on the server; the agent only
 * gets observations, and the seed is revealed with the replay once the run is over.
 *
 *   POST /runs                 { "seed"?: number }       -> 201 { id, done, observation }
 *   GET  /runs/:id                                       -> { id, done, endReason, observation }
 *   POST /runs/:id/actions     { "action": "8" }         -> { accepted, error?, done, endReason, observation }
 *   GET  /runs/:id/replay      (only after the run ends) -> { endReason, summary, replay }
 */
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { ArenaSession, type Limits } from "../src/agent/session";
import { randomSeed } from "../src/game/rng";

export interface ArenaOptions {
  /** Most runs kept in memory; the least recently used one is dropped beyond this. */
  maxRuns?: number;
  /** Runs untouched for this long are dropped. */
  idleMs?: number;
  limits?: Partial<Limits>;
}

const MAX_BODY_BYTES = 16 * 1024;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function createArenaServer(options: ArenaOptions = {}): Server {
  const maxRuns = options.maxRuns ?? 500;
  const idleMs = options.idleMs ?? 60 * 60_000;
  const runs = new Map<string, { session: ArenaSession; touched: number }>();

  function sweep(now: number): void {
    for (const [id, run] of runs) if (now - run.touched > idleMs) runs.delete(id);
    while (runs.size >= maxRuns) runs.delete(runs.keys().next().value!);
  }

  function getRun(id: string): ArenaSession {
    const run = runs.get(id);
    if (!run) throw new HttpError(404, "партия не найдена");
    runs.delete(id);
    run.touched = Date.now();
    runs.set(id, run);
    return run.session;
  }

  function state(id: string, session: ArenaSession) {
    return { id, done: session.done, endReason: session.endReason, observation: session.observe() };
  }

  async function route(req: IncomingMessage): Promise<[number, unknown]> {
    const path = new URL(req.url ?? "/", "http://arena").pathname;
    if (path === "/" && req.method === "GET") {
      return [200, { name: "Сердце подземелья: арена агентов", docs: "roguelike/README.md#api-для-агентов" }];
    }
    if (path === "/runs" && req.method === "POST") {
      const body = (await readJson(req)) as { seed?: unknown };
      const seed = body.seed === undefined ? randomSeed() : body.seed;
      if (!Number.isInteger(seed) || (seed as number) < 0 || (seed as number) > 0xffffffff) {
        throw new HttpError(400, "seed должен быть целым числом от 0 до 4294967295");
      }
      sweep(Date.now());
      const id = randomUUID();
      const session = new ArenaSession(seed as number, options.limits);
      runs.set(id, { session, touched: Date.now() });
      return [201, state(id, session)];
    }
    const m = /^\/runs\/([0-9a-f-]{36})(\/actions|\/replay)?$/.exec(path);
    if (!m) throw new HttpError(404, "нет такого адреса");
    const [, id, sub] = m;
    const session = getRun(id);
    if (!sub && req.method === "GET") return [200, state(id, session)];
    if (sub === "/actions" && req.method === "POST") {
      const body = (await readJson(req)) as { action?: unknown };
      if (typeof body.action !== "string") throw new HttpError(400, "нужно поле action со строкой хода, например \"8\"");
      const result = session.act(body.action);
      return [200, { ...result, ...state(id, session) }];
    }
    if (sub === "/replay" && req.method === "GET") {
      if (!session.done) throw new HttpError(409, "запись доступна после окончания партии");
      return [200, { endReason: session.endReason, summary: session.summary(), replay: session.replay() }];
    }
    throw new HttpError(405, "метод не поддерживается");
  }

  return createServer((req, res) => {
    if (req.method === "OPTIONS") return send(res, 204, null);
    route(req).then(
      ([status, body]) => send(res, status, body),
      (e: unknown) => {
        if (e instanceof HttpError) send(res, e.status, { error: e.message });
        else {
          console.error(e);
          send(res, 500, { error: "внутренняя ошибка сервера" });
        }
      },
    );
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
  });
  res.end(body === null ? undefined : JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "слишком большой запрос");
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    /* fall through */
  }
  throw new HttpError(400, "тело запроса должно быть JSON-объектом");
}
