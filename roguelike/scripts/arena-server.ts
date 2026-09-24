/**
 * HTTP API for agents written in any language. The game lives on the server; the agent only
 * gets observations.
 *
 * Practice runs (any seed; the replay with the seed is handed out when the run ends):
 *   POST /runs                 { "seed"?: number }       -> 201 { id, done, observation }
 *   GET  /runs/:id                                       -> { id, done, endReason, observation }
 *   POST /runs/:id/actions     { "action": "8" }         -> { accepted, error?, done, endReason, observation }
 *   GET  /runs/:id/replay      (only after the run ends) -> { endReason, summary, replay }
 *
 * Tournament runs (only when the server is started with a tournament backend):
 *   GET  /tournament                                     -> tournament info and on-chain leaderboard
 *   POST /tournament/challenge { "player": wallet }      -> { nonce, message } to sign with the wallet
 *   POST /tournament/runs      { nonce, signature }      -> 201 run; then play through /runs/:id/actions
 *   GET  /tournament/replays   (after the reveal)        -> every tournament run with its replay
 * A tournament run spends an attempt as soon as it starts. When it ends the server posts the
 * score and the replay hash to the program; replays, which contain the seed, stay private
 * until the organizer reveals the secret.
 */
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { ArenaSession, type Limits } from "../src/agent/session";
import { replayHash, toHex } from "../src/chain/tournament";
import type { Replay } from "../src/game/replay";
import { randomSeed } from "../src/game/rng";
import { challengeMessage, isPublicKey, verifyWalletSignature, type TournamentBackend } from "./arena-tournament";

export interface PublishedRun {
  player: string;
  score: number;
  endReason: string;
  replayHash: string;
  replay: Replay;
}

export interface ArenaOptions {
  /** Most runs kept in memory; the least recently used one is dropped beyond this. */
  maxRuns?: number;
  /** Runs untouched for this long are dropped; an unfinished tournament run is submitted as it stands. */
  idleMs?: number;
  limits?: Partial<Limits>;
  tournament?: TournamentBackend;
  /** Called for every finished tournament run, e.g. to keep it for publishing after the reveal. */
  onTournamentRun?: (run: PublishedRun) => void;
  /** Clock in milliseconds; tests replace it. */
  now?: () => number;
}

interface Submission {
  status: "pending" | "submitted" | "failed";
  signature?: string;
  error?: string;
}

interface Run {
  session: ArenaSession;
  touched: number;
  /** Set for tournament runs. */
  player?: string;
  submission?: Submission;
}

const MAX_BODY_BYTES = 16 * 1024;
const CHALLENGE_TTL_MS = 5 * 60_000;

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
  const now = options.now ?? Date.now;
  const backend = options.tournament;
  const runs = new Map<string, Run>();
  const challenges = new Map<string, { player: string; expires: number }>();
  /** Tournament runs per player that started but are not yet recorded on-chain. */
  const inFlight = new Map<string, number>();
  const published: PublishedRun[] = [];

  function sweep(t: number): void {
    for (const [id, run] of runs) if (t - run.touched > idleMs) drop(id, run);
    while (runs.size >= maxRuns) {
      const [id, run] = runs.entries().next().value!;
      drop(id, run);
    }
    for (const [nonce, c] of challenges) if (c.expires < t) challenges.delete(nonce);
  }

  function drop(id: string, run: Run): void {
    runs.delete(id);
    void finishTournamentRun(run);
  }

  function getRun(id: string): Run {
    const run = runs.get(id);
    if (!run) throw new HttpError(404, "партия не найдена");
    runs.delete(id);
    run.touched = now();
    runs.set(id, run);
    return run;
  }

  function state(id: string, run: Run) {
    const s = run.session;
    return { id, done: s.done, endReason: s.endReason, observation: s.observe(), ...(run.player ? { submission: run.submission ?? null } : {}) };
  }

  function requireBackend(): TournamentBackend {
    if (!backend) throw new HttpError(404, "сервер запущен без турнира");
    return backend;
  }

  /** Posts a tournament run's result; runs once per run. */
  async function finishTournamentRun(run: Run): Promise<void> {
    if (!backend || !run.player || run.submission) return;
    run.submission = { status: "pending" };
    const player = run.player;
    const summary = run.session.summary();
    const replay = run.session.replay();
    const hash = await replayHash(replay);
    const record: PublishedRun = { player, score: summary.score, endReason: run.session.endReason ?? "abandoned", replayHash: toHex(hash), replay };
    published.push(record);
    options.onTournamentRun?.(record);
    try {
      run.submission = { status: "submitted", signature: await backend.submit(player, summary.score, hash) };
      // Recorded on-chain now, so it counts through attemptsUsed. A failed submission keeps
      // counting here: the player has seen the dungeon either way.
      inFlight.set(player, Math.max(0, (inFlight.get(player) ?? 1) - 1));
    } catch (e) {
      run.submission = { status: "failed", error: e instanceof Error ? e.message : String(e) };
    }
  }

  async function route(req: IncomingMessage): Promise<[number, unknown]> {
    const path = new URL(req.url ?? "/", "http://arena").pathname;
    if (path === "/" && req.method === "GET") {
      return [200, { name: "Сердце подземелья: арена агентов", tournament: Boolean(backend), docs: "roguelike/README.md#api-для-агентов" }];
    }
    if (path === "/runs" && req.method === "POST") {
      const body = (await readJson(req)) as { seed?: unknown };
      const seed = body.seed === undefined ? randomSeed() : body.seed;
      if (!Number.isInteger(seed) || (seed as number) < 0 || (seed as number) > 0xffffffff) {
        throw new HttpError(400, "seed должен быть целым числом от 0 до 4294967295");
      }
      return [201, startRun(new ArenaSession(seed as number, options.limits))];
    }

    if (path === "/tournament" && req.method === "GET") return [200, await requireBackend().info()];
    if (path === "/tournament/challenge" && req.method === "POST") {
      const b = requireBackend();
      const { player } = (await readJson(req)) as { player?: unknown };
      if (!isPublicKey(player)) throw new HttpError(400, "нужно поле player с адресом кошелька (base58)");
      sweep(now());
      const nonce = randomUUID();
      challenges.set(nonce, { player, expires: now() + CHALLENGE_TTL_MS });
      const { address } = await b.info();
      return [200, { nonce, message: challengeMessage(address, player, nonce), expiresInSec: CHALLENGE_TTL_MS / 1000 }];
    }
    if (path === "/tournament/runs" && req.method === "POST") return [201, await startTournamentRun(req)];
    if (path === "/tournament/replays" && req.method === "GET") {
      if (!(await requireBackend().info()).revealed) throw new HttpError(403, "записи публикуются после раскрытия секрета");
      return [200, published];
    }

    const m = /^\/runs\/([0-9a-f-]{36})(\/actions|\/replay)?$/.exec(path);
    if (!m) throw new HttpError(404, "нет такого адреса");
    const [, id, sub] = m;
    const run = getRun(id);
    if (!sub && req.method === "GET") return [200, state(id, run)];
    if (sub === "/actions" && req.method === "POST") {
      const body = (await readJson(req)) as { action?: unknown };
      if (typeof body.action !== "string") throw new HttpError(400, "нужно поле action со строкой хода, например \"8\"");
      const result = run.session.act(body.action);
      if (run.session.done) void finishTournamentRun(run);
      return [200, { ...result, ...state(id, run) }];
    }
    if (sub === "/replay" && req.method === "GET") {
      const s = run.session;
      if (!s.done) throw new HttpError(409, "запись доступна после окончания партии");
      if (!run.player) return [200, { endReason: s.endReason, summary: s.summary(), replay: s.replay() }];
      const revealed = (await requireBackend().info()).revealed;
      const hash = toHex(await replayHash(s.replay()));
      return [200, { endReason: s.endReason, summary: s.summary(), replayHash: hash, submission: run.submission, ...(revealed ? { replay: s.replay() } : {}) }];
    }
    throw new HttpError(405, "метод не поддерживается");
  }

  function startRun(session: ArenaSession, player?: string) {
    sweep(now());
    const id = randomUUID();
    const run: Run = { session, touched: now(), player };
    runs.set(id, run);
    return state(id, run);
  }

  async function startTournamentRun(req: IncomingMessage) {
    const b = requireBackend();
    const { nonce, signature } = (await readJson(req)) as { nonce?: unknown; signature?: unknown };
    if (typeof nonce !== "string" || typeof signature !== "string") throw new HttpError(400, "нужны поля nonce и signature");
    const challenge = challenges.get(nonce);
    challenges.delete(nonce);
    if (!challenge || challenge.expires < now()) throw new HttpError(401, "nonce неизвестен или устарел, запросите новый");
    const info = await b.info();
    const { player } = challenge;
    if (!verifyWalletSignature(challengeMessage(info.address, player, nonce), signature, player)) {
      throw new HttpError(401, "подпись не подходит к кошельку");
    }
    if (now() / 1000 > info.endTs) throw new HttpError(403, "турнир окончен");
    const seed = await b.seed();
    if (seed === null) throw new HttpError(409, "seed турнира ещё не зафиксирован: слот не наступил или его хеш не записан");
    const used = await b.attemptsUsed(player);
    if (used === null) throw new HttpError(403, "у этого кошелька нет взноса: сначала вызовите enter в контракте");
    const pending = inFlight.get(player) ?? 0;
    if (used + pending >= info.attemptsPerEntry) throw new HttpError(403, "попытки закончились");
    inFlight.set(player, pending + 1);
    return startRun(new ArenaSession(seed, options.limits), player);
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
