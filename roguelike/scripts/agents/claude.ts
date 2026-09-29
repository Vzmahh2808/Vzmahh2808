/**
 * Example agent driven by Claude. The model is asked for an intent (explore, fight, use an
 * item...) only when something new happens; in between the intent is expanded into single
 * steps, so a run costs dozens to a few hundred model calls rather than one per turn.
 *
 * Credentials come from the environment (ANTHROPIC_API_KEY or an `ant auth login` profile).
 */
import Anthropic from "@anthropic-ai/sdk";
import { greedyChoice } from "../../src/agent/greedy";
import { INTENT_KINDS, needsDecision, nextStep, type Intent } from "../../src/agent/intents";
import type { Observation } from "../../src/agent/observe";
import type { Agent } from "../../src/agent/session";

export const DEFAULT_MODEL = "claude-opus-5";
/** Re-plan at least this often even when nothing seems to change. */
const MAX_INTENT_STEPS = 60;
const HISTORY_LENGTH = 6;
const VIEW_HALF_WIDTH = 20;
const VIEW_HALF_HEIGHT = 10;

const SYSTEM_PROMPT = `You are playing "Heart of the Dungeon", a turn-based roguelike, as an autonomous agent in a competition. Game text (monster and item names, messages) is in Russian.

Goal: descend to floor 10, defeat the Dungeon Lord (L) and pick up the Heart of the Dungeon to win. Death is permanent. Score = gold + 100 × floor + experience + 5 × kills, plus 1000 for winning, so going deeper matters most, but dying early ends everything.

Rules worth knowing:
- Moving into a monster attacks it. Monsters act after every action that takes a turn.
- Health regenerates slowly while you act; poison drains 1 HP per turn until it wears off or you drink an antidote.
- Stronger monsters appear on deeper floors, and new ones spawn over time, so lingering is risky.
- Potions: healing (40% HP), big healing (full HP, cures poison), antidote, strength (+1 damage forever), toughness (+5 max HP forever). Scrolls: teleport (random spot on the floor), mapping (reveals the floor), fireball (8–14 damage to every visible enemy). Weapons and armor are equipped with "use"; armor lowers evasion.
- The inventory holds 12 items.

Each turn you get the character's view: stats, inventory with slot letters, visible monsters with their offset from you (dx, dy; 1 step = adjacent), items underfoot, recent messages, the legal action codes, and a map window around you (@ is you, # wall, . floor, + door, > stairs down, blank = unexplored).

Choose one intent. It keeps running until it finishes or something new happens (a new monster appears, health drops below half, you step onto items, the floor changes), then you are asked again:
- auto: a built-in heuristic plays (heals when low, equips better gear, fights close monsters, picks up items, explores, descends). Good default when nothing needs judgment.
- explore: walk toward unexplored space; heads for the stairs once the floor is explored.
- stairs: walk to the known stairs and descend.
- fight: approach and attack the nearest visible monster.
- rest: wait until healed, stops when a monster appears.
- pickup: pick up the items underfoot.
- use: use or equip the inventory item in "slot".
- drop: drop the inventory item in "slot".
- step: one step in "direction" (numpad digit: 8 north, 2 south, 4 west, 6 east, 7/9/1/3 diagonals), for example to retreat.

Answer with the JSON object only. Put the slot letter only for use/drop and the digit only for step; leave the other field empty. Keep "reason" to one short sentence.`;

const DECISION_SCHEMA = {
  type: "object",
  properties: {
    intent: { type: "string", enum: [...INTENT_KINDS] },
    slot: { type: "string", description: "Inventory letter for use/drop, otherwise empty" },
    direction: { type: "string", description: "Numpad digit for step, otherwise empty" },
    reason: { type: "string", description: "One short sentence" },
  },
  required: ["intent", "slot", "direction", "reason"],
  additionalProperties: false,
};

type CreateMessage = (params: Anthropic.Beta.MessageCreateParamsNonStreaming) => Promise<Anthropic.Beta.BetaMessage>;

export interface ClaudeAgentOptions {
  model?: string;
  /** Sends one request; defaults to the SDK client. Tests substitute a fake. */
  create?: CreateMessage;
  log?: (line: string) => void;
}

export class ClaudeAgent implements Agent {
  readonly name: string;
  /** Model requests made so far. */
  calls = 0;
  private readonly model: string;
  private readonly create: CreateMessage;
  private readonly log: (line: string) => void;
  private intent: Intent = { kind: "auto" };
  private taken = 0;
  private last: Observation | null = null;
  private readonly history: string[] = [];

  constructor(options: ClaudeAgentOptions = {}) {
    this.model = options.model ?? DEFAULT_MODEL;
    this.name = `claude (${this.model})`;
    this.log = options.log ?? (() => {});
    if (options.create) {
      this.create = options.create;
    } else {
      // The SDK retries 429, 5xx and connection errors itself, honouring retry-after.
      const client = new Anthropic({ maxRetries: 6 });
      this.create = (params) => client.beta.messages.create(params);
    }
  }

  async act(obs: Observation): Promise<string> {
    const planned = this.last && !needsDecision(this.last, obs) && this.taken < MAX_INTENT_STEPS ? nextStep(obs, this.intent, this.taken) : null;
    if (planned) return this.take(obs, planned);

    this.intent = await this.decide(obs);
    this.taken = 0;
    const first = nextStep(obs, this.intent, 0);
    if (!first) {
      this.remember(obs, "(план невыполним, играет эвристика)");
      this.intent = { kind: "auto" };
    }
    return this.take(obs, first ?? greedyChoice(obs));
  }

  private take(obs: Observation, code: string): string {
    this.taken++;
    this.last = obs;
    return code;
  }

  private remember(obs: Observation, text: string): void {
    this.history.push(`turn ${obs.turn}: ${text}`);
    if (this.history.length > HISTORY_LENGTH) this.history.shift();
  }

  private async decide(obs: Observation): Promise<Intent> {
    const params: Anthropic.Beta.MessageCreateParamsNonStreaming = {
      model: this.model,
      max_tokens: 16000,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: describe(obs, this.history) }],
      output_config: { effort: "low", format: { type: "json_schema", schema: DECISION_SCHEMA } },
      // If a safety classifier declines, the API re-runs the request on its recommended fallback model.
      ...(this.model === DEFAULT_MODEL ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    };

    let res: Anthropic.Beta.BetaMessage;
    try {
      res = await this.create(params);
    } catch (e) {
      // Out of retries on a transient failure: keep playing on the heuristic and ask again later.
      if (e instanceof Anthropic.RateLimitError || e instanceof Anthropic.InternalServerError || e instanceof Anthropic.APIConnectionError) {
        this.log(`turn ${obs.turn}: запрос к модели не прошёл (${e.message}), играет эвристика`);
        return { kind: "auto" };
      }
      throw e;
    }
    this.calls++;

    if (res.stop_reason === "refusal" || res.stop_reason === "max_tokens") {
      this.log(`turn ${obs.turn}: модель не дала ответа (${res.stop_reason}), играет эвристика`);
      return { kind: "auto" };
    }
    const text = res.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")?.text ?? "";
    const intent = parseDecision(text);
    const reason = safeReason(text);
    this.remember(obs, `${label(intent)} — ${reason}`);
    this.log(`turn ${obs.turn}: ${label(intent)} — ${reason}`);
    return intent;
  }
}

/** Turns the model's JSON into an intent; anything malformed becomes "auto". */
export function parseDecision(text: string): Intent {
  let data: { intent?: unknown; slot?: unknown; direction?: unknown };
  try {
    data = JSON.parse(text) as typeof data;
  } catch {
    return { kind: "auto" };
  }
  const kind = data.intent;
  const slot = typeof data.slot === "string" ? data.slot.trim().toLowerCase() : "";
  const direction = typeof data.direction === "string" ? data.direction.trim() : "";
  switch (kind) {
    case "use":
    case "drop":
      return /^[a-z]$/.test(slot) ? { kind, slot } : { kind: "auto" };
    case "step":
      return /^[1-46-9]$/.test(direction) ? { kind, direction } : { kind: "auto" };
    case "auto":
    case "explore":
    case "stairs":
    case "fight":
    case "rest":
    case "pickup":
      return { kind };
    default:
      return { kind: "auto" };
  }
}

function safeReason(text: string): string {
  try {
    const r = (JSON.parse(text) as { reason?: unknown }).reason;
    return typeof r === "string" ? r.slice(0, 200) : "";
  } catch {
    return "ответ не разобран";
  }
}

function label(intent: Intent): string {
  if (intent.kind === "use" || intent.kind === "drop") return `${intent.kind} ${intent.slot}`;
  if (intent.kind === "step") return `step ${intent.direction}`;
  return intent.kind;
}

/** Compact text view of an observation for the model. */
export function describe(obs: Observation, history: readonly string[]): string {
  const p = obs.player;
  const lines = [
    `Turn ${obs.turn}, floor ${obs.depth}/${obs.maxDepth}, score ${obs.score}.`,
    `HP ${p.hp}/${p.maxHp}, level ${p.level} (xp ${p.xp}/${p.xpNext}), poison ${p.poison}, damage ${p.attack[0]}-${p.attack[1]}, defense ${p.defense}, gold ${p.gold}.`,
    `Weapon: ${p.weapon ?? "none"}. Armor: ${p.armor ?? "none"}.`,
    `Inventory (${obs.inventory.length}/${obs.inventoryLimit}): ${
      obs.inventory.map((i) => `${i.slot}) ${i.name} [${i.kind}] ${i.description}`).join("; ") || "empty"
    }`,
    `Underfoot: ${obs.here.map((i) => i.name).join(", ") || "nothing"}`,
    `Visible monsters: ${
      obs.monsters.map((m) => `${m.glyph} ${m.name} HP ${m.hp}/${m.maxHp} at dx ${m.x - p.x}, dy ${m.y - p.y}`).join("; ") || "none"
    }`,
    `Recent messages: ${obs.messages.join(" | ") || "none"}`,
    `Legal action codes: ${obs.legal.join(" ")}`,
    `Hints: explore step ${obs.hints.explore ?? "none"}, stairs step ${obs.hints.stairs ?? "stairs not found yet"}`,
    `Your recent decisions: ${history.join(" | ") || "none"}`,
    "Map around you:",
    ...viewport(obs),
  ];
  return lines.join("\n");
}

function viewport(obs: Observation): string[] {
  const { x, y } = obs.player;
  const top = Math.max(0, y - VIEW_HALF_HEIGHT);
  const bottom = Math.min(obs.map.length, y + VIEW_HALF_HEIGHT + 1);
  const left = Math.max(0, x - VIEW_HALF_WIDTH);
  const right = x + VIEW_HALF_WIDTH + 1;
  return obs.map.slice(top, bottom).map((row) => row.slice(left, right).trimEnd());
}
