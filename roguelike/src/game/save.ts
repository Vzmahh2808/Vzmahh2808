import type { ResolvedChallenge } from "../chain/challenge";
import { SAVE_VERSION, type GameState } from "./types";

const SAVE_KEY = "dungeon-delver.save";
const SCORES_KEY = "dungeon-delver.scores";
const CHALLENGE_KEY = "dungeon-delver.challenge";
const SCORE_LIMIT = 10;

export interface ScoreEntry {
  score: number;
  depth: number;
  level: number;
  turns: number;
  outcome: "won" | "dead";
  cause: string;
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
    if (parsed.version !== SAVE_VERSION || !parsed.map || !parsed.player) return null;
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

/** Remembers which daily challenge the saved run belongs to; null marks a free run. */
export function saveChallenge(challenge: ResolvedChallenge | null, store: Storage | null = storage()): void {
  try {
    if (challenge) store?.setItem(CHALLENGE_KEY, JSON.stringify(challenge));
    else store?.removeItem(CHALLENGE_KEY);
  } catch {
    /* ignore */
  }
}

export function loadChallenge(store: Storage | null = storage()): ResolvedChallenge | null {
  if (!store) return null;
  try {
    const raw = store.getItem(CHALLENGE_KEY);
    return raw ? (JSON.parse(raw) as ResolvedChallenge) : null;
  } catch {
    return null;
  }
}

export function loadScores(store: Storage | null = storage()): ScoreEntry[] {
  if (!store) return [];
  try {
    const raw = store.getItem(SCORES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ScoreEntry[]) : [];
  } catch {
    return [];
  }
}

/** Insert an entry, keep the top N sorted by score; returns the new list and the entry's rank (0-based) or -1. */
export function recordScore(entry: ScoreEntry, store: Storage | null = storage()): { scores: ScoreEntry[]; rank: number } {
  const scores = loadScores(store);
  scores.push(entry);
  scores.sort((a, b) => b.score - a.score || a.turns - b.turns);
  const trimmed = scores.slice(0, SCORE_LIMIT);
  const rank = trimmed.indexOf(entry);
  try {
    store?.setItem(SCORES_KEY, JSON.stringify(trimmed));
  } catch {
    /* ignore */
  }
  return { scores: trimmed, rank };
}

/** In-memory storage for tests. */
export class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
}
