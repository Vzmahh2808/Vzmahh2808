/**
 * One save made of the settings and the season, with the time it was written.
 * Local storage holds the parts; the platform layer keeps a cloud copy of the
 * whole pack and the newer of the two wins at start-up.
 */
export const SAVED_AT_KEY = "khl.savedAt";
export const SEASON_KEY = "khl.league";
export const SETTINGS_KEY = "khl.settings";

export interface Pack {
  v: 1;
  savedAt: number;
  /** Raw JSON of the season, or null when there is none. */
  season: string | null;
  /** Raw JSON of the settings, or null. */
  settings: string | null;
}

let hook: (() => void) | null = null;

/** Called after every local write so the platform can push a cloud copy. */
export function setSaveHook(fn: (() => void) | null): void {
  hook = fn;
}

/** Record that the local save changed just now. */
export function touchSaved(): void {
  try {
    localStorage.setItem(SAVED_AT_KEY, String(Date.now()));
  } catch {
    /* no storage */
  }
  hook?.();
}

export function packLocal(): string | null {
  try {
    const pack: Pack = {
      v: 1,
      savedAt: Number(localStorage.getItem(SAVED_AT_KEY)) || 0,
      season: localStorage.getItem(SEASON_KEY),
      settings: localStorage.getItem(SETTINGS_KEY),
    };
    return JSON.stringify(pack);
  } catch {
    return null;
  }
}

/** Parse a pack; null if it is missing or malformed. */
export function parsePack(raw: string | null | undefined): Pack | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<Pack>;
    if (p.v !== 1 || typeof p.savedAt !== "number" || !Number.isFinite(p.savedAt)) return null;
    if (p.season !== null && typeof p.season !== "string") return null;
    if (p.settings !== null && typeof p.settings !== "string") return null;
    return { v: 1, savedAt: p.savedAt, season: p.season, settings: p.settings };
  } catch {
    return null;
  }
}

/**
 * The pack to play from: whichever valid one was written last. A broken or
 * missing pack loses to a valid one; on a tie the local copy wins.
 */
export function newerPack(local: string | null, cloud: string | null): string | null {
  const l = parsePack(local);
  const c = parsePack(cloud);
  if (!c) return l ? local : null;
  if (!l) return cloud;
  return c.savedAt > l.savedAt ? cloud : local;
}

/** Write a pack's parts into local storage. */
export function applyPack(raw: string): boolean {
  const p = parsePack(raw);
  if (!p) return false;
  try {
    if (p.season === null) localStorage.removeItem(SEASON_KEY);
    else localStorage.setItem(SEASON_KEY, p.season);
    if (p.settings === null) localStorage.removeItem(SETTINGS_KEY);
    else localStorage.setItem(SETTINGS_KEY, p.settings);
    localStorage.setItem(SAVED_AT_KEY, String(p.savedAt));
    return true;
  } catch {
    return false;
  }
}
