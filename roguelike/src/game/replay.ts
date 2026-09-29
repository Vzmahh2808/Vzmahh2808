import { ActionFormatError, decodeActions, type Action } from "./actions";
import { Game, scoreOf } from "./game";
import type { GameStatus } from "./types";

/**
 * Version of the game rules a replay was recorded under. Bump it whenever a change to the
 * engine makes the same seed and actions play out differently, so old replays fail loudly
 * instead of verifying to a different score.
 */
export const RULES_VERSION = 1;

/** Upper bound on replay length, so a verifier cannot be made to spin forever. */
export const MAX_REPLAY_ACTIONS = 50_000;

/** Everything needed to re-run a game from scratch: the seed and the actions taken. */
export interface Replay {
  rules: number;
  seed: number;
  actions: string;
}

export interface RunSummary {
  score: number;
  status: GameStatus;
  depth: number;
  turns: number;
  level: number;
  kills: number;
  gold: number;
  deathCause: string;
  actions: number;
}

export type VerifyResult =
  | { ok: true; summary: RunSummary }
  | {
      ok: false;
      error: string;
      /** Index of the offending action, or -1 when the problem is not tied to one action. */
      action: number;
    };

/** The replay of a game in progress or finished; null when the run predates recording. */
export function replayOf(game: Game): Replay | null {
  const { seed, actions } = game.state;
  if (actions === undefined) return null;
  return { rules: RULES_VERSION, seed, actions };
}

export function applyAction(game: Game, action: Action): boolean {
  switch (action.type) {
    case "move":
      return game.movePlayer(action.dx, action.dy);
    case "wait":
      return game.wait();
    case "pickup":
      return game.pickUp();
    case "descend":
      return game.descend();
    case "use":
      return game.useItem(action.index);
    case "drop":
      return game.dropItem(action.index);
  }
}

export function summarize(game: Game): RunSummary {
  const s = game.state;
  return {
    score: scoreOf(s),
    status: s.status,
    depth: s.depth,
    turns: s.turn,
    level: s.player.level,
    kills: s.player.kills,
    gold: s.player.gold,
    deathCause: s.deathCause,
    actions: s.actions === undefined ? 0 : decodeActions(s.actions).length,
  };
}

/**
 * Re-plays a run from its seed and reports the outcome. A replay is valid only if every
 * action is accepted by the engine and none comes after the game ended, so a forged or
 * edited action list is rejected rather than silently producing some other score.
 */
export function verifyReplay(replay: Replay, maxActions = MAX_REPLAY_ACTIONS): VerifyResult {
  if (replay.rules !== RULES_VERSION) {
    return { ok: false, error: `запись сделана по правилам версии ${replay.rules}, а проверка идёт по версии ${RULES_VERSION}`, action: -1 };
  }
  if (!Number.isInteger(replay.seed) || replay.seed < 0 || replay.seed > 0xffffffff) {
    return { ok: false, error: "seed должен быть целым числом от 0 до 4294967295", action: -1 };
  }
  if (typeof replay.actions !== "string") {
    return { ok: false, error: "список действий должен быть строкой", action: -1 };
  }

  let actions: Action[];
  try {
    actions = decodeActions(replay.actions);
  } catch (e) {
    if (e instanceof ActionFormatError) return { ok: false, error: `ошибка формата на символе ${e.offset}: ${e.message}`, action: -1 };
    throw e;
  }
  if (actions.length > maxActions) {
    return { ok: false, error: `слишком длинная запись: ${actions.length} действий при лимите ${maxActions}`, action: -1 };
  }

  const game = Game.newGame(replay.seed);
  for (let i = 0; i < actions.length; i++) {
    if (game.state.status !== "playing") {
      return { ok: false, error: `действие ${i} идёт после конца игры`, action: i };
    }
    if (!applyAction(game, actions[i])) {
      return { ok: false, error: `движок отклонил действие ${i}`, action: i };
    }
    game.events = [];
  }
  return { ok: true, summary: summarize(game) };
}
