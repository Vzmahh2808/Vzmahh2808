import { ActionFormatError, decodeActions, type Action } from "../game/actions";
import { Game } from "../game/game";
import { applyAction, replayOf, summarize, type Replay, type RunSummary } from "../game/replay";
import { observe, type Observation } from "./observe";

/** Same cap as the baseline bot, so scores are comparable. */
export const MAX_TURNS = 6000;
/** Rejected actions cost no turn, so they need their own cap or an agent could stall forever. */
export const MAX_REJECTED = 500;

export type EndReason = "won" | "dead" | "turn-limit" | "rejected-limit";

export interface Limits {
  maxTurns: number;
  maxRejected: number;
}

export interface ActResult {
  accepted: boolean;
  error?: string;
}

/** One agent run: accepts one action code at a time and ends on death, victory or a limit. */
export class ArenaSession {
  readonly game: Game;
  readonly limits: Limits;
  rejected = 0;
  decisions = 0;

  constructor(seed: number, limits: Partial<Limits> = {}) {
    this.game = Game.newGame(seed);
    this.limits = { maxTurns: MAX_TURNS, maxRejected: MAX_REJECTED, ...limits };
  }

  get endReason(): EndReason | null {
    const s = this.game.state;
    if (s.status === "won" || s.status === "dead") return s.status;
    if (s.turn >= this.limits.maxTurns) return "turn-limit";
    if (this.rejected >= this.limits.maxRejected) return "rejected-limit";
    return null;
  }

  get done(): boolean {
    return this.endReason !== null;
  }

  observe(): Observation {
    return observe(this.game);
  }

  act(code: string): ActResult {
    if (this.done) return { accepted: false, error: "партия окончена" };
    this.decisions++;
    let actions: Action[];
    try {
      actions = decodeActions(String(code));
    } catch (e) {
      if (!(e instanceof ActionFormatError)) throw e;
      return this.reject(e.message);
    }
    if (actions.length !== 1) return this.reject("нужно ровно одно действие");
    const accepted = applyAction(this.game, actions[0]);
    this.game.events = [];
    return accepted ? { accepted } : this.reject("движок не принял действие, смотрите список legal");
  }

  replay(): Replay {
    return replayOf(this.game)!;
  }

  summary(): RunSummary {
    return summarize(this.game);
  }

  private reject(error: string): ActResult {
    this.rejected++;
    return { accepted: false, error };
  }
}

export interface Agent {
  readonly name: string;
  /** Picks one action code, normally one of `obs.legal`. */
  act(obs: Observation): string | Promise<string>;
}

export interface RunResult {
  agent: string;
  endReason: EndReason;
  summary: RunSummary;
  replay: Replay;
  decisions: number;
  rejected: number;
}

/** Plays one full run in-process. `onStep` sees every decision, e.g. for logging. */
export async function runAgent(
  agent: Agent,
  seed: number,
  options: Partial<Limits> & { onStep?: (obs: Observation, code: string, result: ActResult) => void } = {},
): Promise<RunResult> {
  const session = new ArenaSession(seed, options);
  while (!session.done) {
    const obs = session.observe();
    const code = await agent.act(obs);
    const result = session.act(code);
    options.onStep?.(obs, code, result);
  }
  return {
    agent: agent.name,
    endReason: session.endReason!,
    summary: session.summary(),
    replay: session.replay(),
    decisions: session.decisions,
    rejected: session.rejected,
  };
}
