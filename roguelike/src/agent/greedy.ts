/**
 * A simple agent that uses nothing but the observation: the reference for what an agent
 * can do without planning, and a fallback for smarter agents.
 */
import { itemDef } from "../game/data";
import type { Observation } from "./observe";
import type { Agent } from "./session";

const LOW_HP = 0.4;
const REST_BELOW = 0.6;
/** How close a visible monster must be before the agent goes after it instead of exploring. */
const ENGAGE_DISTANCE = 6;

function weaponPower(id: string | undefined): number {
  const atk = id ? itemDef(id).atk : undefined;
  return atk ? (atk[0] + atk[1]) / 2 : 2;
}

function armorPower(id: string | undefined): number {
  return id ? itemDef(id).def ?? 0 : 0;
}

/** Numpad code of the legal step that brings the player closest to (x, y). */
export function stepToward(obs: Observation, x: number, y: number): string | null {
  const legal = new Set(obs.legal);
  let best: string | null = null;
  let bestD = Infinity;
  for (const [code, dx, dy] of NUMPAD) {
    if (!legal.has(code)) continue;
    const d = Math.max(Math.abs(x - (obs.player.x + dx)), Math.abs(y - (obs.player.y + dy)));
    if (d < bestD) {
      bestD = d;
      best = code;
    }
  }
  return best;
}

const NUMPAD: [string, number, number][] = [
  ["1", -1, 1],
  ["2", 0, 1],
  ["3", 1, 1],
  ["4", -1, 0],
  ["6", 1, 0],
  ["7", -1, -1],
  ["8", 0, -1],
  ["9", 1, -1],
];

export function greedyChoice(obs: Observation): string {
  const legal = new Set(obs.legal);
  const p = obs.player;
  const slotOf = (pred: (id: string) => boolean) => obs.inventory.find((i) => pred(i.id))?.slot;
  const use = (slot: string | undefined) => (slot && legal.has("u" + slot) ? "u" + slot : null);

  const choice =
    (p.hp < p.maxHp * LOW_HP ? use(slotOf((id) => id === "potion_heal" || id === "potion_fullheal")) : null) ??
    (p.poison > 2 ? use(slotOf((id) => id === "potion_antidote")) : null) ??
    use(slotOf((id) => id === "potion_strength" || id === "potion_tough")) ??
    use(slotOf((id) => itemDef(id).kind === "weapon" && weaponPower(id) > weaponPower(currentId(obs, "weapon")))) ??
    use(slotOf((id) => itemDef(id).kind === "armor" && armorPower(id) > armorPower(currentId(obs, "armor")))) ??
    fight(obs) ??
    (obs.here.length > 0 && legal.has("g") ? "g" : null) ??
    (p.hp < p.maxHp * REST_BELOW && obs.monsters.length === 0 ? "5" : null) ??
    (obs.hints.explore && legal.has(obs.hints.explore) ? obs.hints.explore : null) ??
    (obs.hints.stairs && legal.has(obs.hints.stairs) ? obs.hints.stairs : null);
  return choice ?? "5";
}

function fight(obs: Observation): string | null {
  const target = obs.monsters[0];
  if (!target || target.distance > ENGAGE_DISTANCE) return null;
  return stepToward(obs, target.x, target.y);
}

/** The observation names equipped items; map the name back to an item id. */
function currentId(obs: Observation, slot: "weapon" | "armor"): string | undefined {
  const name = obs.player[slot];
  if (!name) return undefined;
  const kind = slot === "weapon" ? "weapon" : "armor";
  return ITEM_IDS_BY_NAME.get(`${kind}:${name}`);
}

const ITEM_IDS_BY_NAME = new Map(
  ["dagger", "sword", "axe", "hammer", "leather", "chain", "plate"].map((id) => {
    const def = itemDef(id);
    return [`${def.kind}:${def.name}`, id] as const;
  }),
);

export const greedyAgent: Agent = { name: "greedy", act: greedyChoice };
