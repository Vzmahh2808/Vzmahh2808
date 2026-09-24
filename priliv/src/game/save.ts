export const SAVE_KEY = "priliv.save";
export const SAVE_VERSION = 1;
export const GARAGE_SLOTS = 3;

export interface GarageCar {
  kind: string;
  color: number;
}

export interface SaveData {
  version: number;
  money: number;
  missionsDone: string[];
  garage: GarageCar[];
  bestRace: number | null;
  muted: boolean;
  /** Radio station index, -1 for off. */
  radio: number;
  /** In-game hour, restored on load. */
  clock: number;
  /** Graphics preset; "auto" picks low on touch devices. */
  quality: "auto" | "high" | "low";
  stats: { missions: number; arrests: number; deaths: number; carsDestroyed: number };
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
    muted: false,
    radio: 0,
    clock: 17,
    quality: "auto",
    stats: { missions: 0, arrests: 0, deaths: 0, carsDestroyed: 0 },
  };
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
          .slice(0, GARAGE_SLOTS)
      : [],
    bestRace: typeof data.bestRace === "number" && data.bestRace > 0 ? data.bestRace : null,
    muted: data.muted === true,
    radio: typeof data.radio === "number" && data.radio >= -1 && data.radio <= 2 ? Math.floor(data.radio) : base.radio,
    clock: typeof data.clock === "number" && data.clock >= 0 && data.clock < 24 ? data.clock : base.clock,
    quality: data.quality === "high" || data.quality === "low" ? data.quality : "auto",
    stats: {
      missions: num(data.stats?.missions, 0),
      arrests: num(data.stats?.arrests, 0),
      deaths: num(data.stats?.deaths, 0),
      carsDestroyed: num(data.stats?.carsDestroyed, 0),
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

export function writeSave(data: SaveData, store: KeyValueStore | null = defaultStore()): void {
  try {
    store?.setItem(SAVE_KEY, JSON.stringify(data));
  } catch {
    /* storage full or blocked: the game keeps running without persistence */
  }
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
