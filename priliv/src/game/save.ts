import { RAID_EVERY, freshHoldings, type Holdings } from "./business";
import { WEAPONS } from "./weapons";
import { isOutfit } from "./outfits";
import { EXPORT_PRICES, type ExportState } from "./sidejobs";

export const SAVE_KEY = "priliv.save";
export const SAVE_VERSION = 1;
export const GARAGE_SLOTS = 3;

export interface GarageCar {
  kind: string;
  color: number;
  mods?: { engine: boolean; tires: boolean; armor: boolean };
}

export interface SaveData {
  version: number;
  money: number;
  missionsDone: string[];
  garage: GarageCar[];
  bestRace: number | null;
  /** Best regatta time in seconds. */
  bestRegatta: number | null;
  muted: boolean;
  /** Radio station index, -1 for off. */
  radio: number;
  /** In-game hour, restored on load. */
  clock: number;
  /** Graphics preset; "auto" picks low on touch devices. */
  quality: "auto" | "high" | "low";
  stats: { missions: number; arrests: number; deaths: number; carsDestroyed: number; racesWon: number };
  /** Businesses bought, their tills and any shakedown under way. */
  business: Holdings;
  /** Unique stunt jumps cleared, and the best score of any jump. */
  stunts: { done: string[]; best: number };
  /** Guns bought, rounds carried for each, and the one in hand. */
  weapons: { owned: string[]; ammo: Record<string, number>; selected: string | null };
  /** Outfit worn now and every outfit bought (indexes into OUTFITS). */
  outfit: { worn: number; owned: number[] };
  /** Gang hideouts cleared for good. */
  hideouts: string[];
  /** The export dock's list of cars to steal; an empty list is drawn fresh in game. */
  export: ExportState;
  /** Best demolition derby time in seconds. */
  bestDerby: number | null;
  /** Wall-clock time of the last write, to pick the newer of a local and a cloud save. */
  savedAt: number;
}

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function freshSave(): SaveData {
  return {
    version: SAVE_VERSION,
    money: 200,
    missionsDone: [],
    garage: [],
    bestRace: null,
    bestRegatta: null,
    muted: false,
    radio: 0,
    clock: 17,
    quality: "auto",
    stats: { missions: 0, arrests: 0, deaths: 0, carsDestroyed: 0, racesWon: 0 },
    business: freshHoldings(),
    stunts: { done: [], best: 0 },
    weapons: { owned: [], ammo: {}, selected: null },
    outfit: { worn: 0, owned: [0] },
    hideouts: [],
    export: { wanted: [], delivered: [], total: 0 },
    bestDerby: null,
    savedAt: 0,
  };
}

function parseOutfit(raw: unknown): SaveData["outfit"] {
  const o = (raw ?? {}) as { worn?: unknown; owned?: unknown };
  const owned = Array.isArray(o.owned) ? [...new Set(o.owned.filter(isOutfit))] : [];
  if (!owned.includes(0)) owned.unshift(0);
  const worn = isOutfit(o.worn) && owned.includes(o.worn) ? o.worn : 0;
  return { worn, owned };
}

function parseWeapons(raw: unknown): SaveData["weapons"] {
  const w: SaveData["weapons"] = { owned: [], ammo: {}, selected: null };
  if (!raw || typeof raw !== "object") return w;
  const data = raw as { owned?: unknown; ammo?: unknown; selected?: unknown };
  if (Array.isArray(data.owned)) w.owned = [...new Set(data.owned.filter((id): id is string => typeof id === "string" && id in WEAPONS))];
  if (data.ammo && typeof data.ammo === "object") {
    for (const id of w.owned) {
      const n = (data.ammo as Record<string, unknown>)[id];
      w.ammo[id] = typeof n === "number" && n > 0 ? Math.floor(n) : 0;
    }
  }
  if (typeof data.selected === "string" && w.owned.includes(data.selected)) w.selected = data.selected;
  return w;
}

function parseExport(raw: unknown): ExportState {
  const e: ExportState = { wanted: [], delivered: [], total: 0 };
  if (!raw || typeof raw !== "object") return e;
  const data = raw as { wanted?: unknown; delivered?: unknown; total?: unknown };
  const kinds = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((k): k is string => typeof k === "string" && k in EXPORT_PRICES))] : []);
  e.wanted = kinds(data.wanted);
  e.delivered = kinds(data.delivered).filter((k) => e.wanted.includes(k));
  e.total = typeof data.total === "number" && data.total > 0 ? Math.floor(data.total) : 0;
  return e;
}

function parseHoldings(raw: unknown): Holdings {
  const h = freshHoldings();
  if (!raw || typeof raw !== "object") return h;
  const data = raw as { list?: Record<string, unknown>; nextRaid?: unknown };
  if (typeof data.nextRaid === "number" && data.nextRaid > 0 && data.nextRaid <= RAID_EVERY) h.nextRaid = data.nextRaid;
  for (const [id, v] of Object.entries(data.list ?? {})) {
    if (!v || typeof v !== "object") continue;
    const b = v as { owned?: unknown; stored?: unknown; raid?: unknown };
    h.list[id] = {
      owned: b.owned === true,
      stored: typeof b.stored === "number" && b.stored > 0 ? b.stored : 0,
      raid: typeof b.raid === "number" && b.raid > 0 ? b.raid : 0,
    };
  }
  return h;
}

function defaultStore(): KeyValueStore | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

/** Parse and sanity-check a save; anything malformed falls back to defaults field by field. */
export function parseSave(raw: string | null): SaveData | null {
  if (!raw) return null;
  let data: Partial<SaveData>;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || data.version !== SAVE_VERSION) return null;
  const base = freshSave();
  const num = (v: unknown, d: number) => (typeof v === "number" && isFinite(v) ? v : d);
  return {
    version: SAVE_VERSION,
    money: Math.max(0, Math.floor(num(data.money, base.money))),
    missionsDone: Array.isArray(data.missionsDone) ? data.missionsDone.filter((m) => typeof m === "string") : [],
    garage: Array.isArray(data.garage)
      ? data.garage
          .filter((c): c is GarageCar => !!c && typeof c.kind === "string" && typeof c.color === "number")
          .map((c) => ({
            kind: c.kind,
            color: c.color,
            mods: { engine: c.mods?.engine === true, tires: c.mods?.tires === true, armor: c.mods?.armor === true },
          }))
          .slice(0, GARAGE_SLOTS)
      : [],
    bestRace: typeof data.bestRace === "number" && data.bestRace > 0 ? data.bestRace : null,
    bestRegatta: typeof data.bestRegatta === "number" && data.bestRegatta > 0 ? data.bestRegatta : null,
    muted: data.muted === true,
    radio: typeof data.radio === "number" && data.radio >= -1 && data.radio <= 2 ? Math.floor(data.radio) : base.radio,
    clock: typeof data.clock === "number" && data.clock >= 0 && data.clock < 24 ? data.clock : base.clock,
    quality: data.quality === "high" || data.quality === "low" ? data.quality : "auto",
    stats: {
      missions: num(data.stats?.missions, 0),
      arrests: num(data.stats?.arrests, 0),
      deaths: num(data.stats?.deaths, 0),
      carsDestroyed: num(data.stats?.carsDestroyed, 0),
      racesWon: num(data.stats?.racesWon, 0),
    },
    business: parseHoldings(data.business),
    weapons: parseWeapons(data.weapons),
    export: parseExport(data.export),
    outfit: parseOutfit(data.outfit),
    bestDerby: typeof data.bestDerby === "number" && data.bestDerby > 0 ? data.bestDerby : null,
    savedAt: typeof data.savedAt === "number" && data.savedAt > 0 ? data.savedAt : 0,
    hideouts: Array.isArray(data.hideouts) ? [...new Set(data.hideouts.filter((h): h is string => typeof h === "string"))] : [],
    stunts: {
      done: Array.isArray(data.stunts?.done) ? [...new Set(data.stunts.done.filter((d): d is string => typeof d === "string"))] : [],
      best: Math.max(0, Math.floor(num(data.stunts?.best, 0))),
    },
  };
}

export function loadSave(store: KeyValueStore | null = defaultStore()): SaveData | null {
  try {
    return parseSave(store?.getItem(SAVE_KEY) ?? null);
  } catch {
    return null;
  }
}

/** Stamp and store the save; returns the JSON written, for a cloud copy. */
export function writeSave(data: SaveData, store: KeyValueStore | null = defaultStore(), now = Date.now()): string {
  data.savedAt = now;
  const raw = JSON.stringify(data);
  try {
    store?.setItem(SAVE_KEY, raw);
  } catch {
    /* storage full or blocked: the game keeps running without persistence */
  }
  return raw;
}

export function clearSave(store: KeyValueStore | null = defaultStore()): void {
  try {
    store?.removeItem(SAVE_KEY);
  } catch {
    /* ignore */
  }
}

/** Put a car in the garage; the oldest one is dropped when full. */
export function storeInGarage(data: SaveData, car: GarageCar): void {
  data.garage.push(car);
  while (data.garage.length > GARAGE_SLOTS) data.garage.shift();
}

export class MemoryStore implements KeyValueStore {
  private m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, v);
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
}
