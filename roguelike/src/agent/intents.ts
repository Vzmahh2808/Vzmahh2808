/**
 * Intents let an expensive agent (a language model) decide rarely: it picks a plan such as
 * "explore" or "fight", and the plan is expanded into single steps until something new
 * happens that deserves another decision.
 */
import { greedyChoice, stepToward } from "./greedy";
import type { Observation } from "./observe";

export type Intent =
  /** Let the built-in greedy policy play until something new happens. */
  | { kind: "auto" }
  | { kind: "explore" }
  | { kind: "stairs" }
  | { kind: "fight" }
  | { kind: "rest" }
  | { kind: "pickup" }
  | { kind: "use"; slot: string }
  | { kind: "drop"; slot: string }
  | { kind: "step"; direction: string };

export const INTENT_KINDS = ["auto", "explore", "stairs", "fight", "rest", "pickup", "use", "drop", "step"] as const;

/** Intents that are a single action. */
const ONE_SHOT = new Set<Intent["kind"]>(["pickup", "use", "drop", "step"]);

/**
 * The next action code for `intent`, or null when the intent is finished or impossible.
 * `taken` is how many steps of this intent already ran.
 */
export function nextStep(obs: Observation, intent: Intent, taken: number): string | null {
  if (ONE_SHOT.has(intent.kind) && taken > 0) return null;
  const legal = new Set(obs.legal);
  const ifLegal = (code: string | undefined) => (code && legal.has(code) ? code : null);
  switch (intent.kind) {
    case "auto":
      return greedyChoice(obs);
    case "explore":
      return ifLegal(obs.hints.explore);
    case "stairs":
      return ifLegal(obs.hints.stairs);
    case "fight": {
      const target = obs.monsters[0];
      return target ? stepToward(obs, target.x, target.y) : null;
    }
    case "rest":
      return obs.monsters.length === 0 && obs.player.hp < obs.player.maxHp ? ifLegal("5") : null;
    case "pickup":
      return ifLegal("g");
    case "use":
      return ifLegal("u" + intent.slot);
    case "drop":
      return ifLegal("d" + intent.slot);
    case "step":
      return ifLegal(intent.direction);
  }
}

/** Something happened since `before` that a planner should look at. */
export function needsDecision(before: Observation, now: Observation): boolean {
  const seen = new Set(before.monsters.map((m) => m.id));
  if (now.monsters.some((m) => !seen.has(m.id))) return true;
  if (now.depth !== before.depth || now.status !== before.status) return true;
  if (now.here.length > 0 && before.here.length === 0) return true;
  const half = now.player.maxHp / 2;
  return now.player.hp < half && before.player.hp >= half;
}
