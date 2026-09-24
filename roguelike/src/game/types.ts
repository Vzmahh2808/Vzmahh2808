export enum Tile {
  Wall = 0,
  Floor = 1,
  Door = 2,
  StairsDown = 3,
}

export interface Point {
  x: number;
  y: number;
}

export interface Room {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TileMap {
  width: number;
  height: number;
  tiles: Tile[];
  explored: boolean[];
  rooms: Room[];
}

export type AiKind = "chase" | "erratic" | "coward";

export type MonsterSpecial = "poison" | "drain" | "regen" | "boss";

export interface MonsterDef {
  id: string;
  name: string;
  /** Accusative form for "you hit X". */
  nameAcc: string;
  glyph: string;
  color: string;
  hp: number;
  atk: [number, number];
  def: number;
  acc: number;
  eva: number;
  xp: number;
  minDepth: number;
  maxDepth: number;
  ai: AiKind;
  special?: MonsterSpecial;
  weight: number;
}

export interface Monster {
  id: number;
  defId: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  /** Turns the monster will keep hunting after losing sight of the player. */
  alert: number;
  poison: number;
}

export type ItemKind = "potion" | "scroll" | "weapon" | "armor" | "gold" | "amulet";

export type ItemEffect =
  | "heal"
  | "fullheal"
  | "strength"
  | "toughness"
  | "antidote"
  | "teleport"
  | "mapping"
  | "fire"
  | "none";

export interface ItemDef {
  id: string;
  name: string;
  kind: ItemKind;
  glyph: string;
  color: string;
  effect: ItemEffect;
  atk?: [number, number];
  def?: number;
  eva?: number;
  minDepth: number;
  weight: number;
  description: string;
}

export interface Item {
  defId: string;
  /** Gold amount for gold piles. */
  amount?: number;
}

export interface GroundItem {
  x: number;
  y: number;
  item: Item;
}

export interface Player {
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  level: number;
  xp: number;
  /** Permanent bonus damage from potions of strength. */
  strength: number;
  gold: number;
  inventory: Item[];
  weapon: Item | null;
  armor: Item | null;
  poison: number;
  kills: number;
}

export type LogKind = "info" | "good" | "bad" | "warn" | "system";

export interface LogEntry {
  text: string;
  kind: LogKind;
  turn: number;
}

export type GameStatus = "playing" | "dead" | "won";

export interface GameState {
  version: number;
  seed: number;
  rngState: number;
  depth: number;
  turn: number;
  map: TileMap;
  player: Player;
  monsters: Monster[];
  items: GroundItem[];
  log: LogEntry[];
  status: GameStatus;
  nextMonsterId: number;
  deathCause: string;
}

/** Entity id used for the player in movement/attack events. */
export const PLAYER_ID = -1;

export type GameEvent =
  | { type: "move"; id: number; from: Point; to: Point }
  | { type: "attack"; id: number; from: Point; to: Point; hit: boolean }
  | { type: "damage"; id: number; x: number; y: number; amount: number; player: boolean }
  | { type: "float"; x: number; y: number; text: string; color: string }
  | { type: "monsterDeath"; x: number; y: number; glyph: string; color: string }
  | { type: "gold" }
  | { type: "pickup" }
  | { type: "potion" }
  | { type: "scroll"; effect: string }
  | { type: "fire"; targets: Point[] }
  | { type: "teleport"; from: Point; to: Point }
  | { type: "levelup" }
  | { type: "descend" }
  | { type: "death" }
  | { type: "win" }
  | { type: "blocked" };

export interface FloatingText {
  x: number;
  y: number;
  text: string;
  color: string;
  ttl: number;
}

export const INVENTORY_LIMIT = 12;
export const MAX_DEPTH = 10;
export const SAVE_VERSION = 1;
