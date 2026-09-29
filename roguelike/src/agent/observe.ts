/**
 * What an agent sees each turn: only what the character can see or remembers, never the
 * seed, hidden monsters or unexplored map. With the seed an agent could re-run the open
 * engine and look ahead, so it must stay server-side while a run is in progress.
 */
import { encodeAction } from "../game/actions";
import { itemDef, monsterDef } from "../game/data";
import { findTile, idx, tileAt } from "../game/dungeon";
import { itemName, scoreOf, xpToNext, type Game } from "../game/game";
import { DIRS8, canStep, chebyshev } from "../game/path";
import { INVENTORY_LIMIT, MAX_DEPTH, Tile, type GameStatus, type Point } from "../game/types";

export const OBSERVATION_VERSION = 1;
const MESSAGE_LIMIT = 12;

export interface ObservedItem {
  /** Inventory letter a-z; absent for items on the floor. */
  slot?: string;
  id: string;
  name: string;
  kind: string;
  description: string;
}

export interface ObservedMonster {
  id: number;
  kind: string;
  name: string;
  glyph: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  /** Chebyshev distance: 1 means adjacent and attackable. */
  distance: number;
}

export interface Observation {
  version: number;
  turn: number;
  depth: number;
  maxDepth: number;
  status: GameStatus;
  score: number;
  player: {
    x: number;
    y: number;
    hp: number;
    maxHp: number;
    level: number;
    xp: number;
    xpNext: number;
    gold: number;
    poison: number;
    attack: [number, number];
    defense: number;
    evasion: number;
    kills: number;
    weapon: string | null;
    armor: string | null;
  };
  inventory: ObservedItem[];
  inventoryLimit: number;
  /** Explored floor as text rows: # wall, . floor, + door, > stairs, blank unexplored; visible monsters, items and @ drawn on top. */
  map: string[];
  monsters: ObservedMonster[];
  items: (ObservedItem & { x: number; y: number })[];
  /** Items under the player. */
  here: ObservedItem[];
  messages: string[];
  /** Every action code the engine accepts right now. */
  legal: string[];
  /** Next step along known ground: toward unexplored space (or the stairs once the floor is explored), and toward the stairs. */
  hints: { explore?: string; stairs?: string; stairsAt?: Point };
}

const TILE_GLYPH: Record<Tile, string> = {
  [Tile.Wall]: "#",
  [Tile.Floor]: ".",
  [Tile.Door]: "+",
  [Tile.StairsDown]: ">",
};

export function observe(game: Game): Observation {
  const s = game.state;
  const p = game.player;
  const map = s.map;

  const rows: string[][] = [];
  for (let y = 0; y < map.height; y++) {
    const row: string[] = [];
    for (let x = 0; x < map.width; x++) row.push(map.explored[idx(map, x, y)] ? TILE_GLYPH[tileAt(map, x, y)] : " ");
    rows.push(row);
  }
  const items = s.items
    .filter((g) => game.isVisible(g.x, g.y))
    .map((g) => ({ x: g.x, y: g.y, ...describe(g.item.defId, itemName(g.item)) }));
  for (const it of items) rows[it.y][it.x] = itemDef(it.id).glyph;
  const monsters = game.visibleMonsters().map((m) => {
    const def = monsterDef(m.defId);
    return { id: m.id, kind: def.id, name: def.name, glyph: def.glyph, x: m.x, y: m.y, hp: m.hp, maxHp: m.maxHp, distance: chebyshev(m, p) };
  });
  monsters.sort((a, b) => a.distance - b.distance || a.id - b.id);
  for (const m of monsters) rows[m.y][m.x] = m.glyph;
  rows[p.y][p.x] = "@";

  const [atkLo, atkHi] = game.attackRange();
  return {
    version: OBSERVATION_VERSION,
    turn: s.turn,
    depth: s.depth,
    maxDepth: MAX_DEPTH,
    status: s.status,
    score: scoreOf(s),
    player: {
      x: p.x,
      y: p.y,
      hp: p.hp,
      maxHp: p.maxHp,
      level: p.level,
      xp: p.xp,
      xpNext: xpToNext(p.level),
      gold: p.gold,
      poison: p.poison,
      attack: [atkLo, atkHi],
      defense: game.defense(),
      evasion: game.evasion(),
      kills: p.kills,
      weapon: p.weapon ? itemName(p.weapon) : null,
      armor: p.armor ? itemName(p.armor) : null,
    },
    inventory: p.inventory.map((item, i) => ({ slot: String.fromCharCode(97 + i), ...describe(item.defId, itemName(item)) })),
    inventoryLimit: INVENTORY_LIMIT,
    map: rows.map((r) => r.join("")),
    monsters,
    items,
    here: game.itemsAt(p.x, p.y).map((g) => describe(g.item.defId, itemName(g.item))),
    messages: s.log.filter((e) => e.turn >= s.turn - 1).slice(-MESSAGE_LIMIT).map((e) => e.text),
    legal: legalActions(game),
    hints: hints(game),
  };
}

function describe(defId: string, name: string): ObservedItem {
  const def = itemDef(defId);
  return { id: def.id, name, kind: def.kind, description: def.description };
}

/** Mirrors the acceptance rules of the engine's action methods without changing the game. */
export function legalActions(game: Game): string[] {
  const s = game.state;
  if (s.status !== "playing") return [];
  const p = game.player;
  const out: string[] = [];
  for (const d of DIRS8) {
    const tx = p.x + d.x;
    const ty = p.y + d.y;
    if (game.monsterAt(tx, ty) || canStep(s.map, p.x, p.y, tx, ty)) out.push(encodeAction({ type: "move", dx: d.x, dy: d.y }));
  }
  out.push("5");
  if (canPickUp(game)) out.push("g");
  if (tileAt(s.map, p.x, p.y) === Tile.StairsDown) out.push(">");
  p.inventory.forEach((item, i) => {
    const kind = itemDef(item.defId).kind;
    if (kind === "weapon" || kind === "armor" || kind === "potion" || kind === "scroll") out.push(encodeAction({ type: "use", index: i }));
  });
  p.inventory.forEach((_, i) => out.push(encodeAction({ type: "drop", index: i })));
  return out;
}

function canPickUp(game: Game): boolean {
  let carried = game.player.inventory.length;
  let took = 0;
  for (const g of game.itemsAt(game.player.x, game.player.y)) {
    if (g.item.defId === "amulet") return true;
    if (carried >= INVENTORY_LIMIT) break;
    carried++;
    took++;
  }
  return took > 0;
}

function stepToward(game: Game, target: Point): string | undefined {
  const p = game.player;
  if (target.x === p.x && target.y === p.y) return undefined;
  const step = game.pathTo(target.x, target.y)[0];
  return step ? encodeAction({ type: "move", dx: step.x - p.x, dy: step.y - p.y }) : undefined;
}

function hints(game: Game): Observation["hints"] {
  if (game.state.status !== "playing") return {};
  const map = game.state.map;
  const p = game.player;
  const out: Observation["hints"] = {};
  const target = game.exploreTarget();
  if (target) out.explore = stepToward(game, target);
  const stairs = findTile(map, Tile.StairsDown);
  if (stairs && map.explored[idx(map, stairs.x, stairs.y)]) {
    out.stairsAt = stairs;
    out.stairs = stairs.x === p.x && stairs.y === p.y ? ">" : stepToward(game, stairs);
  }
  return out;
}
