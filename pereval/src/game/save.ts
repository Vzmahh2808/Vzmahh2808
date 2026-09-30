import { SAVE_VERSION, type Category, type GameState } from "./types";

const SAVE_KEY = "pereval.save";
const SCORES_KEY = "pereval.scores";
const SCORE_LIMIT = 10;

export interface ScoreEntry {
  score: number;
  rank: string;
  category: Category;
  days: number;
  checkpoints: number;
  outcome: "won" | "lost";
  reason: string;
  date: string;
}

export interface Storage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function storage(): Storage | null {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {
    /* private mode or blocked storage */
  }
  return null;
}

export function saveGame(state: GameState, store: Storage | null = storage()): void {
  if (!store) return;
  try {
    store.setItem(SAVE_KEY, JSON.stringify(state));
  } catch {
    /* quota exceeded or blocked */
  }
}

export function loadGame(store: Storage | null = storage()): GameState | null {
  if (!store) return null;
  try {
    const raw = store.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<GameState>;
    if (parsed.version !== SAVE_VERSION || !parsed.tiles || !parsed.members || parsed.status !== "playing") return null;
    return parsed as GameState;
  } catch {
    return null;
  }
}

export function clearSave(store: Storage | null = storage()): void {
  try {
    store?.removeItem(SAVE_KEY);
  } catch {
    /* ignore */
  }
}

export function loadScores(store: Storage | null = storage()): ScoreEntry[] {
  if (!store) return [];
  try {
    const raw = store.getItem(SCORES_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? (list as ScoreEntry[]) : [];
  } catch {
    return [];
  }
}

/** Inserts an entry into the top list; returns the new list and the 1-based rank (0 if not in the top). */
export function recordScore(entry: ScoreEntry, store: Storage | null = storage()): { scores: ScoreEntry[]; place: number } {
  const scores = loadScores(store);
  scores.push(entry);
  scores.sort((a, b) => b.score - a.score || a.days - b.days);
  const place = scores.indexOf(entry) + 1;
  const kept = scores.slice(0, SCORE_LIMIT);
  try {
    store?.setItem(SCORES_KEY, JSON.stringify(kept));
  } catch {
    /* ignore */
  }
  return { scores: kept, place: place <= SCORE_LIMIT ? place : 0 };
}
